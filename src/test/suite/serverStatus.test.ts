import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BndExtensionApi } from '../../extension';
import { readBuildInfo } from '../../extension';
import { presentServerStatus, presentVersions, ServerStatus } from '../../serverStatus';

async function waitFor<T>(what: string, timeout: number, probe: () => T | undefined | Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await probe();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out after ${timeout} ms waiting for ${what}`);
}

suite('Language server enablement', () => {
    const packageJsonPath = path.resolve(__dirname, '../../../../package.json');

    test('contributes the enablement setting and status commands', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const setting = pkg.contributes.configuration.properties['bnd.server.enabled'];
        assert.strictEqual(setting.type, 'boolean');
        assert.strictEqual(setting.default, true);
        for (const command of ['bnd.server.toggle', 'bnd.server.menu']) {
            assert.ok(pkg.contributes.commands.some((entry: { command: string }) => entry.command === command), command);
            assert.ok(pkg.contributes.menus.commandPalette.some((entry: { command: string }) => entry.command === command), command);
        }
    });

    test('presents every server state in the status bar', () => {
        const states: ServerStatus[] = [
            { state: 'disabled' },
            { state: 'stopped' },
            { state: 'starting', kind: 'java' },
            { state: 'running', kind: 'node' },
            { state: 'failed', message: 'no Java' },
        ];
        const views = states.map(presentServerStatus);
        assert.deepStrictEqual(views.map(view => view.text), [
            '$(extensions) $(circle-slash)', '$(extensions) $(debug-disconnect)', '$(extensions) $(sync~spin)',
            '$(extensions) $(check)', '$(extensions) $(error)',
        ]);
        assert.deepStrictEqual(views.map(view => view.error), [false, false, false, false, true]);
        assert.match(views[0].tooltip, /disabled by bnd\.server\.enabled/);
        assert.match(views[2].tooltip, /starting \(java\)/);
        assert.match(views[3].tooltip, /running \(node\)/);
        assert.match(views[4].tooltip, /no Java/);
    });

    test('presents the versions and Git commits of the extension and the language server', () => {
        const sha = 'a6d53ebdd89c999be8050b3f7acda1ebab9861ae';
        const extension = { version: '0.33.0', commit: sha, dirty: true };
        const running: ServerStatus = { state: 'running', kind: 'java' };
        assert.deepStrictEqual(presentVersions(extension, running, { name: 'bnd Language Server', version: `7.6.0.202611271341 (${sha})` }), [
            '- Extension: **0.33.0** (`a6d53ebdd8`, modified)',
            '- bnd Language Server (java): **7.6.0.202611271341 (`a6d53ebdd8`)**',
        ]);
        assert.deepStrictEqual(presentVersions({ version: '0.33.0' }, { state: 'running', kind: 'socket' }, { name: 'custom' }), [
            '- Extension: **0.33.0**',
            '- custom (socket): **version unknown**',
        ]);
        assert.strictEqual(presentVersions(extension, { state: 'disabled' }, undefined)[1],
            '- Language Server: disabled by bnd.server.enabled');
    });

    test('reads the build info written by the compile step', () => {
        const extension = vscode.extensions.getExtension('klibio.bnd')!;
        const info = readBuildInfo(extension.extensionPath, extension.packageJSON.version);
        assert.strictEqual(info.version, extension.packageJSON.version);
        assert.match(info.commit ?? '', /^[0-9a-f]{40}$/, 'npm run compile records the Git commit');
        assert.deepStrictEqual(readBuildInfo(path.join(os.tmpdir(), 'no-such-extension'), '1.2.3'), { version: '1.2.3' });
    });

    test('stops the server while bnd.server.enabled is false and starts it again', async function () {
        this.timeout(240000);
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-server-enabled-'));
        const file = path.join(temporary, 'bnd.bnd');
        fs.writeFileSync(file, '-buildpath: osgi.core\n');
        const extension = vscode.extensions.getExtension<BndExtensionApi>('klibio.bnd')!;
        const api = await extension.activate();
        const uri = vscode.Uri.file(file);
        const setEnabled = (value: boolean | undefined) =>
            vscode.workspace.getConfiguration('bnd').update('server.enabled', value, vscode.ConfigurationTarget.Global);
        const hovers = async () => (await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider', uri, new vscode.Position(0, 3))) ?? [];
        try {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });

            await setEnabled(false);
            await waitFor('the disabled state', 60000, () => api.getServerStatus().state === 'disabled');
            assert.deepStrictEqual(await hovers(), [], 'a disabled server must not answer hover requests');
            await vscode.commands.executeCommand('bnd.server.restart');
            assert.strictEqual(api.getServerStatus().state, 'disabled', 'restart must not start a disabled server');

            await setEnabled(undefined);
            await waitFor('the running state', 120000, () => api.getServerStatus().state === 'running');
            await waitFor('a hover from the restarted server', 60000, async () => (await hovers()).length > 0);
        } finally {
            await setEnabled(undefined);
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});
