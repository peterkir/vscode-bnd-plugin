import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Executable, LanguageClient } from 'vscode-languageclient/node';
import { executeServerCommand } from '../../extension';

suite('LSP build commands', () => {
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
        } finally {
            await client.stop();
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});
