import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Executable, FileChangeType, LanguageClient } from 'vscode-languageclient/node';
import { executeServerCommand } from '../../extension';
import {
    autoBuildCommand, BuildStatus, buildStatusNotification, parseAutoBuildSwitch, parseBuildStatus, supportsAutoBuild,
} from '../../autoBuild';

suite('Automatic build with the bundled Java language server', () => {
    test('builds a changed project, reports failures and can be switched off', async function () {
        this.timeout(120000);
        const jar = path.resolve(__dirname, '../../../../server/biz.aQute.bnd.lsp.jar');
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-auto-build-'));
        fs.mkdirSync(path.join(temporary, 'cnf'), { recursive: true });
        fs.writeFileSync(path.join(temporary, 'cnf', 'build.bnd'), '');
        const project = path.join(temporary, 'p');
        fs.mkdirSync(project, { recursive: true });
        const bnd = path.join(project, 'bnd.bnd');
        fs.writeFileSync(bnd, 'Bundle-Version: 1.0.0\n-includeresource: a.txt;literal=a\n');
        const bundle = path.join(project, 'generated', 'p.jar');

        const executable: Executable = { command: 'java', args: ['-jar', jar], options: { env: process.env } };
        const client = new LanguageClient('testBndAutoBuild', 'Test bnd auto-build', { run: executable, debug: executable }, {
            documentSelector: [{ scheme: 'file', language: 'bnd' }],
            initializationOptions: { workspaceTrusted: true, autoBuild: true },
            outputChannel: vscode.window.createOutputChannel('Test bnd auto-build', { log: true }),
        });
        client.getFeature('workspace/executeCommand').initialize = () => {};
        const statuses: BuildStatus[] = [];
        let notify: (() => void) | undefined;
        const finished = (predicate: (status: BuildStatus) => boolean) => new Promise<BuildStatus>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`no matching build status: ${JSON.stringify(statuses)}`)), 60000);
            notify = () => {
                const hit = statuses.find(predicate);
                if (hit) {
                    clearTimeout(timer);
                    notify = undefined;
                    resolve(hit);
                }
            };
            notify();
        });
        const changed = () => client.sendNotification('workspace/didChangeWatchedFiles',
            { changes: [{ uri: vscode.Uri.file(bnd).toString(), type: FileChangeType.Changed }] });
        try {
            client.onNotification(buildStatusNotification, raw => {
                const status = parseBuildStatus(raw);
                if (status) {
                    statuses.push(status);
                    notify?.();
                }
            });
            await client.start();
            assert.ok(supportsAutoBuild(client.initializeResult?.capabilities.experimental), 'Server must advertise bndAutoBuild');

            await changed();
            const built = await finished(status => status.state === 'idle' && (status.summary?.built ?? []).includes('p'));
            assert.deepStrictEqual(built.summary?.failed, []);
            assert.ok(fs.existsSync(bundle), 'automatic build must write the bundle');

            statuses.length = 0;
            fs.writeFileSync(bnd, 'Bundle-Version: 1.0.0\n-includeresource: missing.txt\n');
            await changed();
            const failed = await finished(status => status.state === 'idle' && (status.summary?.failed ?? []).includes('p'));
            assert.ok(failed.summary!.errors > 0, JSON.stringify(failed));
            assert.ok(failed.messages.some(message => message.project === 'p' && message.severity === 'error'),
                JSON.stringify(failed.messages));

            const off = parseAutoBuildSwitch(await executeServerCommand(client, autoBuildCommand, [false]));
            assert.deepStrictEqual(off, { enabled: false, active: false, reason: null });
            statuses.length = 0;
            fs.rmSync(bundle, { force: true });
            fs.writeFileSync(bnd, 'Bundle-Version: 1.0.0\n-includeresource: a.txt;literal=a\n');
            await changed();
            await new Promise(resolve => setTimeout(resolve, 3000));
            assert.ok(!statuses.some(status => status.state === 'building'), JSON.stringify(statuses));
            assert.ok(!fs.existsSync(bundle), 'a disabled automatic build must not build');

            const on = parseAutoBuildSwitch(await executeServerCommand(client, autoBuildCommand, [true]));
            assert.strictEqual(on?.enabled, true);
            assert.strictEqual(on?.active, true);
        } finally {
            await client.stop();
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});
