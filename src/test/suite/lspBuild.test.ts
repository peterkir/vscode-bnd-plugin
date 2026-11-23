import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Executable, LanguageClient } from 'vscode-languageclient/node';
import { BndExtensionApi, executeServerCommand } from '../../extension';
import { parseExportResult } from '../../bndExport';

suite('LSP build commands', () => {
    test('normalizes export replies', () => {
        assert.deepStrictEqual(parseExportResult({ success: true, exporter: 'bnd.runbundles', output: '/x', errors: [], warnings: ['w'] }),
            { success: true, exporter: 'bnd.runbundles', output: '/x', errors: [], warnings: ['w'] });
        const failed = parseExportResult({ error: 'Exporting requires a trusted workspace.' });
        assert.strictEqual(failed.success, false);
        assert.deepStrictEqual(failed.errors, ['Exporting requires a trusted workspace.']);
        assert.strictEqual(parseExportResult({ success: true, errors: ['bad'] }).success, false);
        assert.strictEqual(parseExportResult(null).success, false);
    });

    test('cleans, baselines and dry-run resolves through the bundled Java language server', async function () {
        this.timeout(120000);
        const jar = path.resolve(__dirname, '../../../../server/biz.aQute.bnd.lsp.jar');
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-lsp-build-'));
        fs.mkdirSync(path.join(temporary, 'cnf'), { recursive: true });
        fs.writeFileSync(path.join(temporary, 'cnf', 'build.bnd'), '');
        const project = path.join(temporary, 'p');
        fs.mkdirSync(path.join(project, 'generated'), { recursive: true });
        fs.writeFileSync(path.join(project, 'bnd.bnd'), 'Bundle-Version: 1.0.0\n');
        const stale = path.join(project, 'generated', 'stale.jar');
        fs.writeFileSync(stale, 'stale');
        const bndrun = path.join(project, 'launch.bndrun');
        const bndrunText = '-runfw: org.missing.framework\n-runrequires: osgi.identity;filter:=\'(osgi.identity=missing)\'\n';
        fs.writeFileSync(bndrun, bndrunText);

        const executable: Executable = { command: 'java', args: ['-jar', jar], options: { env: process.env } };
        const client = new LanguageClient('testBndLspBuild', 'Test bnd LSP build', { run: executable, debug: executable }, {
            documentSelector: [{ scheme: 'file', language: 'bnd' }],
            initializationOptions: { workspaceTrusted: true },
            outputChannel: vscode.window.createOutputChannel('Test bnd LSP build', { log: true }),
        });
        client.getFeature('workspace/executeCommand').initialize = () => {};
        try {
            await client.start();
            const supported = client.initializeResult?.capabilities.executeCommandProvider?.commands ?? [];
            for (const command of ['bnd.build.clean', 'bnd.baseline', 'bnd.resolve']) {
                assert.ok(supported.includes(command), `Server must advertise ${command}`);
            }
            const projectUri = vscode.Uri.file(path.join(project, 'bnd.bnd')).toString();

            const cleaned = await executeServerCommand(client, 'bnd.build.clean', [projectUri]) as Record<string, unknown>;
            assert.strictEqual(cleaned.success, true, JSON.stringify(cleaned));
            assert.deepStrictEqual(cleaned.cleanedProjects, ['p']);
            assert.ok(!fs.existsSync(stale), 'clean must remove generated output');

            const baseline = await executeServerCommand(client, 'bnd.baseline', [projectUri]) as Record<string, unknown>;
            const bundles = baseline.bundles as Array<Record<string, unknown>>;
            assert.strictEqual(bundles.length, 1, JSON.stringify(baseline));
            assert.strictEqual(bundles[0].bsn, 'p');
            assert.strictEqual(bundles[0].baselined, false);
            assert.match(String(bundles[0].reason), /-baseline/);

            const resolved = await executeServerCommand(client, 'bnd.resolve', [vscode.Uri.file(bndrun).toString(), false]) as Record<string, unknown>;
            assert.notStrictEqual(resolved.written, true, JSON.stringify(resolved));
            assert.strictEqual(fs.readFileSync(bndrun, 'utf8'), bndrunText, 'dry run must not modify the .bndrun');

            assert.ok(supported.includes('bnd.export'), 'Server must advertise bnd.export');
            fs.writeFileSync(path.join(project, 'bnd.bnd'), 'Bundle-Version: 1.0.0\n-includeresource: a.txt;literal=a\n');
            const exportRun = path.join(project, 'export.bndrun');
            fs.writeFileSync(exportRun, '-runbundles: p;version=snapshot\n');
            const exported = parseExportResult(await executeServerCommand(client, 'bnd.export',
                [{ uri: vscode.Uri.file(exportRun).toString(), exporter: 'bnd.runbundles' }]));
            assert.strictEqual(exported.success, true, JSON.stringify(exported));
            assert.strictEqual(vscode.Uri.file(exported.output ?? '').toString(),
                vscode.Uri.file(path.join(project, 'generated', 'export', 'export.bndrun')).toString());
            assert.ok(fs.existsSync(path.join(exported.output ?? '', 'p.jar')), 'export must write the run bundles');
        } finally {
            await client.stop();
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });

    test('builds and cleans from tree items, the way the bnd Explorer menu invokes the commands', async function () {
        this.timeout(120000);
        const api = await vscode.extensions.getExtension<BndExtensionApi>('klibio.bnd')!.activate();
        await vscode.commands.executeCommand('bnd.server.restart');
        const deadline = Date.now() + 100000;
        while (api.getServerStatus().state !== 'running') {
            assert.ok(Date.now() < deadline, `the language server did not start: ${JSON.stringify(api.getServerStatus())}`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-explorer-build-'));
        fs.mkdirSync(path.join(temporary, 'cnf'), { recursive: true });
        fs.writeFileSync(path.join(temporary, 'cnf', 'build.bnd'), '');
        const project = path.join(temporary, 'p');
        fs.mkdirSync(project, { recursive: true });
        fs.writeFileSync(path.join(project, 'bnd.bnd'), 'Bundle-Version: 1.0.0\n-includeresource: a.txt;literal=a\n');
        const bundle = path.join(project, 'generated', 'p.jar');
        try {
            await vscode.commands.executeCommand('bnd.lsp.buildProject', { uri: vscode.Uri.file(path.join(project, 'bnd.bnd')) });
            assert.ok(fs.existsSync(bundle), 'build from a .bnd tree item must write the bundle');

            await vscode.commands.executeCommand('bnd.lsp.cleanProject', { uri: vscode.Uri.file(project) });
            assert.ok(!fs.existsSync(bundle), 'clean from a folder tree item must remove the bundle');

            await vscode.commands.executeCommand('bnd.lsp.buildProject', { uri: vscode.Uri.file(project) });
            assert.ok(fs.existsSync(bundle), 'build from a folder tree item must write the bundle');
            await vscode.commands.executeCommand('bnd.lsp.buildProject', vscode.Uri.file(temporary));
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });

    test('clears stale problem markers of an open bnd file when diagnostics are refreshed', async function () {
        this.timeout(180000);
        const api = await vscode.extensions.getExtension<BndExtensionApi>('klibio.bnd')!.activate();
        await vscode.commands.executeCommand('bnd.server.restart');
        const deadline = Date.now() + 100000;
        while (api.getServerStatus().state !== 'running') {
            assert.ok(Date.now() < deadline, `the language server did not start: ${JSON.stringify(api.getServerStatus())}`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-refresh-diagnostics-'));
        fs.mkdirSync(path.join(temporary, 'cnf'), { recursive: true });
        fs.writeFileSync(path.join(temporary, 'cnf', 'build.bnd'), '');
        const project = path.join(temporary, 'p');
        fs.mkdirSync(project, { recursive: true });
        const file = path.join(project, 'bnd.bnd');
        fs.writeFileSync(file, 'Bundle-Version: 1.0.0\n-includeresource: missing.txt\n');
        const uri = vscode.Uri.file(file);
        const waitForMarkers = async (expected: (count: number) => boolean) => {
            for (let attempt = 0; attempt < 100; attempt++) {
                if (expected(vscode.languages.getDiagnostics(uri).length)) return;
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            assert.fail(`unexpected markers: ${JSON.stringify(vscode.languages.getDiagnostics(uri).map(d => d.message))}`);
        };
        try {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
            await waitForMarkers(count => count > 0);

            fs.writeFileSync(path.join(project, 'missing.txt'), 'present now');
            await api.refreshDiagnostics();
            await waitForMarkers(count => count === 0);
        } finally {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});
