import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Executable, LanguageClient } from 'vscode-languageclient/node';
import {
    RepoNode,
    RepositoriesProvider,
    RepositoriesServer,
    entryFor,
    formatDropText,
    formatEntry,
    packageFilter,
    parseActionLabel,
    repositoriesListCommand,
    serviceFilter,
    versionRangeFilter,
} from '../../bndRepositories';
import { executeServerCommand } from '../../extension';

const repo = {
    index: 1, name: 'Local', kind: 'plugin' as const, writable: true, remote: false, refreshable: true,
    actionable: true, searchable: false, p2: false, tags: [],
};

suite('Repositories view', () => {
    test('builds requirement filters like the bndtools advanced search', () => {
        assert.strictEqual(packageFilter('org.example'), '(osgi.wiring.package=org.example)');
        assert.strictEqual(packageFilter('org.example', '[1.0,2.0)'),
            '(&(osgi.wiring.package=org.example)(version>=1.0)(!(version>=2.0)))');
        assert.strictEqual(versionRangeFilter('(1,2]'), '(!(version<=1))(version<=2)');
        assert.strictEqual(versionRangeFilter('1.2'), '(version>=1.2)');
        assert.strictEqual(versionRangeFilter(''), undefined);
        assert.throws(() => versionRangeFilter('nonsense'), /Invalid version range/);
        assert.strictEqual(serviceFilter('a.B(x)'), '(objectClass=a.B\\(x\\))');
    });

    test('parses Actionable labels with submenus, state and description', () => {
        assert.deepStrictEqual(parseActionLabel('-!Copy :: Info{Copies info}'), {
            label: '-!Copy :: Info{Copies info}', path: ['Copy', 'Info'], enabled: false, checked: true, description: 'Copies info',
        });
        assert.deepStrictEqual(parseActionLabel('Refresh').path, ['Refresh']);
        assert.strictEqual(parseActionLabel('Refresh').enabled, true);
    });

    test('formats copied and dropped bnd entries', () => {
        const version: RepoNode = { type: 'version', ws: 'file:///ws', repo, bsn: 'a.b', info: { version: '1.2.3' } };
        const bundle: RepoNode = { type: 'bundle', ws: 'file:///ws', repo, bundle: { bsn: 'c.d' } };
        const project: RepoNode = { type: 'bundle', ws: 'file:///ws', repo: { ...repo, kind: 'workspace' }, bundle: { bsn: 'p' } };
        assert.strictEqual(formatEntry(entryFor(version)!), "a.b;version='1.2.3'");
        assert.strictEqual(formatEntry(entryFor(bundle)!), 'c.d;version=latest');
        assert.strictEqual(formatEntry(entryFor(project)!), 'p;version=snapshot');
        assert.strictEqual(entryFor({ type: 'message', label: 'x' }), undefined);
        const entries = [entryFor(version)!, entryFor(bundle)!];
        assert.strictEqual(formatDropText(entries, '', '-buildpath: \\'), "\ta.b;version='1.2.3',\\\n\tc.d;version=latest");
        assert.strictEqual(formatDropText(entries, 'x', ''), "a.b;version='1.2.3',\\\n\tc.d;version=latest");
    });

    test('reports unsupported servers and builds tree levels from server responses', async () => {
        const states: Record<string, unknown>[] = [];
        const calls: string[] = [];
        let supported = false;
        const server: RepositoriesServer = {
            supports: async () => supported,
            execute: async (command, args) => {
                calls.push(command);
                const request = args[0] as Record<string, unknown>;
                switch (command) {
                    case repositoriesListCommand:
                        return { offline: true, repositories: [{ ...repo, index: 0, name: 'ws', kind: 'workspace', writable: false }, repo] };
                    case 'bnd.repositories.bundles':
                        return request.repo === 0
                            ? { bundles: [{ bsn: 'p.api', project: 'p' }, { bsn: 'p.impl', project: 'p' }], features: [] }
                            : { bundles: [{ bsn: 'z' }, { bsn: 'a' }], features: [{ id: 'f', version: '1.0.0' }] };
                    case 'bnd.repositories.versions':
                        return { versions: [{ version: '2.0.0' }, { version: '1.0.0' }] };
                    case 'bnd.repositories.search':
                        return { results: [{ repo: 1, repoName: 'Local', bsn: 'a', version: '1.0.0' },
                            { repo: 1, repoName: 'Local', bsn: 'f', version: '1.0.0', type: 'org.eclipse.update.feature' }] };
                    case 'bnd.repositories.feature':
                        return { includes: [{ id: 'nested', version: '2.0.0', optional: true }],
                            plugins: [{ id: 'plugin', version: '1.0.0' }],
                            requires: [{ id: 'required', type: 'feature', filter: '(osgi.identity=required)' }] };
                    default:
                        return { error: `unexpected ${command}` };
                }
            },
        };
        const root = vscode.Uri.file(path.join(os.tmpdir(), 'bnd-ws'));
        const provider = new RepositoriesProvider(server, async () => [root], state => states.push(state), async () => true);
        try {
            assert.deepStrictEqual(await provider.getChildren(), []);
            assert.ok(states.some(state => state['bnd.repositories.state'] === 'unsupported'));
            supported = true;
            const [workspace] = await provider.getChildren();
            assert.strictEqual(workspace.type, 'workspace');
            assert.strictEqual(provider.getTreeItem(workspace).contextValue, 'workspaceRoot');
            const repos = await provider.getChildren(workspace);
            assert.strictEqual(provider.isOffline, true);
            assert.deepStrictEqual(repos.map(node => node.type), ['repo', 'repo']);
            assert.strictEqual(provider.getTreeItem(repos[1]).contextValue, 'repo writable refreshable actionable');
            const projects = await provider.getChildren(repos[0]);
            assert.strictEqual(projects.length, 1);
            assert.strictEqual((await provider.getChildren(projects[0])).length, 2);
            const bundles = await provider.getChildren(repos[1]);
            assert.deepStrictEqual(bundles.map(node => node.type === 'bundle' ? node.bundle.bsn : node.type), ['a', 'z', 'feature']);
            assert.strictEqual(provider.getTreeItem(bundles[0]).command?.command, 'bnd.repositories.openJar');
            const versions = await provider.getChildren(bundles[0]);
            assert.deepStrictEqual(versions.map(node => provider.getTreeItem(node).label), ['2.0.0', '1.0.0']);
            assert.strictEqual(provider.getTreeItem(versions[0]).command?.command, 'bnd.repositories.openJar');

            provider.setFilter('a');
            assert.strictEqual(provider.filter, 'a');
            provider.setSearch({ namespace: 'osgi.wiring.package', filter: '(osgi.wiring.package=x)', label: 'package x' });
            assert.strictEqual(provider.filter, undefined);
            const searched = await provider.getChildren(workspace);
            assert.strictEqual(searched.length, 1);
            const hits = await provider.getChildren(searched[0]);
            assert.strictEqual(provider.getTreeItem(hits[0]).label, 'a');
            assert.strictEqual(hits[1].type, 'feature');
            assert.strictEqual(provider.getTreeItem(hits[1]).command, undefined);
            const groups = await provider.getChildren(hits[1]);
            assert.deepStrictEqual(groups.map(group => provider.getTreeItem(group).label),
                ['Included Features', 'Included Bundles', 'Required']);
            const [included] = await provider.getChildren(groups[0]);
            assert.match(String(provider.getTreeItem(included).tooltip), /Optional/);
            const [required] = await provider.getChildren(groups[2]);
            assert.match(String(provider.getTreeItem(required).tooltip), /\(osgi.identity=required\)/);
            assert.ok(calls.includes('bnd.repositories.search'));

            const failing = new RepositoriesProvider({ supports: async () => true, execute: async () => ({ error: 'boom' }) },
                async () => [root], undefined, async () => true);
            const [failingRoot] = await failing.getChildren();
            const [message] = await failing.getChildren(failingRoot);
            assert.deepStrictEqual(message, { type: 'message', label: 'boom', error: true });
            failing.dispose();
        } finally {
            provider.dispose();
        }
    });

    test('clears deleted workspaces and ignores stale cached tree nodes', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-deleted-workspace-'));
        const root = vscode.Uri.file(directory);
        fs.mkdirSync(path.join(directory, 'cnf'));
        fs.writeFileSync(path.join(directory, 'cnf', 'build.bnd'), '');
        const states: Record<string, unknown>[] = [];
        let calls = 0;
        const provider = new RepositoriesProvider({
            supports: async () => true,
            execute: async () => {
                calls++;
                return { offline: true, repositories: [repo] };
            },
        }, async () => fs.existsSync(path.join(directory, 'cnf', 'build.bnd')) ? [root] : [], state => states.push(state));
        try {
            const [workspace] = await provider.getChildren();
            const [repository] = await provider.getChildren(workspace);
            assert.strictEqual(provider.isOffline, true);
            fs.rmSync(path.join(directory, 'cnf'), { recursive: true });
            assert.deepStrictEqual(await provider.getChildren(repository), []);
            assert.deepStrictEqual(await provider.getChildren(workspace), []);
            assert.deepStrictEqual(await provider.getChildren(), []);
            assert.strictEqual(calls, 1);
            assert.strictEqual(provider.isOffline, false);
            assert.deepStrictEqual(provider.workspaces, []);
            assert.ok(states.some(state => state['bnd.repositories.state'] === 'empty'));
            fs.rmSync(directory, { recursive: true });
            assert.deepStrictEqual(await provider.getChildren(workspace), []);
        } finally {
            provider.dispose();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    test('discards a repository response when its workspace is deleted during the request', async () => {
        let available = true;
        const root = vscode.Uri.file(path.join(os.tmpdir(), 'bnd-deleted-in-flight'));
        const provider = new RepositoriesProvider({
            supports: async () => true,
            execute: async () => {
                available = false;
                return { error: `Not a bnd workspace: ${root}` };
            },
        }, async () => available ? [root] : [], undefined, async () => available);
        try {
            const [workspace] = await provider.getChildren();
            assert.deepStrictEqual(await provider.getChildren(workspace), []);
            assert.deepStrictEqual(provider.workspaces, []);
        } finally {
            provider.dispose();
        }
    });

    test('registers view commands on activation', async () => {
        const extension = vscode.extensions.getExtension('klibio.bnd')!;
        await extension.activate();
        const commands = await vscode.commands.getCommands(true);
        for (const command of ['bnd.repositories.refresh', 'bnd.repositories.filter', 'bnd.repositories.advancedSearch',
            'bnd.repositories.goOffline', 'bnd.repositories.addFiles', 'bnd.repositories.actions', 'bnd.repositories.openJar']) {
            assert.ok(commands.includes(command), `Missing ${command}`);
        }
    });

    test('browses, adds and downloads bundles through the bundled Java language server', async function () {
        this.timeout(120000);
        const jar = path.resolve(__dirname, '../../../../server/biz.aQute.bnd.lsp.jar');
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-repositories-'));
        fs.mkdirSync(path.join(temporary, 'cnf', 'local'), { recursive: true });
        fs.writeFileSync(path.join(temporary, 'cnf', 'build.bnd'),
                        '-plugin.local: aQute.lib.deployer.FileRepo;name=Local;location=${build}/local\n' +
                        '-plugin.indexed: aQute.bnd.repository.osgi.OSGiRepository;name=Indexed;locations="' +
                        vscode.Uri.file(path.join(temporary, 'cnf', 'features.xml')).toString() + '"\n');
                fs.writeFileSync(path.join(temporary, 'cnf', 'features.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<repository xmlns="http://www.osgi.org/xmlns/repository/v1.0.0" name="Features">
    <resource>
        <capability namespace="osgi.identity">
            <attribute name="osgi.identity" value="test.feature"/>
            <attribute name="version" type="Version" value="1.2.3"/>
            <attribute name="type" value="org.eclipse.update.feature"/>
            <attribute name="label" value="Indexed Feature"/>
        </capability>
        <requirement namespace="osgi.identity">
            <attribute name="bnd.relation" value="plugin"/>
            <directive name="filter" value="(osgi.identity=test.bundle)"/>
        </requirement>
        <requirement namespace="osgi.identity">
            <attribute name="bnd.relation" value="include"/>
            <directive name="filter" value="(&amp;(osgi.identity=test.included)(type=org.eclipse.update.feature))"/>
            <directive name="resolution" value="optional"/>
        </requirement>
    </resource>
</repository>`);
        fs.mkdirSync(path.join(temporary, 'p'));
        fs.writeFileSync(path.join(temporary, 'p', 'bnd.bnd'), 'Bundle-Version: 1.0.0\n');
        const executable: Executable = { command: 'java', args: ['-jar', jar], options: { env: process.env } };
        const client = new LanguageClient('testBndRepositories', 'Test bnd Repositories', { run: executable, debug: executable }, {
            documentSelector: [{ scheme: 'file', language: 'bnd' }],
            initializationOptions: { workspaceTrusted: true },
            outputChannel: vscode.window.createOutputChannel('Test bnd Repositories', { log: true }),
        });
        client.getFeature('workspace/executeCommand').initialize = () => {};
        const server: RepositoriesServer = {
            supports: async command => client.initializeResult?.capabilities.executeCommandProvider?.commands.includes(command) ?? false,
            execute: (command, args, token) => executeServerCommand(client, command, args, token),
        };
        const provider = new RepositoriesProvider(server, async () => [vscode.Uri.file(temporary)]);
        try {
            await client.start();
            const [workspace] = await provider.getChildren();
            const repos = await provider.getChildren(workspace);
            const cache = repos.find(node => node.type === 'repo' && node.repo.name === 'bnd-cache');
            assert.ok(cache && cache.type === 'repo', 'Expected built-in bnd-cache repository');
            const cachedBundles = await provider.getChildren(cache);
            assert.ok(cachedBundles.some(node => node.type === 'bundle' && node.bundle.bsn === 'biz.aQute.launcher'),
                'Bundled server must unpack its embedded repository, not leave bnd-cache empty');
            const cacheRoot = path.join(temporary, 'cnf', 'cache');
            assert.ok(fs.readdirSync(cacheRoot).some(version =>
                fs.existsSync(path.join(cacheRoot, version, 'bnd-cache', 'biz.aQute.launcher'))),
            'Launcher bundle must be extracted into the versioned workspace cache');
            const local = repos.find(node => node.type === 'repo' && node.repo.name === 'Local');
            assert.ok(local && local.type === 'repo', 'Expected Local repository');
            const indexed = repos.find(node => node.type === 'repo' && node.repo.name === 'Indexed');
            assert.ok(indexed && indexed.type === 'repo', 'Expected OSGi indexed repository');
            assert.strictEqual(indexed.repo.p2, false);
            const indexedEntries = await provider.getChildren(indexed);
            const feature = indexedEntries.find(node => node.type === 'feature' && node.feature.id === 'test.feature');
            assert.ok(feature && feature.type === 'feature', `Expected indexed feature, got ${JSON.stringify(indexedEntries)}`);
            assert.strictEqual(feature.feature.version, '1.2.3');
            assert.ok(!indexedEntries.some(node => node.type === 'bundle' && node.bundle.bsn === 'test.feature'));
            const featureGroups = await provider.getChildren(feature);
            const plugins = featureGroups.find(group => group.type === 'featureGroup' && group.label === 'Included Bundles')!;
            const [plugin] = await provider.getChildren(plugins);
            assert.strictEqual(provider.getTreeItem(plugin).label, 'test.bundle');
            const includes = featureGroups.find(group => group.type === 'featureGroup' && group.label === 'Included Features')!;
            const [included] = await provider.getChildren(includes);
            assert.strictEqual(provider.getTreeItem(included).label, 'test.included');
            assert.match(String(provider.getTreeItem(included).tooltip), /Optional/);
            provider.setSearch({ namespace: 'osgi.identity', filter: '(type=org.eclipse.update.feature)', label: 'Features' });
            const searchRepos = await provider.getChildren(workspace);
            const [featureHit] = await provider.getChildren(searchRepos.find(node => node.type === 'repo' && node.repo.name === 'Indexed')!);
            assert.strictEqual(featureHit.type, 'feature');
            assert.strictEqual((await provider.getChildren(featureHit)).length, 2);
            provider.setSearch(undefined);
            assert.strictEqual(provider.getTreeItem(local).contextValue, 'repo writable refreshable actionable');
            const projectRepo = repos.find(node => node.type === 'repo' && node.repo.kind === 'workspace')!;
            const [project] = await provider.getChildren(projectRepo);
            assert.strictEqual(project.type === 'project' && project.name, 'p');

            const added = await provider.execute('bnd.repositories.put',
                provider.repoRequest(local, { files: [vscode.Uri.file(jar).toString()] }));
            assert.strictEqual((added.added as unknown[]).length, 1);
            const bundles = await provider.getChildren(local);
            const bundle = bundles.find(node => node.type === 'bundle' && node.bundle.bsn === 'biz.aQute.bnd.lsp');
            assert.ok(bundle, `Expected added bundle, got ${JSON.stringify(bundles)}`);
            const [version] = await provider.getChildren(bundle);
            assert.strictEqual(version.type, 'version');
            if (version.type !== 'version') return;
            const file = await provider.execute('bnd.repositories.get', provider.repoRequest(version, { bsn: version.bsn, version: version.info.version }));
            assert.ok(fs.existsSync(file.file as string));
            const downloaded = await provider.execute('bnd.repositories.fetch', provider.repoRequest(local));
            assert.deepStrictEqual(downloaded.errors, []);
            const actions = await provider.execute('bnd.repositories.listActions', provider.repoRequest(local));
            assert.ok(Array.isArray(actions.actions));

            provider.setFilter('nomatch');
            assert.deepStrictEqual(await provider.getChildren(local), [{ type: 'message', label: 'No matches.' }]);
            provider.setFilter(undefined);

            const offline = await provider.execute('bnd.workspace.offline', { workspace: workspace.type === 'workspace' ? workspace.ws : '', offline: true });
            assert.strictEqual(offline.offline, true);
        } finally {
            provider.dispose();
            await client.stop();
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});
