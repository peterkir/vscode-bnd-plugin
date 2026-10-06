import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import * as vscode from 'vscode';
import { Executable, LanguageClient } from 'vscode-languageclient/node';
import { executeServerCommand } from '../../extension';
import {
    defaultSelection, entryUri, formatSize, hexFormat, isBinary, jarPrintCommand, jarViewerHtml, jarViewType, readArchive,
    readEntry, readLimit, renderEntry,
} from '../../jarViewer';

/** Minimal ZIP writer: stored entries for names ending with '/' or flagged, deflated otherwise. */
function zip(entries: { name: string; data?: Buffer; store?: boolean }[]): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const data = entry.data ?? Buffer.alloc(0);
        const stored = entry.store || entry.name.endsWith('/');
        const body = stored ? data : zlib.deflateRawSync(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(stored ? 0 : 8, 8);
        local.writeUInt16LE(0x6000, 10);
        local.writeUInt16LE(0x5a21, 12);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(stored ? 0 : 8, 10);
        central.writeUInt16LE(0x6000, 12);
        central.writeUInt16LE(0x5a21, 14);
        central.writeUInt32LE(body.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, name, body);
        centrals.push(central, name);
        offset += local.length + name.length + body.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
}

suite('JAR viewer', () => {
    const manifest = Buffer.from('Manifest-Version: 1.0\r\nBundle-SymbolicName: sample\r\n');
    const big = Buffer.alloc(readLimit + 10, 'a');
    const sample = () => zip([
        { name: 'META-INF/' },
        { name: 'META-INF/MANIFEST.MF', data: manifest },
        { name: 'sample/big.txt', data: big },
        { name: 'sample/raw.bin', data: Buffer.from([0, 1, 2, 0x41]), store: true },
    ]);

    test('reads the central directory and stored and deflated entries', async () => {
        const archive = readArchive(sample());
        assert.deepStrictEqual([...archive.entries.keys()], ['META-INF', 'META-INF/MANIFEST.MF', 'sample/big.txt', 'sample/raw.bin']);
        assert.ok(archive.entries.get('META-INF')!.directory);
        const entry = archive.entries.get('META-INF/MANIFEST.MF')!;
        assert.strictEqual(entry.size, manifest.length);
        assert.deepStrictEqual(new Date(entry.modified), new Date(2025, 0, 1, 12, 0, 0));
        assert.deepStrictEqual(await readEntry(archive, entry), manifest);
        assert.deepStrictEqual([...await readEntry(archive, archive.entries.get('sample/raw.bin')!)], [0, 1, 2, 0x41]);
        assert.strictEqual((await readEntry(archive, archive.entries.get('sample/big.txt')!, readLimit)).length, readLimit);
        assert.strictEqual((await readEntry(archive, archive.entries.get('sample/big.txt')!)).length, big.length);
        assert.strictEqual(defaultSelection(archive.entries), 'META-INF/MANIFEST.MF');
        assert.throws(() => readArchive(Buffer.from('not a zip file')), /Not a ZIP archive/);
    });

    test('formats like the bndtools JAR editor', () => {
        assert.strictEqual(hexFormat(Buffer.from('ABC\0')), `0x0000  41 42 43 00${' '.repeat(37)}  ABC.\n`);
        const rows = hexFormat(Buffer.from('0123456789abcdef\n')).split('\n');
        assert.strictEqual(rows[0], `0x0000  30 31 32 33 34 35 36 37  38 39 61 62 63 64 65 66  01234567  89abcdef`);
        assert.strictEqual(rows[1], `0x0010  0A${' '.repeat(46)}  .`);
        assert.ok(isBinary(Buffer.from([65, 0])));
        assert.ok(!isBinary(Buffer.from('text')));
        assert.deepStrictEqual(renderEntry(Buffer.from('h\u00e9'), 'auto', 'utf-8', false), { content: 'h\u00e9', mode: 'text' });
        assert.strictEqual(renderEntry(Buffer.from([0xe9]), 'text', 'iso-8859-1', false).content, '\u00e9');
        assert.strictEqual(renderEntry(Buffer.from([0]), 'auto', 'utf-8', true).mode, 'hex');
        assert.ok(renderEntry(Buffer.from('a'), 'text', 'utf-8', true).content.endsWith(`\n\nLimited to ${readLimit}`));
        assert.strictEqual(formatSize(999), '999 b');
        assert.strictEqual(formatSize(1234567), '1.23 Mb');
    });

    test('uses local assets and a strict CSP', () => {
        const webview = { cspSource: 'https://test.webview', asWebviewUri: (uri: vscode.Uri) => uri } as vscode.Webview;
        const html = jarViewerHtml(webview, vscode.Uri.file('/extension'), '<x>.jar');
        assert.ok(html.includes("default-src 'none'"));
        assert.ok(!html.includes('unsafe-inline'));
        assert.ok(html.includes('jarViewer.js'));
        assert.ok(html.includes('&#60;x&#62;.jar'));
        assert.ok(html.includes('role="tab"'));
    });

    test('opens JAR files by default and serves entries read-only', async function () {
        this.timeout(30000);
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-jar-viewer-'));
        const file = path.join(temporary, 'sample.jar');
        fs.writeFileSync(file, sample());
        const uri = vscode.Uri.file(file);
        try {
            await vscode.extensions.getExtension('klibio.bnd')!.activate();
            await vscode.commands.executeCommand('vscode.open', uri);
            const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
            assert.ok(tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === jarViewType, 'Expected JAR viewer as default editor');
            const entry = entryUri(uri, 'META-INF/MANIFEST.MF');
            const document = await vscode.workspace.openTextDocument(entry);
            assert.ok(document.getText().includes('Bundle-SymbolicName: sample'));
            assert.deepStrictEqual(await vscode.workspace.fs.readDirectory(entryUri(uri, '')),
                [['META-INF', vscode.FileType.Directory], ['sample', vscode.FileType.Directory]]);
            assert.strictEqual((await vscode.workspace.fs.stat(entryUri(uri, 'sample/raw.bin'))).size, 4);
            await assert.rejects(Promise.resolve(vscode.workspace.fs.writeFile(entry, Buffer.from('x'))));
            await assert.rejects(Promise.resolve(vscode.workspace.fs.stat(entryUri(uri, 'missing'))));
            await vscode.window.tabGroups.close(vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(item =>
                (item.input instanceof vscode.TabInputCustom || item.input instanceof vscode.TabInputText)
                && item.input.uri.toString().includes('sample.jar')));
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });

    test('prints the bndtools report through the bundled Java language server', async function () {
        this.timeout(60000);
        const jar = path.resolve(__dirname, '../../../../server/biz.aQute.bnd.lsp.jar');
        const executable: Executable = { command: 'java', args: ['-jar', jar], options: { env: process.env } };
        const client = new LanguageClient('testBndJarPrint', 'Test bnd JAR Print', { run: executable, debug: executable }, {
            documentSelector: [{ scheme: 'file', language: 'bnd' }],
            outputChannel: vscode.window.createOutputChannel('Test bnd JAR Print', { log: true }),
        });
        client.getFeature('workspace/executeCommand').initialize = () => {};
        try {
            await client.start();
            assert.ok(client.initializeResult?.capabilities.executeCommandProvider?.commands.includes(jarPrintCommand));
            const result = await executeServerCommand(client, jarPrintCommand, [{ uri: vscode.Uri.file(jar).toString() }]) as { text: string };
            for (const section of ['[MANIFEST]', '[IMPEXP]', '[LIST]', 'Bundle-SymbolicName']) {
                assert.ok(result.text.includes(section), `Missing ${section}`);
            }
            const missing = await executeServerCommand(client, jarPrintCommand, [{ uri: vscode.Uri.file(jar + '.missing').toString() }]) as { error?: string };
            assert.match(missing.error ?? '', /does not exist/);
        } finally {
            await client.stop();
        }
    });
});
