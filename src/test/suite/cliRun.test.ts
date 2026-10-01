import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    activeBndrunFile,
    findJavaRuntimeHomeForRunee,
    parseRuneeFromFile,
    parseRuneeMajorVersion,
} from '../../bndCliCommands';

suite('CLI bndrun detection & -runee parsing', () => {
    test('detects explicit bndrun URI', () => {
        const uri = vscode.Uri.file('/workspace/app.bndrun');
        const detected = activeBndrunFile(uri);
        assert.ok(detected);
        assert.ok(detected.endsWith('.bndrun'));
    });

    test('ignores non-bndrun files', () => {
        const uri = vscode.Uri.file('/workspace/bnd.bnd');
        const detected = activeBndrunFile(uri);
        assert.strictEqual(detected, undefined);
    });

    test('parses -runee major versions correctly', () => {
        assert.strictEqual(parseRuneeMajorVersion('JavaSE-17'), 17);
        assert.strictEqual(parseRuneeMajorVersion('JavaSE-1.8'), 8);
        assert.strictEqual(parseRuneeMajorVersion('JavaSE-8'), 8);
        assert.strictEqual(parseRuneeMajorVersion('JavaSE-21'), 21);
        assert.strictEqual(parseRuneeMajorVersion('JavaSE-11'), 11);
        assert.strictEqual(parseRuneeMajorVersion('JavaSE-1.7'), 7);
        assert.strictEqual(parseRuneeMajorVersion('JavaSE/compact1-1.8'), 8);
        assert.strictEqual(parseRuneeMajorVersion('17'), 17);
    });

    test('parses direct -runee from file', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bnd-runee-test-'));
        const file = path.join(tmpDir, 'test.bndrun');
        await fs.writeFile(file, '# comment\n-runee: JavaSE-17\n-runbundles: foo\n', 'utf8');

        try {
            const runee = await parseRuneeFromFile(file);
            assert.strictEqual(runee, 'JavaSE-17');
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('parses -runee through recursive -include directives', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bnd-runee-inc-'));
        const sharedFile = path.join(tmpDir, 'shared.bndrun');
        const mainFile = path.join(tmpDir, 'main.bndrun');

        await fs.writeFile(sharedFile, '-runee: JavaSE-21\n', 'utf8');
        await fs.writeFile(
            mainFile,
            '-include: \\\n    shared.bndrun\n\n-runbundles: org.eclipse.osgi\n',
            'utf8'
        );

        try {
            const runee = await parseRuneeFromFile(mainFile);
            assert.strictEqual(runee, 'JavaSE-21');
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('finds configured Java runtime for -runee', async () => {
        const runtime = await findJavaRuntimeHomeForRunee('JavaSE-17');
        assert.ok(runtime, 'Should resolve a Java 17 runtime');
        assert.strictEqual(runtime?.major, 17);
    });
});
