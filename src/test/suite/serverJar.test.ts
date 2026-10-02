import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { assertChecksum, parseJarNamesFromListing, parseSnapshotJarName } from '../../bndLibrary';
import { customUrlVersion, findCachedServerJar, resolveServerJar } from '../../serverJar';

suite('Language server JAR resolution', () => {
    let tmp: string;
    let context: Pick<vscode.ExtensionContext, 'globalStorageUri' | 'asAbsolutePath'>;
    let bundled: string;

    const config = (values: Record<string, unknown>) => ({
        get: <T>(key: string, fallback?: T) => (key in values ? values[key] as T : fallback),
    }) as Pick<vscode.WorkspaceConfiguration, 'get'>;

    const cacheJar = (kind: string, version: string, name: string, mtime: number): string => {
        const file = path.join(context.globalStorageUri.fsPath, 'library', 'lsp', kind, version, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, name);
        fs.utimesSync(file, new Date(mtime), new Date(mtime));
        return file;
    };

    setup(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-server-jar-'));
        bundled = path.join(tmp, 'ext', 'server', 'biz.aQute.bnd.lsp.jar');
        context = {
            globalStorageUri: vscode.Uri.file(path.join(tmp, 'storage')),
            asAbsolutePath: (relative: string) => path.join(tmp, 'ext', relative),
        };
    });

    teardown(() => fs.rmSync(tmp, { recursive: true, force: true }));

    test('uses the bundled JAR by default without pending download', () => {
        const resolved = resolveServerJar(context, config({}), () => assert.fail('no warning expected'));
        assert.strictEqual(resolved.path, bundled);
        assert.strictEqual(resolved.isLocalBuild, false);
        assert.strictEqual(resolved.pending, undefined);
    });

    test('bnd.server.jar wins when it exists', () => {
        const local = path.join(tmp, 'generated', 'biz.aQute.bnd.lsp.jar');
        fs.mkdirSync(path.dirname(local), { recursive: true });
        fs.writeFileSync(local, 'local');
        cacheJar('release', '7.5.0', 'biz.aQute.bnd.lsp-7.5.0.jar', 1_000_000);
        const resolved = resolveServerJar(context, config({ 'server.jar': local, 'server.jarSource': 'release' }), () => undefined);
        assert.strictEqual(resolved.path, local);
        assert.strictEqual(resolved.isLocalBuild, true);
    });

    test('warns about a missing bnd.server.jar instead of silently ignoring it', () => {
        const warnings: string[] = [];
        const resolved = resolveServerJar(context, config({ 'server.jar': path.join(tmp, 'missing.jar') }), m => warnings.push(m));
        assert.strictEqual(resolved.path, bundled);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /missing\.jar/);
    });

    test('starts with the bundled JAR while a remote JAR is not cached yet', () => {
        const resolved = resolveServerJar(context, config({ 'server.jarSource': 'snapshot' }), () => undefined);
        assert.strictEqual(resolved.path, bundled);
        assert.strictEqual(resolved.pending?.source, 'snapshot');
        assert.strictEqual(resolved.pending?.version, 'latest');
    });

    test('uses the newest cached JAR for latest and the exact one for a pinned version', () => {
        const older = cacheJar('snapshot', '7.5.0-SNAPSHOT', 'biz.aQute.bnd.lsp-7.5.0-20260901.101500-1.jar', 1_000_000);
        const newer = cacheJar('snapshot', '7.6.0-SNAPSHOT', 'biz.aQute.bnd.lsp-7.6.0-20260902.101500-1.jar', 2_000_000);
        const latest = resolveServerJar(context, config({ 'server.jarSource': 'snapshot' }), () => undefined);
        assert.strictEqual(latest.path, newer);
        assert.ok(latest.pending, 'latest still checks for updates in the background');
        const pinned = resolveServerJar(
            context,
            config({ 'server.jarSource': 'snapshot', 'server.jarVersion': '7.5.0-SNAPSHOT' }),
            () => undefined,
        );
        assert.strictEqual(pinned.path, older);
    });

    test('ignores partial downloads', () => {
        const dir = path.join(tmp, 'storage', 'library', 'lsp', 'release', '7.5.0');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'biz.aQute.bnd.lsp-7.5.0.jar.part'), 'partial');
        const settings = { source: 'release' as const, version: '7.5.0', url: '', sha256: '' };
        assert.strictEqual(findCachedServerJar(context, settings), undefined);
    });

    test('caches custom URLs per URL and rejects invalid URLs', () => {
        const url = 'https://example.org/a/biz.aQute.bnd.lsp.jar';
        const other = 'https://example.org/b/biz.aQute.bnd.lsp.jar';
        assert.notStrictEqual(customUrlVersion(url), customUrlVersion(other));
        const cached = cacheJar('custom', customUrlVersion(url), 'biz.aQute.bnd.lsp.jar', 1_000_000);
        assert.strictEqual(resolveServerJar(context, config({ 'server.jarSource': 'url', 'server.jarUrl': url }), () => undefined).path, cached);
        assert.strictEqual(resolveServerJar(context, config({ 'server.jarSource': 'url', 'server.jarUrl': other }), () => undefined).path, bundled);

        const warnings: string[] = [];
        const invalid = resolveServerJar(context, config({ 'server.jarSource': 'url', 'server.jarUrl': 'http://example.org/x.jar' }), m => warnings.push(m));
        assert.strictEqual(invalid.path, bundled);
        assert.strictEqual(invalid.pending, undefined);
        assert.strictEqual(warnings.length, 1);
    });
});

suite('Language server artifact handling', () => {
    test('resolves snapshot and listing JAR names for biz.aQute.bnd.lsp', () => {
        const xml = '<metadata><versioning><snapshot><timestamp>20260901.101500</timestamp><buildNumber>3</buildNumber></snapshot></versioning></metadata>';
        assert.strictEqual(
            parseSnapshotJarName(xml, '7.5.0-SNAPSHOT', 'biz.aQute.bnd.lsp'),
            'biz.aQute.bnd.lsp-7.5.0-20260901.101500-3.jar',
        );
        const html = '<a href="biz.aQute.bnd-7.5.0.jar">cli</a><a href="biz.aQute.bnd.lsp-7.5.0.jar">lsp</a>';
        assert.deepStrictEqual(parseJarNamesFromListing(html, 'biz.aQute.bnd.lsp'), ['biz.aQute.bnd.lsp-7.5.0.jar']);
        assert.deepStrictEqual(parseJarNamesFromListing(html), ['biz.aQute.bnd-7.5.0.jar']);
    });

    test('verifies SHA-1 and SHA-256 checksums', () => {
        const bytes = new TextEncoder().encode('jar');
        const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        assertChecksum(bytes, 'sha1', `${sha1.toUpperCase()}  biz.aQute.bnd.lsp.jar\n`, 'test');
        assertChecksum(bytes, 'sha256', sha256, 'test');
        assert.throws(() => assertChecksum(bytes, 'sha256', '0'.repeat(64), 'test'), /SHA256 mismatch/);
        assert.throws(() => assertChecksum(bytes, 'sha1', '', 'test'), /mismatch/);
    });
});
