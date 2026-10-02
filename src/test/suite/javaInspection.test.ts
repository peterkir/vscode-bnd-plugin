import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import {
    Executable,
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
} from 'vscode-languageclient/node';
import { copyCustomServerJar, inspectJavaExecutable, normalizePath } from '../../extension';
import { effectiveCommand, parseEffectiveResult } from '../../effectiveProperties';

suite('Java runtime inspection', () => {
    test('launches a custom server JAR from a copy so the build output stays writable', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-jar-copy-'));
        const source = path.join(tmp, 'generated', 'biz.aQute.bnd.lsp.jar');
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.writeFileSync(source, 'v1');
        const context = { globalStorageUri: vscode.Uri.file(path.join(tmp, 'storage')) } as vscode.ExtensionContext;

        try {
            const first = copyCustomServerJar(context, source);
            assert.notStrictEqual(path.resolve(first), path.resolve(source));
            assert.strictEqual(fs.readFileSync(first, 'utf8'), 'v1');
            assert.strictEqual(copyCustomServerJar(context, source), first);

            fs.writeFileSync(source, 'v2-rebuilt');
            fs.utimesSync(source, new Date(), new Date(Date.now() + 5000));
            const second = copyCustomServerJar(context, source);
            assert.notStrictEqual(second, first);
            assert.strictEqual(fs.readFileSync(second, 'utf8'), 'v2-rebuilt');
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
    test('normalizes MSYS / Git Bash POSIX drive prefix on Windows', () => {
        const input = '/c/Users/test/java';
        const normalized = normalizePath(input);
        if (process.platform === 'win32') {
            assert.strictEqual(normalized, 'C:/Users/test/java');
        } else {
            assert.strictEqual(normalized, input);
        }
    });

    test('inspects existing Java executable or handles non-existent gracefully', () => {
        const result = inspectJavaExecutable('non_existent_java_binary_12345');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error);
    });

    test('starts Java LanguageClient successfully and connects to bnd LSP jar', async () => {
        const workspaceRoot = path.resolve(__dirname, '../../../../');
        const jarPath = path.join(workspaceRoot, 'server', 'biz.aQute.bnd.lsp.jar');

        const executable: Executable = {
            command: 'java',
            args: ['-jar', jarPath],
            options: { env: process.env },
        };
        const serverOptions: ServerOptions = {
            run: executable,
            debug: executable,
        };
        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: 'bnd' }],
            initializationOptions: { workspaceTrusted: true },
            // Not disposed: the server may still write stderr after stop, and a client-owned channel would be closed by then.
            outputChannel: vscode.window.createOutputChannel('Test bnd Language Server', { log: true }),
            initializationFailedHandler: (err) => {
                console.error('Test LSP initializationFailedHandler caught:', err);
                return false;
            },
        };

        const client = new LanguageClient(
            'testBndLanguageServer',
            'Test bnd Language Server',
            serverOptions,
            clientOptions
        );
        client.getFeature('workspace/executeCommand').initialize = () => {};
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-effective-'));

        try {
            await client.start();
            assert.ok(client.initializeResult, 'Client should have initializeResult');
            assert.ok(client.initializeResult.capabilities, 'Capabilities should be present');
            assert.ok(client.initializeResult.capabilities.executeCommandProvider?.commands.includes(effectiveCommand));
            const file = path.join(temporary, 'launch.bndrun');
            fs.writeFileSync(file, 'deleted: disk\nvalue: saved\n');
            const uri = vscode.Uri.file(file).toString();
            await client.sendNotification('textDocument/didOpen', {
                textDocument: { uri, languageId: 'bnd', version: 1, text: 'value: unsaved\nnew: ${value}\n' },
            });
            const result = parseEffectiveResult(await client.sendRequest('workspace/executeCommand', {
                command: effectiveCommand,
                arguments: [{ uri, documentVersion: 1, expanded: true, merged: true }],
            }));
            assert.strictEqual(result.documentVersion, 1);
            assert.strictEqual(result.rows.find(row => row.key === 'new')?.value, 'unsaved');
            assert.ok(!result.rows.some(row => row.key === 'deleted'));
            assert.ok(result.rows.find(row => row.key === 'value')?.provenances.some(origin => origin.uri));
            await client.sendNotification('textDocument/didChange', {
                textDocument: { uri, version: 2 }, contentChanges: [{ text: 'value: changed\n' }],
            });
            const stale = await client.sendRequest<{ code: string }>('workspace/executeCommand', {
                command: effectiveCommand, arguments: [{ uri, documentVersion: 1 }],
            });
            assert.strictEqual(stale.code, 'staleDocument');
            assert.strictEqual(fs.readFileSync(file, 'utf8'), 'deleted: disk\nvalue: saved\n');
        } catch (err: any) {
            console.error('client.start() threw:', err);
            assert.fail(err);
        } finally {
            if (client.isRunning()) await client.stop();
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    });
});
