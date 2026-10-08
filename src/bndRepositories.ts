import * as path from 'path';
import * as vscode from 'vscode';

export const repositoriesViewId = 'bnd.repositories';
export const repositoriesListCommand = 'bnd.repositories.list';
export const repositoryEntryMime = 'application/vnd.bnd.repository-entry';
export const resolutionEntryMime = 'application/vnd.bnd.resolution-entry';

export interface ResolutionRepositoryEntry {
    workspace: string;
    repo: number;
    repoName: string;
    bsn: string;
    version?: string;
}

export function resolutionEntriesFor(nodes: readonly RepoNode[]): ResolutionRepositoryEntry[] {
    return nodes.filter((node): node is Extract<RepoNode, { type: 'bundle' | 'version' }> =>
        node.type === 'bundle' || node.type === 'version').map(node => ({
        workspace: node.ws,
        repo: node.repo.index,
        repoName: node.repo.name,
        bsn: node.type === 'bundle' ? node.bundle.bsn : node.bsn,
        version: node.type === 'version' ? node.info.version : undefined,
    }));
}

export interface RepositoriesServer {
    supports(command: string): Promise<boolean>;
    execute(command: string, args: unknown[], token?: vscode.CancellationToken): Promise<unknown>;
}

export interface RepoInfo {
    index: number;
    name: string;
    kind: 'workspace' | 'plugin';
    title?: string | null;
    tooltip?: string | null;
    location?: string | null;
    status?: string | null;
    writable: boolean;
    remote: boolean;
    refreshable: boolean;
    actionable: boolean;
    searchable: boolean;
    p2: boolean;
    tags: string[];
}

interface BundleInfo { bsn: string; title?: string | null; tooltip?: string | null; project?: string }
interface VersionInfo { version: string; title?: string | null; tooltip?: string | null }
interface FeatureInfo { id: string; version: string; label?: string | null; provider?: string | null }
interface FeatureItem { id: string; version?: string | null; type?: string; match?: string | null }
interface SearchResult { repo: number; repoName: string; bsn?: string | null; version?: string | null; type?: string | null }

export interface RepositoryEntry { bsn: string; version?: string; workspace?: boolean }

export type RepoNode =
    | { type: 'workspace'; ws: string; label: string }
    | { type: 'repo'; ws: string; repo: RepoInfo; results?: SearchResult[] }
    | { type: 'project'; ws: string; repo: RepoInfo; name: string; bundles: BundleInfo[] }
    | { type: 'bundle'; ws: string; repo: RepoInfo; bundle: BundleInfo }
    | { type: 'version'; ws: string; repo: RepoInfo; bsn: string; info: VersionInfo; resource?: boolean }
    | { type: 'feature'; ws: string; repo: RepoInfo; feature: FeatureInfo }
    | { type: 'featureGroup'; ws: string; repo: RepoInfo; label: string; items: FeatureItem[] }
    | { type: 'featureItem'; ws: string; repo: RepoInfo; item: FeatureItem }
    | { type: 'message'; label: string; error?: boolean };

export interface AdvancedSearch { namespace: string; filter: string; label: string }

const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object') throw new Error('Incompatible bnd Language Server response.');
    const record = value as Record<string, unknown>;
    if (typeof record.error === 'string') throw new Error(record.error);
    return record;
};

const array = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export function entryFor(node: RepoNode): RepositoryEntry | undefined {
    if (node.type === 'version') return { bsn: node.bsn, version: node.info.version };
    if (node.type === 'bundle') return { bsn: node.bundle.bsn, workspace: node.repo.kind === 'workspace' };
    if (node.type === 'featureItem' && node.item.type !== 'feature') return { bsn: node.item.id, version: node.item.version ?? undefined };
    return undefined;
}

export function formatEntry(entry: RepositoryEntry): string {
    if (entry.version) return `${entry.bsn};version='${entry.version}'`;
    return `${entry.bsn};version=${entry.workspace ? 'snapshot' : 'latest'}`;
}

/** Joins entries as a bnd list continuation; a blank line after a continued line gets indented. */
export function formatDropText(entries: RepositoryEntry[], lineText: string, previousLineText: string): string {
    const body = entries.map(formatEntry).join(',\\\n\t');
    const indent = lineText.trim() === '' && previousLineText.trimEnd().endsWith('\\') ? '\t' : '';
    return indent + body;
}

const ldapEscape = (value: string): string => value.replace(/[\\()]/g, c => `\\${c}`);

export function packageFilter(name: string, range?: string): string {
    const pkg = `(osgi.wiring.package=${ldapEscape(name.trim())})`;
    const versions = versionRangeFilter(range);
    return versions ? `(&${pkg}${versions})` : pkg;
}

export function versionRangeFilter(range?: string): string | undefined {
    const text = range?.trim();
    if (!text) return undefined;
    const match = /^([[(])\s*([^,\s]+)\s*,\s*([^\])\s]+)\s*([\])])$/.exec(text);
    if (!match) {
        if (!/^\d+(\.\d+){0,2}(\.[\w-]+)?$/.test(text)) throw new Error(`Invalid version range: ${text}`);
        return `(version>=${text})`;
    }
    const [, open, low, high, close] = match;
    const lower = open === '[' ? `(version>=${low})` : `(!(version<=${low}))`;
    const upper = close === ']' ? `(version<=${high})` : `(!(version>=${high}))`;
    return lower + upper;
}

export function serviceFilter(name: string): string {
    return `(objectClass=${ldapEscape(name.trim())})`;
}

export interface ParsedAction { label: string; path: string[]; enabled: boolean; checked: boolean; description?: string }

/** Parses bndtools Actionable keys: optional "-" (disabled), "!" (checked), " :: " submenus, "{description}". */
export function parseActionLabel(label: string): ParsedAction {
    const match = /^(-)?(!)?(.*?)(?:\{([^}]*)\})?$/s.exec(label)!;
    return {
        label,
        path: match[3].split(' :: ').map(part => part.trim()).filter(part => part.length > 0),
        enabled: !match[1],
        checked: !!match[2],
        description: match[4],
    };
}

export async function findBndWorkspaces(): Promise<vscode.Uri[]> {
    const files = await vscode.workspace.findFiles('**/cnf/build.bnd', '**/node_modules/**');
    const roots = new Map<string, vscode.Uri>();
    for (const file of files) {
        const root = vscode.Uri.joinPath(file, '..', '..');
        roots.set(root.toString(), root);
    }
    return [...roots.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

export class RepositoriesProvider implements vscode.TreeDataProvider<RepoNode> {
    private readonly changed = new vscode.EventEmitter<RepoNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private filterText: string | undefined;
    private searchQuery: AdvancedSearch | undefined;
    private roots: vscode.Uri[] = [];
    private readonly offline = new Map<string, boolean>();

    constructor(private readonly server: RepositoriesServer,
        private readonly findWorkspaces: () => Promise<vscode.Uri[]> = findBndWorkspaces,
        private readonly onState: (state: Record<string, unknown>) => void = () => undefined) {}

    get filter(): string | undefined { return this.filterText; }
    get search(): AdvancedSearch | undefined { return this.searchQuery; }
    get workspaces(): vscode.Uri[] { return this.roots; }
    get isOffline(): boolean { return [...this.offline.values()].some(Boolean); }

    setFilter(filter: string | undefined): void {
        this.filterText = filter?.trim() || undefined;
        if (this.filterText) this.searchQuery = undefined;
        this.refresh();
    }

    setSearch(search: AdvancedSearch | undefined): void {
        this.searchQuery = search;
        if (search) this.filterText = undefined;
        this.refresh();
    }

    setOffline(ws: string, offline: boolean): void {
        this.offline.set(ws, offline);
        this.publish();
    }

    refresh(node?: RepoNode): void {
        this.publish();
        this.changed.fire(node);
    }

    dispose(): void {
        this.changed.dispose();
    }

    execute(command: string, request: Record<string, unknown>, token?: vscode.CancellationToken): Promise<Record<string, unknown>> {
        return this.server.execute(command, [request], token).then(object);
    }

    repoRequest(node: { ws: string; repo: RepoInfo }, extra: Record<string, unknown> = {}): Record<string, unknown> {
        return { workspace: node.ws, repo: node.repo.index, repoName: node.repo.name, ...extra };
    }

    private publish(): void {
        this.onState({
            'bnd.repositories.filtered': !!this.filterText,
            'bnd.repositories.searching': !!this.searchQuery,
            'bnd.repositories.offline': this.isOffline,
        });
    }

    async getChildren(node?: RepoNode): Promise<RepoNode[]> {
        try {
            return await this.children(node);
        } catch (error) {
            return [{ type: 'message', label: error instanceof Error ? error.message : String(error), error: true }];
        }
    }

    private async children(node?: RepoNode): Promise<RepoNode[]> {
        if (!node) {
            if (!vscode.workspace.isTrusted) return [];
            if (!(await this.server.supports(repositoriesListCommand))) {
                this.onState({ 'bnd.repositories.state': 'unsupported' });
                return [];
            }
            this.roots = await this.findWorkspaces();
            this.onState({ 'bnd.repositories.state': this.roots.length ? 'ready' : 'empty' });
            return this.roots.map(root => ({ type: 'workspace', ws: root.toString(), label: path.basename(root.fsPath) }));
        }
        switch (node.type) {
            case 'workspace': {
                const listing = await this.execute(repositoriesListCommand, { workspace: node.ws });
                this.setOffline(node.ws, listing.offline === true);
                const repos = array<RepoInfo>(listing.repositories);
                if (!this.searchQuery) return repos.map(repo => ({ type: 'repo', ws: node.ws, repo }));
                const found = await this.execute('bnd.repositories.search',
                    { workspace: node.ws, namespace: this.searchQuery.namespace, filter: this.searchQuery.filter });
                const results = array<SearchResult>(found.results);
                const nodes: RepoNode[] = repos.flatMap(repo => {
                    const matching = results.filter(result => result.repo === repo.index);
                    return matching.length ? [{ type: 'repo' as const, ws: node.ws, repo, results: matching }] : [];
                });
                return nodes.length ? nodes : [{ type: 'message', label: 'No matches.' }];
            }
            case 'repo': {
                if (node.results) {
                    return node.results.filter(result => result.bsn).map(result => ({
                        type: 'version', ws: node.ws, repo: node.repo, bsn: result.bsn!, resource: true,
                        info: { version: result.version ?? '0.0.0' },
                    }));
                }
                const listing = await this.execute('bnd.repositories.bundles', this.repoRequest(node, { filter: this.filterText }));
                const bundles = array<BundleInfo>(listing.bundles);
                if (node.repo.kind === 'workspace') {
                    const projects = new Map<string, BundleInfo[]>();
                    for (const bundle of bundles) {
                        const project = bundle.project ?? bundle.bsn;
                        projects.set(project, [...(projects.get(project) ?? []), bundle]);
                    }
                    return [...projects].sort(([a], [b]) => a.localeCompare(b))
                        .map(([name, items]) => ({ type: 'project', ws: node.ws, repo: node.repo, name, bundles: items }));
                }
                const result: RepoNode[] = bundles.sort((a, b) => a.bsn.localeCompare(b.bsn))
                    .map(bundle => ({ type: 'bundle', ws: node.ws, repo: node.repo, bundle }));
                for (const feature of array<FeatureInfo>(listing.features)) {
                    result.push({ type: 'feature', ws: node.ws, repo: node.repo, feature });
                }
                return result.length ? result : [{ type: 'message', label: this.filterText ? 'No matches.' : 'Empty' }];
            }
            case 'project':
                return node.bundles.map(bundle => ({ type: 'bundle', ws: node.ws, repo: node.repo, bundle }));
            case 'bundle': {
                const listing = await this.execute('bnd.repositories.versions', this.repoRequest(node, { bsn: node.bundle.bsn }));
                return array<VersionInfo>(listing.versions)
                    .map(info => ({ type: 'version', ws: node.ws, repo: node.repo, bsn: node.bundle.bsn, info }));
            }
            case 'feature': {
                const detail = await this.execute('bnd.repositories.feature',
                    this.repoRequest(node, { id: node.feature.id, version: node.feature.version }));
                const groups: [string, FeatureItem[]][] = [
                    ['Included Features', array<FeatureItem>(detail.includes).map(item => ({ ...item, type: 'feature' }))],
                    ['Included Bundles', array<FeatureItem>(detail.plugins).map(item => ({ ...item, type: 'bundle' }))],
                    ['Required', array<FeatureItem>(detail.requires)],
                ];
                return groups.filter(([, items]) => items.length)
                    .map(([label, items]) => ({ type: 'featureGroup', ws: node.ws, repo: node.repo, label, items }));
            }
            case 'featureGroup':
                return node.items.map(item => ({ type: 'featureItem', ws: node.ws, repo: node.repo, item }));
            default:
                return [];
        }
    }

    getTreeItem(node: RepoNode): vscode.TreeItem {
        const expandable = vscode.TreeItemCollapsibleState.Collapsed;
        const expanded = vscode.TreeItemCollapsibleState.Expanded;
        switch (node.type) {
            case 'workspace': {
                const item = new vscode.TreeItem(node.label, expanded);
                item.iconPath = new vscode.ThemeIcon('root-folder');
                item.tooltip = vscode.Uri.parse(node.ws).fsPath;
                item.contextValue = 'workspaceRoot';
                return item;
            }
            case 'repo': {
                const repo = node.repo;
                const item = new vscode.TreeItem(repo.title || repo.name,
                    node.results || this.filterText ? expanded : expandable);
                item.iconPath = new vscode.ThemeIcon(repo.status ? 'warning'
                    : repo.kind === 'workspace' ? 'folder-library' : repo.remote ? 'cloud' : 'repo');
                item.description = [repo.kind === 'workspace' ? 'Workspace' : '', ...repo.tags.map(tag => `#${tag}`)]
                    .filter(Boolean).join(' ') || undefined;
                const tooltip = new vscode.MarkdownString();
                tooltip.appendText(repo.tooltip || repo.name);
                if (repo.location) tooltip.appendMarkdown('\n\n').appendText(repo.location);
                if (repo.status) tooltip.appendMarkdown('\n\n').appendText(`Status: ${repo.status}`);
                item.tooltip = tooltip;
                item.contextValue = ['repo', repo.writable && 'writable', repo.remote && 'downloadable',
                    repo.refreshable && 'refreshable', repo.actionable && 'actionable'].filter(Boolean).join(' ');
                return item;
            }
            case 'project': {
                const item = new vscode.TreeItem(node.name, this.filterText ? expanded : expandable);
                item.iconPath = new vscode.ThemeIcon('project');
                item.contextValue = 'project';
                return item;
            }
            case 'bundle': {
                const item = new vscode.TreeItem(node.bundle.title || node.bundle.bsn, expandable);
                item.iconPath = new vscode.ThemeIcon('package');
                item.tooltip = node.bundle.tooltip || node.bundle.bsn;
                item.contextValue = ['bundle', node.repo.actionable && 'actionable', node.repo.remote && 'downloadable']
                    .filter(Boolean).join(' ');
                item.command = { command: 'bnd.repositories.openJar', title: 'Open in bnd JAR Viewer', arguments: [node] };
                return item;
            }
            case 'version': {
                const item = new vscode.TreeItem(node.resource ? node.bsn : node.info.title || node.info.version,
                    vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon(node.resource ? 'star-full' : 'tag');
                if (node.resource) item.description = node.info.version;
                item.tooltip = node.info.tooltip || `${node.bsn} ${node.info.version}`;
                item.contextValue = ['version', !node.resource && node.repo.actionable && 'actionable',
                    node.repo.remote && 'downloadable'].filter(Boolean).join(' ');
                item.command = { command: 'bnd.repositories.openJar', title: 'Open in bnd JAR Viewer', arguments: [node] };
                return item;
            }
            case 'feature': {
                const item = new vscode.TreeItem(node.feature.id, expandable);
                item.iconPath = new vscode.ThemeIcon('extensions');
                item.description = node.feature.version;
                item.tooltip = [node.feature.label, node.feature.provider].filter(Boolean).join(' - ') || node.feature.id;
                item.contextValue = 'feature';
                return item;
            }
            case 'featureGroup': {
                const item = new vscode.TreeItem(node.label, expandable);
                item.iconPath = new vscode.ThemeIcon('folder');
                return item;
            }
            case 'featureItem': {
                const item = new vscode.TreeItem(node.item.id, vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon(node.item.type === 'feature' ? 'extensions' : 'package');
                item.description = [node.item.version, node.item.match].filter(Boolean).join(' ');
                item.contextValue = node.item.type === 'feature' ? 'featureItem' : 'featureItem bundle';
                return item;
            }
            case 'message': {
                const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon(node.error ? 'error' : 'info');
                return item;
            }
        }
    }
}

export class RepositoriesDragAndDrop implements vscode.TreeDragAndDropController<RepoNode> {
    readonly dragMimeTypes = ['text/plain', 'text/uri-list', repositoryEntryMime, resolutionEntryMime];
    readonly dropMimeTypes = ['text/uri-list'];

    constructor(private readonly provider: RepositoriesProvider, private readonly put: (node: RepoNode, files: string[]) => Promise<void>) {}

    async handleDrag(source: readonly RepoNode[], data: vscode.DataTransfer): Promise<void> {
        const entries = source.map(entryFor).filter((entry): entry is RepositoryEntry => !!entry);
        if (!entries.length) return;
        data.set('text/plain', new vscode.DataTransferItem(entries.map(formatEntry).join(',\\\n\t')));
        data.set(repositoryEntryMime, new vscode.DataTransferItem(JSON.stringify(entries)));
        const versions = resolutionEntriesFor(source).filter(entry => entry.version !== undefined);
        if (versions.length) data.set(resolutionEntryMime, new vscode.DataTransferItem(JSON.stringify(versions)));
        const uris: string[] = [];
        for (const entry of versions) {
            const result = await this.provider.execute('bnd.repositories.get', { ...entry });
            if (typeof result.file === 'string') uris.push(vscode.Uri.file(result.file).toString());
        }
        if (uris.length) data.set('text/uri-list', new vscode.DataTransferItem(uris.join('\r\n')));
    }

    async handleDrop(target: RepoNode | undefined, data: vscode.DataTransfer): Promise<void> {
        if (target?.type !== 'repo' || !target.repo.writable) return;
        const list = await data.get('text/uri-list')?.asString();
        const files = (list ?? '').split(/\r?\n/).map(line => line.trim())
            .filter(line => line && !line.startsWith('#') && line.toLowerCase().endsWith('.jar'));
        if (files.length) await this.put(target, files);
        else this.provider.refresh();
    }
}

class RepositoryDropProvider implements vscode.DocumentDropEditProvider {
    static readonly kind = vscode.DocumentDropOrPasteEditKind.Text.append('bnd', 'repositoryEntry');

    async provideDocumentDropEdits(document: vscode.TextDocument, position: vscode.Position, data: vscode.DataTransfer):
        Promise<vscode.DocumentDropEdit | undefined> {
        const raw = await data.get(repositoryEntryMime)?.asString();
        if (!raw) return undefined;
        const entries = JSON.parse(raw) as RepositoryEntry[];
        const previous = position.line > 0 ? document.lineAt(position.line - 1).text : '';
        return new vscode.DocumentDropEdit(formatDropText(entries, document.lineAt(position.line).text, previous),
            'Insert bnd repository entry', RepositoryDropProvider.kind);
    }
}

type ActionPick = vscode.QuickPickItem & { action?: ParsedAction; group?: string };

async function pickAction(actions: ParsedAction[], prefix: string[] = []): Promise<ParsedAction | undefined> {
    const level = actions.filter(action => prefix.every((part, i) => action.path[i] === part) && action.path.length > prefix.length);
    const items: ActionPick[] = [];
    const groups = new Set<string>();
    for (const action of level) {
        const name = action.path[prefix.length];
        if (action.path.length > prefix.length + 1) {
            if (!groups.has(name)) {
                groups.add(name);
                items.push({ label: `${name} $(chevron-right)`, group: name });
            }
        } else if (action.enabled) {
            items.push({ label: `${action.checked ? '$(check) ' : ''}${name}`, description: action.description, action });
        }
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: prefix.length ? prefix.join(' › ') : 'Repository action' });
    if (!picked) return undefined;
    return picked.action ?? pickAction(actions, [...prefix, picked.group!]);
}

export function registerRepositoriesView(context: vscode.ExtensionContext, server: RepositoriesServer,
    output?: vscode.LogOutputChannel,
    onSelection?: (entries: ResolutionRepositoryEntry[]) => Promise<void>): RepositoriesProvider {
    const setContext = (state: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(state)) void vscode.commands.executeCommand('setContext', key, value);
    };
    const provider = new RepositoriesProvider(server, findBndWorkspaces, setContext);
    const fail = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        output?.error(`Repositories: ${message}`);
        void vscode.window.showErrorMessage(`bnd Repositories: ${message}`);
    };
    const put = async (node: RepoNode, files: string[]) => {
        if (node.type !== 'repo') return;
        try {
            const result = await vscode.window.withProgress({ location: { viewId: repositoriesViewId } },
                () => provider.execute('bnd.repositories.put', provider.repoRequest(node, { files })));
            void vscode.window.showInformationMessage(`Added ${array(result.added).length} bundle(s) to ${node.repo.name}.`);
        } catch (error) {
            fail(error);
        }
        provider.refresh(node);
    };
    const view = vscode.window.createTreeView(repositoriesViewId, {
        treeDataProvider: provider,
        showCollapseAll: true,
        canSelectMany: true,
        dragAndDropController: new RepositoriesDragAndDrop(provider, put),
    });
    const describe = () => {
        view.description = provider.filter ? `Filter: ${provider.filter}`
            : provider.search ? `Search: ${provider.search.label}` : undefined;
    };
    const selected = (node?: RepoNode, nodes?: RepoNode[]): RepoNode[] =>
        nodes?.length ? nodes : node ? [node] : [...view.selection];
    const copy = async (text: string) => {
        await vscode.env.clipboard.writeText(text);
        vscode.window.setStatusBarMessage('Copied to clipboard', 2000);
    };
    const jarFor = async (node: RepoNode, token?: vscode.CancellationToken): Promise<string> => {
        if (node.type !== 'version') throw new Error('Select a bundle version.');
        const result = await provider.execute('bnd.repositories.get', provider.repoRequest(node, { bsn: node.bsn, version: node.info.version }), token);
        if (typeof result.file !== 'string') throw new Error('Incompatible bnd Language Server response.');
        return result.file;
    };
    const latestJarFor = async (node: RepoNode): Promise<string> => {
        if (node.type !== 'bundle') return jarFor(node);
        const listing = await provider.execute('bnd.repositories.versions', provider.repoRequest(node, { bsn: node.bundle.bsn }));
        const [info] = array<VersionInfo>(listing.versions);
        if (!info) throw new Error(`No versions found for ${node.bundle.bsn}.`);
        return jarFor({ type: 'version', ws: node.ws, repo: node.repo, bsn: node.bundle.bsn, info });
    };
    const run = (handler: (...args: any[]) => Promise<void> | void) => async (...args: any[]) => {
        try {
            await handler(...args);
        } catch (error) {
            fail(error);
        }
    };
    let refreshTimer: NodeJS.Timeout | undefined;
    const watcher = vscode.workspace.createFileSystemWatcher('**/cnf/**/*.{bnd,mvn}');
    const scheduleRefresh = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => provider.refresh(), 500);
    };

    context.subscriptions.push(provider, view, watcher, { dispose: () => clearTimeout(refreshTimer) },
        view.onDidChangeSelection(event => {
            const entries = resolutionEntriesFor(event.selection);
            if (entries.length && onSelection) void onSelection(entries).catch(fail);
        }),
        watcher.onDidCreate(scheduleRefresh), watcher.onDidChange(scheduleRefresh), watcher.onDidDelete(scheduleRefresh),
        vscode.workspace.onDidGrantWorkspaceTrust(() => provider.refresh()),
        vscode.languages.registerDocumentDropEditProvider({ language: 'bnd' }, new RepositoryDropProvider(), {
            providedDropEditKinds: [RepositoryDropProvider.kind], dropMimeTypes: [repositoryEntryMime],
        }),
        vscode.commands.registerCommand('bnd.repositories.refresh', run(async (node?: RepoNode) => {
            await vscode.window.withProgress({ location: { viewId: repositoriesViewId } }, async () => {
                if (node?.type === 'repo') {
                    await provider.execute('bnd.repositories.reload', provider.repoRequest(node));
                } else {
                    const roots = node?.type === 'workspace' ? [node.ws] : provider.workspaces.map(root => root.toString());
                    for (const ws of roots) await provider.execute('bnd.repositories.reload', { workspace: ws });
                }
            });
            provider.refresh(node?.type === 'repo' ? node : undefined);
        })),
        vscode.commands.registerCommand('bnd.repositories.filter', run(async () => {
            const value = await vscode.window.showInputBox({
                prompt: 'Filter bundles by symbolic name (wildcards * and ? allowed)', value: provider.filter,
            });
            if (value === undefined) return;
            provider.setFilter(value);
            describe();
        })),
        vscode.commands.registerCommand('bnd.repositories.clearFilter', () => {
            provider.setFilter(undefined);
            describe();
        }),
        vscode.commands.registerCommand('bnd.repositories.advancedSearch', run(async () => {
            const search = await promptAdvancedSearch();
            if (!search) return;
            provider.setSearch(search);
            describe();
        })),
        vscode.commands.registerCommand('bnd.repositories.clearSearch', () => {
            provider.setSearch(undefined);
            describe();
        }),
        vscode.commands.registerCommand('bnd.repositories.goOffline', run(() => setOffline(true))),
        vscode.commands.registerCommand('bnd.repositories.goOnline', run(() => setOffline(false))),
        vscode.commands.registerCommand('bnd.repositories.download', run(async (node?: RepoNode, nodes?: RepoNode[]) => {
            const targets = selected(node, nodes).filter(item => item.type === 'repo' || item.type === 'bundle' || item.type === 'version');
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading repository content', cancellable: true },
                async (progress, token) => {
                    let downloaded = 0;
                    const errors: string[] = [];
                    for (const target of targets) {
                        if (token.isCancellationRequested) break;
                        if (!('repo' in target)) continue;
                        const extra = target.type === 'bundle' ? { bsn: target.bundle.bsn }
                            : target.type === 'version' ? { bsn: target.bsn, version: target.info.version } : {};
                        progress.report({ message: target.type === 'repo' ? target.repo.name : extra.bsn });
                        const result = await provider.execute('bnd.repositories.fetch', provider.repoRequest(target, extra), token);
                        downloaded += typeof result.downloaded === 'number' ? result.downloaded : 0;
                        errors.push(...array<string>(result.errors));
                    }
                    errors.forEach(error => output?.warn(`Download: ${error}`));
                    const message = `Downloaded ${downloaded} artifact(s)${errors.length ? `, ${errors.length} failed (see output)` : ''}.`;
                    void (errors.length ? vscode.window.showWarningMessage(message) : vscode.window.showInformationMessage(message));
                });
        })),
        vscode.commands.registerCommand('bnd.repositories.addFiles', run(async (node?: RepoNode) => {
            const target = node ?? view.selection[0];
            if (target?.type !== 'repo' || !target.repo.writable) throw new Error('Select a writable repository.');
            const files = await vscode.window.showOpenDialog({
                canSelectMany: true, filters: { 'Bundles': ['jar'] }, openLabel: `Add to ${target.repo.name}`,
            });
            if (files?.length) await put(target, files.map(file => file.toString()));
        })),
        vscode.commands.registerCommand('bnd.repositories.copyBsn', run(async (node?: RepoNode, nodes?: RepoNode[]) => {
            const entries = selected(node, nodes).map(entryFor).filter((entry): entry is RepositoryEntry => !!entry);
            await copy(entries.map(entry => entry.bsn).join('\n'));
        })),
        vscode.commands.registerCommand('bnd.repositories.copyVersion', run(async (node?: RepoNode, nodes?: RepoNode[]) => {
            const entries = selected(node, nodes).map(entryFor).filter((entry): entry is RepositoryEntry => !!entry?.version);
            await copy(entries.map(entry => entry.version).join('\n'));
        })),
        vscode.commands.registerCommand('bnd.repositories.copyEntry', run(async (node?: RepoNode, nodes?: RepoNode[]) => {
            const entries = selected(node, nodes).map(entryFor).filter((entry): entry is RepositoryEntry => !!entry);
            await copy(entries.map(formatEntry).join(',\\\n\t'));
        })),
        vscode.commands.registerCommand('bnd.repositories.revealFile', run(async (node?: RepoNode) => {
            const file = await vscode.window.withProgress({ location: { viewId: repositoriesViewId } }, () => jarFor(node ?? view.selection[0]));
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
        })),
        vscode.commands.registerCommand('bnd.repositories.openJar', run(async (node?: RepoNode) => {
            const file = await vscode.window.withProgress({ location: { viewId: repositoriesViewId } }, () => latestJarFor(node ?? view.selection[0]));
            await vscode.commands.executeCommand('bnd.jar.open', vscode.Uri.file(file));
        })),
        vscode.commands.registerCommand('bnd.repositories.addToResolution', run(async (node?: RepoNode) => {
            const file = await vscode.window.withProgress({ location: { viewId: repositoriesViewId } }, () => jarFor(node ?? view.selection[0]));
            await vscode.commands.executeCommand('bnd.resolution.add', vscode.Uri.file(file));
        })),
        vscode.commands.registerCommand('bnd.repositories.showManifest', run(async (node?: RepoNode) => {
            const file = await vscode.window.withProgress({ location: { viewId: repositoriesViewId } }, () => jarFor(node ?? view.selection[0]));
            if (!(await server.supports('bnd.jar.print'))) throw new Error('The bnd Language Server cannot print manifests.');
            const result = object(await server.execute('bnd.jar.print', [file]));
            const manifest = (result.manifest ?? {}) as Record<string, string>;
            const content = [`# ${file}`, ...Object.keys(manifest).sort().map(key => `${key}: ${manifest[key]}`)].join('\n');
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: 'bnd' }), { preview: true });
        })),
        vscode.commands.registerCommand('bnd.repositories.actions', run(async (node?: RepoNode) => {
            const target = node ?? view.selection[0];
            if (!target || !('repo' in target)) return;
            const extra = target.type === 'bundle' ? { bsn: target.bundle.bsn }
                : target.type === 'version' ? { bsn: target.bsn, version: target.info.version } : {};
            const listing = await provider.execute('bnd.repositories.listActions', provider.repoRequest(target, extra));
            const actions = array<string>(listing.actions).map(parseActionLabel);
            if (!actions.length) {
                void vscode.window.showInformationMessage('No repository actions available.');
                return;
            }
            const action = await pickAction(actions);
            if (!action) return;
            await vscode.window.withProgress({ location: { viewId: repositoriesViewId } },
                () => provider.execute('bnd.repositories.runAction', provider.repoRequest(target, { ...extra, label: action.label })));
            provider.refresh();
        })),
    );

    async function setOffline(offline: boolean): Promise<void> {
        for (const root of provider.workspaces) {
            const result = await provider.execute('bnd.workspace.offline', { workspace: root.toString(), offline });
            provider.setOffline(root.toString(), result.offline === true);
        }
        provider.refresh();
    }

    return provider;
}

async function promptAdvancedSearch(): Promise<AdvancedSearch | undefined> {
    const kind = await vscode.window.showQuickPick([
        { label: 'Package', description: 'osgi.wiring.package', id: 'package' },
        { label: 'Service', description: 'osgi.service', id: 'service' },
        { label: 'Other', description: 'Any namespace and LDAP filter', id: 'other' },
    ], { placeHolder: 'Search repositories for a requirement' });
    if (!kind) return undefined;
    if (kind.id === 'package') {
        const name = await vscode.window.showInputBox({ prompt: 'Package name (wildcard * allowed)', validateInput: v => v.trim() ? undefined : 'Required' });
        if (!name) return undefined;
        const range = await vscode.window.showInputBox({
            prompt: 'Optional version range, e.g. [1.0,2.0) or 1.2',
            validateInput: v => { try { versionRangeFilter(v); return undefined; } catch (e) { return (e as Error).message; } },
        });
        if (range === undefined) return undefined;
        return { namespace: 'osgi.wiring.package', filter: packageFilter(name, range), label: `package ${name.trim()}${range.trim() ? ` ${range.trim()}` : ''}` };
    }
    if (kind.id === 'service') {
        const name = await vscode.window.showInputBox({ prompt: 'Service interface name', validateInput: v => v.trim() ? undefined : 'Required' });
        if (!name) return undefined;
        return { namespace: 'osgi.service', filter: serviceFilter(name), label: `service ${name.trim()}` };
    }
    const namespace = await vscode.window.showInputBox({ prompt: 'Namespace', value: 'osgi.identity', validateInput: v => v.trim() ? undefined : 'Required' });
    if (!namespace) return undefined;
    const filter = await vscode.window.showInputBox({
        prompt: 'LDAP filter', placeHolder: '(osgi.identity=org.example.*)',
        validateInput: v => /^\(.*\)$/s.test(v.trim()) ? undefined : 'Filter must be enclosed in parentheses',
    });
    if (!filter) return undefined;
    return { namespace: namespace.trim(), filter: filter.trim(), label: `${namespace.trim()} ${filter.trim()}` };
}
