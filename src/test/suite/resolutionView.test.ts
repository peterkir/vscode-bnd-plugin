import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Executable, LanguageClient } from 'vscode-languageclient/node';
import { executeServerCommand } from '../../extension';
import { filterResolutionRows, formatResolutionRow, ResolutionRow, resolutionAnalyzeCommand, ResolutionViewProvider } from '../../resolutionView';
import { RepoInfo, RepoNode, RepositoriesProvider, RepositoriesDragAndDrop, resolutionEntriesFor,
    resolutionEntryMime, repositoryEntryMime } from '../../bndRepositories';

suite('Resolution View', () => {
    const rows: ResolutionRow[] = [
        {
            source: 'consumer.jar',
            namespace: 'osgi.wiring.package',
            attributes: { 'osgi.wiring.package': 'demo.api', version: '1.2.0' },
            directives: { filter: '(&(osgi.wiring.package=demo.api)(version>=1.0.0))' },
            optional: false,
            resolved: false,
        },
        {
            source: 'consumer.jar',
            namespace: 'osgi.wiring.package',
            attributes: { 'osgi.wiring.package': 'demo.internal' },
            directives: { resolution: 'optional' },
            optional: true,
            resolved: true,
        },
    ];

    test('filters with wildcard multi-term search and requirement toggles', () => {
        assert.strictEqual(filterResolutionRows(rows, 'osgi.wiring.package demo.api').length, 1);
        assert.strictEqual(filterResolutionRows(rows, 'demo.*').length, 2);
        assert.strictEqual(filterResolutionRows(rows, '', true).length, 1);
        assert.strictEqual(filterResolutionRows(rows, '', false, true).length, 1);
    });

    test('formats complete copy details', () => {
        const text = formatResolutionRow(rows[0]);
        assert.ok(text.includes('osgi.wiring.package'));
        assert.ok(text.includes('Directives:'));
        assert.ok(text.includes('consumer.jar'));
    });

    test('maps bundle and version multi-selections to repository coordinates', () => {
        const repo = { index: 2, name: 'Local' } as RepoInfo;
        const nodes: RepoNode[] = [
            { type: 'bundle', ws: 'file:///workspace', repo, bundle: { bsn: 'consumer' } },
            { type: 'version', ws: 'file:///workspace', repo, bsn: 'provider', info: { version: '1.2.0' } },
            { type: 'message', label: 'Ignored' },
        ];
        assert.deepStrictEqual(resolutionEntriesFor(nodes), [
            { workspace: 'file:///workspace', repo: 2, repoName: 'Local', bsn: 'consumer', version: undefined },
            { workspace: 'file:///workspace', repo: 2, repoName: 'Local', bsn: 'provider', version: '1.2.0' },
        ]);
    });

    test('replaces selection resources, picks newest bundle version, and appends dropped versions', async () => {
        let saved: string[] = [];
        const context = { workspaceState: {
            get: () => saved,
            update: async (_key: string, value: string[]) => { saved = value; },
        } } as unknown as vscode.ExtensionContext;
        const requests: string[] = [];
        const provider = new ResolutionViewProvider(context, {
            supports: async () => true,
            execute: async (command, args) => {
                const request = args[0] as { bsn: string; version?: string };
                requests.push(command);
                if (command === 'bnd.repositories.versions') return { versions: [{ version: '2.0.0' }, { version: '1.0.0' }] };
                assert.strictEqual(request.version, request.bsn === 'consumer' ? '2.0.0' : '1.2.0');
                return { file: path.resolve(`${request.bsn}.jar`) };
            },
        });
        const base = { workspace: 'file:///workspace', repo: 2, repoName: 'Local' };
        const consumer = { ...base, bsn: 'consumer' };
        const additional = { ...base, bsn: 'provider', version: '1.2.0' };
        try {
            await provider.add(vscode.Uri.file(path.resolve('previous.jar')));
            await provider.selectRepositoryEntries([consumer]);
            assert.deepStrictEqual(saved, [vscode.Uri.file(path.resolve('consumer.jar')).toString()]);
            assert.ok(requests.includes('bnd.repositories.versions'));
            await provider.addRepositoryEntries([additional]);
            assert.deepStrictEqual(saved, ['consumer.jar', 'provider.jar'].map(file => vscode.Uri.file(path.resolve(file)).toString()));
            await provider.addRepositoryEntries([additional]);
            assert.strictEqual(saved.length, 2, 'Repeated drops should not duplicate resources');
            await provider.selectRepositoryEntries([additional]);
            assert.deepStrictEqual(saved, [vscode.Uri.file(path.resolve('provider.jar')).toString()]);
            await provider.selectRepositoryEntries([consumer, additional]);
            assert.strictEqual(saved.length, 2, 'Multi-selection should analyze both resources');
        } finally {
            provider.dispose();
        }
    });

    test('ignores an older selection lookup that completes after a newer selection', async () => {
        let saved: string[] = [];
        let completeOlder!: (result: { file: string }) => void;
        const olderResult = new Promise<{ file: string }>(resolve => { completeOlder = resolve; });
        const context = { workspaceState: {
            get: () => saved,
            update: async (_key: string, value: string[]) => { saved = value; },
        } } as unknown as vscode.ExtensionContext;
        const provider = new ResolutionViewProvider(context, {
            supports: async () => true,
            execute: async (_command, args) => {
                const request = args[0] as { bsn: string };
                return request.bsn === 'older' ? olderResult : { file: path.resolve('newer.jar') };
            },
        });
        const base = { workspace: 'file:///workspace', repo: 2, repoName: 'Local', version: '1.0.0' };
        try {
            const pending = provider.selectRepositoryEntries([{ ...base, bsn: 'older' }]);
            await provider.selectRepositoryEntries([{ ...base, bsn: 'newer' }]);
            completeOlder({ file: path.resolve('older.jar') });
            await pending;
            assert.deepStrictEqual(saved, [vscode.Uri.file(path.resolve('newer.jar')).toString()]);
        } finally {
            provider.dispose();
        }
    });

    test('version drags supply webview coordinates and URI fallback without changing editor insertions', async () => {
        const file = path.resolve('provider.jar');
        const repo = { index: 2, name: 'Local' } as RepoInfo;
        const node: RepoNode = { type: 'version', ws: 'file:///workspace', repo, bsn: 'provider', info: { version: '1.2.0' } };
        const provider = new RepositoriesProvider({ supports: async () => true, execute: async () => ({ file }) });
        const controller = new RepositoriesDragAndDrop(provider, async () => {});
        const transfer = new vscode.DataTransfer();
        try {
            await controller.handleDrag([node], transfer);
            assert.deepStrictEqual(JSON.parse(await transfer.get(resolutionEntryMime)!.asString()), resolutionEntriesFor([node]));
            assert.strictEqual(await transfer.get('text/uri-list')!.asString(), vscode.Uri.file(file).toString());
            assert.strictEqual(await transfer.get('text/plain')!.asString(), "provider;version='1.2.0'");
            assert.deepStrictEqual(JSON.parse(await transfer.get(repositoryEntryMime)!.asString()), [{ bsn: 'provider', version: '1.2.0' }]);
        } finally {
            provider.dispose();
        }
    });

    test('analyzes a JAR through the bundled Java server over JSON-RPC', async function () {
        this.timeout(60000);
        const jar = path.resolve(__dirname, '../../../../server/biz.aQute.bnd.lsp.jar');
        const output = vscode.window.createOutputChannel('Test bnd Resolution', { log: true });
        const executable: Executable = { command: 'java', args: ['-jar', jar], options: { env: process.env } };
        const client = new LanguageClient('testBndResolution', 'Test bnd Resolution', { run: executable, debug: executable }, {
            documentSelector: [{ scheme: 'file', language: 'bnd' }],
            initializationOptions: { workspaceTrusted: true },
            outputChannel: output,
        });
        client.getFeature('workspace/executeCommand').initialize = () => {};
        try {
            await client.start();
            assert.ok(client.initializeResult?.capabilities.executeCommandProvider?.commands.includes(resolutionAnalyzeCommand));
            const result = await executeServerCommand(client, resolutionAnalyzeCommand,
                [{ uris: [vscode.Uri.file(jar).toString()] }]) as {
                    error?: string; requirements?: ResolutionRow[]; capabilities?: ResolutionRow[];
                };
            assert.strictEqual(result.error, undefined);
            assert.ok(result.requirements?.length, 'Expected JAR requirements');
            assert.ok(result.capabilities?.some(row => row.namespace === 'osgi.identity'), 'Expected bundle identity capability');
        } finally {
            await client.stop();
        }
    });

    test('contributes Resolution to the built-in Panel', () => {
        const packagePath = path.resolve(__dirname, '../../../../package.json');
        const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        assert.ok(manifest.contributes.viewsContainers.panel.some((container: { id: string }) => container.id === 'bndPanel'));
        assert.ok(manifest.contributes.views.bndPanel.some((view: { id: string }) => view.id === 'bnd.resolution'));
        assert.strictEqual(manifest.contributes.views.bndPanel.find((view: { id: string }) => view.id === 'bnd.resolution').type, 'webview');
        assert.strictEqual(manifest.contributes.viewsContainers.panel.find((container: { id: string }) => container.id === 'bndPanel').title, 'Resolution');
        assert.ok(manifest.contributes.commands.some((command: { command: string }) => command.command === 'bnd.resolution.add'));
    });
});