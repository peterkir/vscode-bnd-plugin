import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { httpGet, httpGetText } from '../../bndHttp';
import {
    assertChecksum,
    BND_LSP_ARTIFACT,
    customSelection,
    downloadLibrary,
    fetchReleaseMetadata,
    fetchSnapshotVersions,
    cmdConfigureLibrary,
    ensureBndLibrary,
    libraryUri,
    pickReleaseVersion,
    pickSnapshotVersion,
    releaseSelection,
    snapshotSelection,
} from '../../bndLibrary';
import { Interaction } from './interaction';
import { downloadServerJar, findCachedServerJar, refreshServerJar, ServerJarSettings } from '../../serverJar';

interface Route {
    status?: number;
    body?: string | Buffer;
    headers?: Record<string, string>;
}

const jarBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('jar content')]);
const group = 'biz/aQute/bnd';

class FakeServer {
    readonly routes = new Map<string, Route>();
    readonly requests: http.IncomingMessage[] = [];
    private readonly server = http.createServer((request, response) => {
        this.requests.push(request);
        const route = this.routes.get(request.url ?? '');
        if (!route) {
            response.writeHead(404, 'Not Found').end();
            return;
        }
        response.writeHead(route.status ?? 200, route.headers).end(route.body);
    });
    url = '';

    async start(): Promise<this> {
        await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
        this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
        return this;
    }

    stop(): Promise<void> {
        this.server.closeAllConnections();
        return new Promise(resolve => this.server.close(() => resolve()));
    }
}

const noProxy = { proxySettings: { proxy: '' } };

suite('HTTP downloads', () => {
    let server: FakeServer;
    let savedEnv: NodeJS.ProcessEnv;

    suiteSetup(async () => {
        server = await new FakeServer().start();
    });
    suiteTeardown(() => server.stop());
    setup(() => {
        savedEnv = { ...process.env };
        delete process.env.HTTP_PROXY;
        delete process.env.http_proxy;
        delete process.env.NO_PROXY;
        delete process.env.no_proxy;
        server.routes.clear();
        server.requests.length = 0;
    });
    teardown(() => {
        process.env = savedEnv;
    });

    test('returns the body and logs a direct request', async () => {
        server.routes.set('/a.txt', { body: 'hello' });
        const lines: string[] = [];
        assert.strictEqual(await httpGetText(`${server.url}/a.txt`, { ...noProxy, log: line => lines.push(line) }), 'hello');
        assert.deepStrictEqual(lines, [`GET ${server.url}/a.txt (direct)`]);
        assert.strictEqual(server.requests[0].headers['user-agent'], 'vscode-bnd');
    });

    test('follows relative redirects and gives up after five', async () => {
        server.routes.set('/old', { status: 302, headers: { Location: '/new' } });
        server.routes.set('/new', { body: 'moved' });
        assert.strictEqual(await httpGetText(`${server.url}/old`, noProxy), 'moved');

        server.routes.set('/loop', { status: 302, headers: { Location: '/loop' } });
        await assert.rejects(httpGet(`${server.url}/loop`, noProxy), /Too many redirects/);
    });

    test('rejects error statuses and unreachable servers', async () => {
        await assert.rejects(httpGet(`${server.url}/missing`, noProxy), /Request failed with 404/);
        const closed = await new FakeServer().start();
        const closedUrl = closed.url;
        await closed.stop();
        await assert.rejects(httpGet(`${closedUrl}/x`, noProxy), /ECONNREFUSED/);
    });

    test('logs and reports the configured proxy when it cannot be reached', async () => {
        const closed = await new FakeServer().start();
        const proxy = closed.url;
        await closed.stop();
        const lines: string[] = [];
        await assert.rejects(
            httpGet('http://example.invalid/x', { proxySettings: { proxy, authorization: 'Basic abc' }, log: line => lines.push(line) }),
            new RegExp(`proxy ${proxy}`));
        assert.deepStrictEqual(lines, [`GET http://example.invalid/x via proxy ${proxy}`]);
    });

    test('reads the VS Code proxy settings when none are passed', async () => {
        server.routes.set('/settings.txt', { body: 'direct' });
        assert.strictEqual(await httpGetText(`${server.url}/settings.txt`), 'direct');
    });
});

suite('bnd library downloads', function () {
    let server: FakeServer;
    let storage: string;
    const settings = vscode.workspace.getConfiguration('bnd');
    const saved = {
        release: settings.inspect<string>('cli.mavenRepository')?.globalValue,
        snapshot: settings.inspect<string>('cli.snapshotRepository')?.globalValue,
    };
    const context = () => ({
        globalStorageUri: vscode.Uri.file(storage),
        asAbsolutePath: (relative: string) => path.join(storage, relative),
    }) as unknown as vscode.ExtensionContext;
    const metadata = (versions: string[], release = versions[versions.length - 1]) =>
        `<metadata><versioning><release>${release}</release><versions>${versions.map(v => `<version>${v}</version>`).join('')}</versions></versioning></metadata>`;
    const artifactPath = (artifact = 'biz.aQute.bnd') => `/${group}/${artifact}`;

    suiteSetup(async () => {
        server = await new FakeServer().start();
        await settings.update('cli.mavenRepository', `${server.url}/release/`, vscode.ConfigurationTarget.Global);
        await settings.update('cli.snapshotRepository', `${server.url}/snapshot/`, vscode.ConfigurationTarget.Global);
    });
    suiteTeardown(async () => {
        await settings.update('cli.mavenRepository', saved.release, vscode.ConfigurationTarget.Global);
        await settings.update('cli.snapshotRepository', saved.snapshot, vscode.ConfigurationTarget.Global);
        await server.stop();
    });
    setup(() => {
        server.routes.clear();
        server.requests.length = 0;
        storage = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-library-'));
    });
    teardown(() => fs.rmSync(storage, { recursive: true, force: true }));

    test('checks hashes, ignoring case and a trailing file name', () => {
        const sha1 = crypto.createHash('sha1').update(jarBytes).digest('hex');
        assertChecksum(jarBytes, 'sha1', `${sha1.toUpperCase()}  file.jar\n`, 'x');
        assert.throws(() => assertChecksum(jarBytes, 'sha1', '', 'x'), /SHA1 mismatch for x: expected <empty>/);
        assert.throws(() => assertChecksum(jarBytes, 'sha256', sha1, 'x'), /SHA256 mismatch/);
    });

    test('builds release and custom selections and their storage locations', () => {
        const release = releaseSelection('7.3.0');
        assert.strictEqual(release.url, `${server.url}/release${artifactPath()}/7.3.0/biz.aQute.bnd-7.3.0.jar`);
        assert.ok(libraryUri(context(), release).fsPath.endsWith(path.join('library', 'tool', 'release', '7.3.0', 'biz.aQute.bnd-7.3.0.jar')));
        const custom = customSelection('https://example.org/dir/my%20bnd.jar');
        assert.deepStrictEqual([custom.fileName, custom.version, custom.kind], ['my bnd.jar', 'my bnd', 'custom']);
    });

    test('fetches release metadata without snapshots', async () => {
        server.routes.set(`/release${artifactPath()}/maven-metadata.xml`, { body: metadata(['7.2.0', '7.3.0-SNAPSHOT', '7.3.0'], '7.3.0') });
        assert.deepStrictEqual(await fetchReleaseMetadata(), { latest: '7.3.0', versions: ['7.2.0', '7.3.0'] });
    });

    test('explains why release metadata is unavailable or empty', async () => {
        await assert.rejects(fetchReleaseMetadata(), /No biz\.aQute\.bnd releases available from .*Request failed with 404/);
        server.routes.set(`/release${artifactPath()}/maven-metadata.xml`, { body: '<metadata/>' });
        await assert.rejects(fetchReleaseMetadata(), /No biz\.aQute\.bnd releases found/);
    });

    test('lists snapshot versions from the metadata or, failing that, the directory listing', async () => {
        const base = `/snapshot${artifactPath()}`;
        server.routes.set(`${base}/maven-metadata.xml`, { body: metadata(['7.3.0-SNAPSHOT', '7.2.0']) });
        assert.deepStrictEqual(await fetchSnapshotVersions(), ['7.3.0-SNAPSHOT']);

        server.routes.set(`${base}/maven-metadata.xml`, { body: metadata(['7.2.0']) });
        server.routes.set(`${base}/`, { body: '<a href="7.4.0-SNAPSHOT/">7.4.0-SNAPSHOT/</a><a href="7.1.0/">7.1.0/</a>' });
        assert.deepStrictEqual(await fetchSnapshotVersions(), ['7.4.0-SNAPSHOT']);
    });

    test('resolves the timestamped snapshot JAR from metadata or from the listing', async () => {
        const base = `/snapshot${artifactPath()}/7.4.0-SNAPSHOT`;
        server.routes.set(`${base}/maven-metadata.xml`, {
            body: `<metadata><versioning><snapshot><timestamp>20260101.101010</timestamp><buildNumber>5</buildNumber></snapshot>
                <snapshotVersions><snapshotVersion><extension>jar</extension><value>7.4.0-20260101.101010-5</value></snapshotVersion></snapshotVersions></versioning></metadata>`,
        });
        assert.strictEqual((await snapshotSelection('7.4.0-SNAPSHOT')).fileName, 'biz.aQute.bnd-7.4.0-20260101.101010-5.jar');

        server.routes.delete(`${base}/maven-metadata.xml`);
        server.routes.set(`${base}/`, { body: '<a href="biz.aQute.bnd-7.4.0-20260101.101010-5.jar">x</a><a href="biz.aQute.bnd-7.4.0-20260102.101010-6.jar">y</a>' });
        const selection = await snapshotSelection('7.4.0-SNAPSHOT');
        assert.strictEqual(selection.fileName, 'biz.aQute.bnd-7.4.0-20260102.101010-6.jar');
        assert.strictEqual(selection.url, `${server.url}${base}/${selection.fileName}`);

        server.routes.set(`${base}/`, { body: 'nothing here' });
        await assert.rejects(snapshotSelection('7.4.0-SNAPSHOT'), /No JAR found for snapshot version/);
    });

    test('downloads a JAR once, verifies it and reuses the cached file', async () => {
        server.routes.set('/dl/x.jar', { body: jarBytes });
        const selection = { ...customSelection(`${server.url}/dl/x.jar`), sha256: crypto.createHash('sha256').update(jarBytes).digest('hex') };
        const target = await downloadLibrary(context(), selection);
        assert.deepStrictEqual(fs.readFileSync(target.fsPath), jarBytes);
        assert.ok(!fs.existsSync(`${target.fsPath}.part`), 'no partial file may remain');

        server.requests.length = 0;
        assert.strictEqual((await downloadLibrary(context(), selection)).fsPath, target.fsPath);
        assert.strictEqual(server.requests.length, 0, 'a cached JAR must not be downloaded again');
    });

    test('rejects downloads that are not a JAR or fail the checksum', async () => {
        server.routes.set('/dl/bad.jar', { body: 'not a jar' });
        await assert.rejects(downloadLibrary(context(), customSelection(`${server.url}/dl/bad.jar`)), /is not a JAR archive/);

        server.routes.set('/dl/x.jar', { body: jarBytes });
        await assert.rejects(downloadLibrary(context(), { ...customSelection(`${server.url}/dl/x.jar`), sha256: '00' }), /SHA256 mismatch/);
        server.routes.set('/dl/x.jar.sha1', { body: 'deadbeef' });
        await assert.rejects(downloadLibrary(context(), { ...customSelection(`${server.url}/dl/x.jar`), sha1Url: `${server.url}/dl/x.jar.sha1` }), /SHA1 mismatch/);
        assert.ok(!fs.existsSync(path.join(storage, 'library')), 'a rejected download must not be stored');
    });

    test('accepts a matching SHA-1 file', async () => {
        server.routes.set('/dl/x.jar', { body: jarBytes });
        server.routes.set('/dl/x.jar.sha1', { body: `${crypto.createHash('sha1').update(jarBytes).digest('hex')}  x.jar` });
        const target = await downloadLibrary(context(), { ...customSelection(`${server.url}/dl/x.jar`), sha1Url: `${server.url}/dl/x.jar.sha1` });
        assert.ok(fs.existsSync(target.fsPath));
    });

    suite('pickers and commands', () => {
        const workspaceSettings = path.resolve(__dirname, '../../../../.vscode/settings.json');
        let ui: Interaction;
        let hadWorkspaceSettings: boolean;
        let savedExecutable: string | undefined;

        setup(() => {
            hadWorkspaceSettings = fs.existsSync(workspaceSettings);
            savedExecutable = vscode.workspace.getConfiguration('bnd').inspect<string>('cli.executable')?.globalValue;
            ui = new Interaction();
            ui.install();
        });
        teardown(async () => {
            ui.restore();
            const config = vscode.workspace.getConfiguration('bnd');
            // Configuring the library writes to the workspace settings of the opened folder, which is this repository.
            await config.update('cli.executable', undefined, vscode.ConfigurationTarget.Workspace);
            if (!hadWorkspaceSettings) fs.rmSync(workspaceSettings, { force: true });
            await config.update('cli.executable', savedExecutable, vscode.ConfigurationTarget.Global);
        });

        test('lists release versions newest first and accepts a typed version', async () => {
            server.routes.set(`/release${artifactPath()}/maven-metadata.xml`, { body: metadata(['7.1.0', '7.2.0', '7.3.0']) });
            let labels: string[] = [];
            ui.picks.push(items => { labels = items.map((item: { label: string }) => item.label); return items[1]; });
            assert.strictEqual(await pickReleaseVersion({ offerTrackLatest: true }), '7.3.0');
            assert.deepStrictEqual(labels, ['latest', '7.3.0', '7.2.0', '7.1.0', 'Enter another version...']);

            ui.picks.push(items => items[items.length - 1]);
            ui.inputs.push('9.9.9');
            assert.strictEqual(await pickReleaseVersion(), '9.9.9');
            ui.picks.push(() => undefined);
            assert.strictEqual(await pickReleaseVersion(), undefined);
        });

        test('lists snapshot versions newest first and rejects an empty list', async () => {
            const base = `/snapshot${artifactPath()}`;
            server.routes.set(`${base}/maven-metadata.xml`, { body: metadata(['7.3.0-SNAPSHOT', '7.4.0-SNAPSHOT']) });
            ui.picks.push(items => items[0]);
            assert.strictEqual(await pickSnapshotVersion({ offerTrackLatest: true }), 'latest');
            ui.picks.push(items => items[0]);
            assert.strictEqual(await pickSnapshotVersion(), '7.4.0-SNAPSHOT');

            server.routes.set(`${base}/maven-metadata.xml`, { body: metadata(['1.0.0']) });
            server.routes.set(`${base}/`, { body: '' });
            await assert.rejects(pickSnapshotVersion(), /No biz\.aQute\.bnd snapshot versions found/);
        });

        test('configures the bnd library from a custom URL and reports failures', async () => {
            server.routes.set('/dl/custom.jar', { body: jarBytes });
            ui.picks.push(items => items.find((item: { label: string }) => item.label === 'Custom URL...'));
            ui.inputs.push(`${server.url}/dl/custom.jar`);
            await cmdConfigureLibrary(context());
            const executable = vscode.workspace.getConfiguration('bnd').get<string>('cli.executable', '');
            assert.ok(executable.includes('-jar') && executable.includes('custom.jar'), executable);
            assert.ok(ui.messages.some(message => message.startsWith('Configured bnd CLI custom')), JSON.stringify(ui.messages));

            ui.messages.length = 0;
            ui.picks.push(items => items.find((item: { label: string }) => item.label === 'Custom URL...'));
            ui.inputs.push(`${server.url}/dl/missing.jar`);
            await cmdConfigureLibrary(context());
            assert.ok(ui.messages.some(message => message.startsWith('Failed to configure bnd library')), JSON.stringify(ui.messages));

            ui.messages.length = 0;
            ui.picks.push(() => undefined);
            await cmdConfigureLibrary(context());
            assert.deepStrictEqual(ui.messages, []);
        });

        test('keeps a user-provided CLI and provisions the latest release when none is configured', async () => {
            const config = vscode.workspace.getConfiguration('bnd');
            await config.update('cli.executable', 'my-own-bnd', vscode.ConfigurationTarget.Global);
            await ensureBndLibrary(context());
            assert.strictEqual(server.requests.length, 0, 'a user-provided executable must not be replaced');

            await config.update('cli.executable', undefined, vscode.ConfigurationTarget.Global);
            server.routes.set(`/release${artifactPath()}/maven-metadata.xml`, { body: metadata(['7.2.0']) });
            server.routes.set(`/release${artifactPath()}/7.2.0/biz.aQute.bnd-7.2.0.jar`, { body: jarBytes });
            await ensureBndLibrary(context());
            assert.match(vscode.workspace.getConfiguration('bnd').get<string>('cli.executable', ''), /biz\.aQute\.bnd-7\.2\.0\.jar/);

            server.routes.clear();
            await config.update('cli.executable', undefined, vscode.ConfigurationTarget.Workspace);
            await ensureBndLibrary(context());
        });
    });

    suite('language server JAR', () => {
        const release = (version: string): ServerJarSettings => ({ source: 'release', version, url: '', sha256: '' });
        const lsp = BND_LSP_ARTIFACT.artifactId;
        const serveRelease = (version: string) => {
            const jarUrl = `/release/${group}/${lsp}/${version}/${lsp}-${version}.jar`;
            server.routes.set(jarUrl, { body: jarBytes });
            server.routes.set(`${jarUrl}.sha1`, { body: crypto.createHash('sha1').update(jarBytes).digest('hex') });
        };

        test('downloads the latest release and finds it in the cache afterwards', async () => {
            server.routes.set(`/release/${group}/${lsp}/maven-metadata.xml`, { body: metadata(['7.5.0', '7.6.0']) });
            serveRelease('7.6.0');
            assert.strictEqual(findCachedServerJar(context(), release('latest')), undefined);
            const [first, second] = await Promise.all([
                downloadServerJar(context(), release('latest')),
                downloadServerJar(context(), release('latest')),
            ]);
            assert.strictEqual(first, second, 'concurrent requests share one download');
            assert.strictEqual(findCachedServerJar(context(), release('latest')), first);
            assert.strictEqual(findCachedServerJar(context(), release('7.6.0')), first);
            assert.strictEqual(findCachedServerJar(context(), release('7.5.0')), undefined);
        });

        test('downloads a pinned snapshot and a custom URL', async () => {
            const base = `/snapshot/${group}/${lsp}`;
            server.routes.set(`${base}/maven-metadata.xml`, { body: metadata(['7.7.0-SNAPSHOT']) });
            server.routes.set(`${base}/7.7.0-SNAPSHOT/`, { body: `<a href="${lsp}-7.7.0-20260101.101010-1.jar">j</a>` });
            const jar = `${base}/7.7.0-SNAPSHOT/${lsp}-7.7.0-20260101.101010-1.jar`;
            server.routes.set(jar, { body: jarBytes });
            server.routes.set(`${jar}.sha1`, { body: crypto.createHash('sha1').update(jarBytes).digest('hex') });
            const snapshot = await downloadServerJar(context(), { ...release('latest'), source: 'snapshot' });
            assert.ok(snapshot.endsWith(`${lsp}-7.7.0-20260101.101010-1.jar`));

            server.routes.set('/custom/server.jar', { body: jarBytes });
            const url = `${server.url}/custom/server.jar`;
            await assert.rejects(downloadServerJar(context(), { source: 'url', version: 'latest', url, sha256: '' }), /Invalid bnd\.server\.jarUrl/);
            await assert.rejects(downloadServerJar(context(), { source: 'bundled', version: 'latest', url: '', sha256: '' }), /needs no download/);
        });

        test('reports missing snapshot versions', async () => {
            const base = `/snapshot/${group}/${lsp}`;
            server.routes.set(`${base}/maven-metadata.xml`, { body: metadata(['1.0.0']) });
            server.routes.set(`${base}/`, { body: '' });
            await assert.rejects(downloadServerJar(context(), { ...release('latest'), source: 'snapshot' }), /No biz\.aQute\.bnd\.lsp snapshot versions found/);
        });

        test('stays silent when the launched JAR is already current and survives a failed refresh', async () => {
            server.routes.set(`/release/${group}/${lsp}/maven-metadata.xml`, { body: metadata(['7.6.0']) });
            serveRelease('7.6.0');
            const jar = await downloadServerJar(context(), release('latest'));
            await refreshServerJar(context(), release('latest'), jar);

            server.routes.clear();
            await refreshServerJar(context(), release('9.9.9'), jar);
        });
    });
});
