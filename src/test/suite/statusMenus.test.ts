import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BndExtensionApi } from '../../extension';
import { Interaction } from './interaction';

suite('bnd status and configuration menus', function () {
    this.timeout(180000);
    const bnd = () => vscode.workspace.getConfiguration('bnd');
    const keys = ['build.auto', 'server.enabled'];
    const saved = new Map<string, unknown>();
    let ui: Interaction;
    let api: BndExtensionApi;
    // The menus write to the workspace settings of the opened folder, which is this repository.
    const workspaceSettings = path.resolve(__dirname, '../../../../.vscode/settings.json');
    let hadWorkspaceSettings: boolean;

    const labelled = (pattern: RegExp) => (items: readonly { label: string }[]) => items.find(item => pattern.test(item.label));
    const waitFor = async (what: string, condition: () => boolean | Promise<boolean>) => {
        for (let attempt = 0; attempt < 400; attempt++) {
            if (await condition()) return;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        assert.fail(`timed out waiting for ${what}`);
    };

    suiteSetup(async () => {
        api = await vscode.extensions.getExtension<BndExtensionApi>('klibio.bnd')!.activate();
        for (const key of keys) saved.set(key, bnd().inspect(key)?.globalValue);
    });
    setup(() => {
        hadWorkspaceSettings = fs.existsSync(workspaceSettings);
        ui = new Interaction();
        ui.install();
    });
    teardown(async () => {
        ui.restore();
        for (const key of keys) {
            await bnd().update(key, saved.get(key), vscode.ConfigurationTarget.Global);
            if (!hadWorkspaceSettings) await bnd().update(key, undefined, vscode.ConfigurationTarget.Workspace);
        }
        if (!hadWorkspaceSettings) fs.rmSync(workspaceSettings, { force: true });
        await waitFor('the language server', () => api.getServerStatus().state === 'running');
    });

    test('switches automatic build from its status menu', async () => {
        ui.picks.push(labelled(/Disable Automatic Build/));
        await vscode.commands.executeCommand('bnd.build.auto.menu');
        assert.strictEqual(bnd().inspect('build.auto')?.globalValue, false);

        ui.picks.push(labelled(/Enable Automatic Build/));
        await vscode.commands.executeCommand('bnd.build.auto.menu');
        assert.strictEqual(bnd().inspect('build.auto')?.globalValue, true);

        ui.picks.push(labelled(/Show Build Output/));
        await vscode.commands.executeCommand('bnd.build.auto.menu');
        ui.picks.push(() => undefined);
        await vscode.commands.executeCommand('bnd.build.auto.menu');
    });

    test('offers restart and output from the language server menu', async () => {
        await waitFor('the language server', () => api.getServerStatus().state === 'running');
        ui.picks.push(labelled(/Show Output/));
        await vscode.commands.executeCommand('bnd.server.menu');

        ui.picks.push(labelled(/Restart Language Server/));
        await vscode.commands.executeCommand('bnd.server.menu');
        await waitFor('the restarted language server', () => api.getServerStatus().state === 'running');
    });

    test('turns the language server and automatic build off through the configuration popup', async () => {
        await waitFor('the language server', () => api.getServerStatus().state === 'running');
        // Keep every switch as it is: nothing may change.
        ui.quickPicks.push(items => items.filter((item: { picked?: boolean }) => item.picked));
        await vscode.commands.executeCommand('bnd.status.menu');
        assert.strictEqual(api.getServerStatus().state, 'running');

        ui.quickPicks.push(items => items.filter((item: { id: string }) => item.id === 'auto-build'));
        await vscode.commands.executeCommand('bnd.status.menu');
        await waitFor('the disabled server', () => api.getServerStatus().state === 'disabled');
        assert.ok(ui.messages.includes('Automatic Build was turned off because the bnd Language Server is off.'), JSON.stringify(ui.messages));

        ui.quickPicks.push(() => undefined);
        await vscode.commands.executeCommand('bnd.status.menu');
        assert.strictEqual(api.getServerStatus().state, 'disabled', 'a dismissed popup changes nothing');
    });

    test('toggles the language server', async () => {
        await waitFor('the language server', () => api.getServerStatus().state === 'running');
        await vscode.commands.executeCommand('bnd.server.toggle');
        await waitFor('the disabled server', () => api.getServerStatus().state === 'disabled');
        await vscode.commands.executeCommand('bnd.server.toggle');
        await waitFor('the language server', () => api.getServerStatus().state === 'running');
    });
});
