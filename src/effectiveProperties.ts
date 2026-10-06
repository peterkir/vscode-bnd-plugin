import * as path from 'path';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';

export const effectiveCommand = 'bnd.properties.effective';
export const effectiveViewType = 'bnd.effective';
const sourceScheme = 'bnd-effective';

export interface EffectiveOptions { expanded: boolean; merged: boolean }
export interface EffectiveRow {
    key: string;
    value: string;
    formattedValue: string;
    provenances: { label: string; uri?: string | null }[];
    errors: string[];
}
export interface EffectiveResult extends EffectiveOptions {
    schemaVersion: number;
    uri: string;
    documentVersion: number | null;
    rows: EffectiveRow[];
    effectiveSource: string;
    dependencies: string[];
    diagnostics: string[];
}
export type EffectiveRequest = (document: vscode.TextDocument, options: EffectiveOptions,
    token: vscode.CancellationToken) => Promise<EffectiveResult>;

export function acceptsEffectiveUri(uri: vscode.Uri): boolean {
    return uri.scheme === 'file' && /\.(bnd|bndrun)$/.test(uri.path);
}

export function parseEffectiveResult(value: unknown): EffectiveResult {
    const result = value as Partial<EffectiveResult> & { error?: string } | null;
    if (result?.error) throw new Error(result.error);
    if (!result || result.schemaVersion !== 1 || typeof result.uri !== 'string'
        || typeof result.effectiveSource !== 'string' || !Array.isArray(result.rows)
        || !Array.isArray(result.dependencies) || !Array.isArray(result.diagnostics)
        || !result.dependencies.every(item => typeof item === 'string')
        || !result.diagnostics.every(item => typeof item === 'string')
        || !result.rows.every(row => row && typeof row.key === 'string' && typeof row.value === 'string'
            && Array.isArray(row.provenances) && row.provenances.every(origin => origin
                && typeof origin.label === 'string' && (origin.uri == null || typeof origin.uri === 'string'))
            && Array.isArray(row.errors) && row.errors.every(error => typeof error === 'string'))) {
        throw new Error('The language server returned an incompatible Effective properties response.');
    }
    return result as EffectiveResult;
}

interface EditorState {
    document: vscode.TextDocument;
    panel: vscode.WebviewPanel;
    options: EffectiveOptions;
    generation: number;
    running: boolean;
    pending: boolean;
    disposed: boolean;
    timer?: ReturnType<typeof setTimeout>;
    token?: vscode.CancellationTokenSource;
    result?: EffectiveResult;
    watchers?: vscode.Disposable;
}

export class EffectivePropertiesProvider implements vscode.CustomTextEditorProvider,
    vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly editors = new Set<EditorState>();
    private readonly sourceChanged = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this.sourceChanged.event;
    private readonly sources = new Map<string, { target: vscode.Uri; dependencies: string[]; watcher?: vscode.Disposable }>();
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext, private readonly request: EffectiveRequest) {
        this.subscriptions.push(
            vscode.window.registerCustomEditorProvider(effectiveViewType, this, {
                supportsMultipleEditorsPerDocument: true,
                webviewOptions: { enableFindWidget: true },
            }),
            vscode.workspace.registerTextDocumentContentProvider(sourceScheme, this),
            vscode.workspace.onDidChangeTextDocument(event => {
                for (const state of this.editors) {
                    if (sameFile(event.document.uri, state.document.uri)) this.invalidate(state);
                    else this.postStatus(state);
                }
                this.refreshSources(event.document.uri, false);
            }),
            vscode.workspace.onDidSaveTextDocument(document => {
                for (const state of this.editors) {
                    if (this.dependsOn(state.result, document.uri)) this.invalidate(state);
                }
                this.refreshSources(document.uri, true);
            }),
            vscode.workspace.onDidCloseTextDocument(document => {
                const source = this.sources.get(document.uri.toString());
                source?.watcher?.dispose();
                this.sources.delete(document.uri.toString());
                for (const state of this.editors) this.postStatus(state);
            }),
        );
        this.command('bnd.showEffective', uri => this.open(uri, false));
        this.command('bnd.showEffectiveToSide', uri => this.open(uri, true));
        this.command('bnd.openSource', async uri => {
            const target = this.target(uri);
            if (target) await vscode.commands.executeCommand('vscode.openWith', target, 'default');
        });
        this.command('bnd.showEffectiveSource', uri => this.openSource(uri));
    }

    private command(name: string, action: (uri?: vscode.Uri) => Promise<unknown>): void {
        this.subscriptions.push(vscode.commands.registerCommand(name, async (arg?: vscode.Uri | { uri?: vscode.Uri }) => {
            try { await action(arg instanceof vscode.Uri ? arg : arg?.uri); }
            catch (error) { void vscode.window.showErrorMessage(message(error)); }
        }));
    }

    private target(uri?: vscode.Uri): vscode.Uri | undefined {
        if (uri instanceof vscode.Uri && acceptsEffectiveUri(uri)) return uri;
        const active = [...this.editors].find(state => state.panel.active);
        if (active) return active.document.uri;
        const current = vscode.window.activeTextEditor?.document.uri;
        if (current?.scheme === sourceScheme) return this.sources.get(current.toString())?.target;
        return current && acceptsEffectiveUri(current) ? current : undefined;
    }

    private async open(uri: vscode.Uri | undefined, beside: boolean): Promise<void> {
        const target = this.target(uri);
        if (!target) throw new Error('Open or select a saved .bnd or .bndrun file.');
        await vscode.commands.executeCommand('vscode.openWith', target, effectiveViewType, {
            viewColumn: beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
            preview: false,
        });
    }

    private async openSource(uri?: vscode.Uri, options?: EffectiveOptions): Promise<void> {
        const target = this.target(uri);
        if (!target) throw new Error('Open or select a .bnd or .bndrun file.');
        const active = [...this.editors].find(state => state.panel.active);
        const source = vscode.Uri.from({ scheme: sourceScheme, path: `${target.path}.effective.bnd`,
            query: JSON.stringify({ uri: target.toString(), ...(options ?? active?.options ?? { expanded: true, merged: true }) }) });
        const document = await vscode.workspace.openTextDocument(source);
        await vscode.languages.setTextDocumentLanguage(document, 'bnd');
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    }

    async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
        const parameters = JSON.parse(uri.query) as EffectiveOptions & { uri: string };
        const target = vscode.Uri.parse(parameters.uri);
        if (!acceptsEffectiveUri(target)) throw new Error('Unsupported effective source URI.');
        const document = await vscode.workspace.openTextDocument(target);
        const result = await this.request(document, parameters, token);
        const key = uri.toString();
        this.sources.get(key)?.watcher?.dispose();
        this.sources.set(key, { target, dependencies: result.dependencies,
            watcher: watchDependencies(result.dependencies, () => this.sourceChanged.fire(uri)) });
        const dirty = this.dirtyDependencies(result, target);
        return `${dirty ? '# Included files have unsaved edits; using their saved contents.\n' : ''}${result.effectiveSource}`;
    }

    resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
        const state: EditorState = { document, panel, options: { expanded: true, merged: true },
            generation: 0, running: false, pending: false, disposed: false };
        this.editors.add(state);
        panel.webview.options = { enableScripts: true, localResourceRoots: [
            vscode.Uri.joinPath(this.context.extensionUri, 'media'),
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
        ] };
        panel.webview.html = effectiveHtml(panel.webview, this.context.extensionUri);
        const receiver = panel.webview.onDidReceiveMessage(async (event: unknown) => {
            if (!event || typeof event !== 'object') return;
            const action = event as { type?: string; expanded?: boolean; merged?: boolean; row?: number; origin?: number };
            try {
                switch (action.type) {
                    case 'ready':
                    case 'options':
                        if (typeof action.expanded === 'boolean' && typeof action.merged === 'boolean') {
                            state.options = { expanded: action.expanded, merged: action.expanded && action.merged };
                        }
                        this.invalidate(state, 0);
                        break;
                    case 'refresh': this.invalidate(state, 0); break;
                    case 'source': await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default'); break;
                    case 'effectiveSource': await this.openSource(document.uri, state.options); break;
                    case 'copy':
                        if (state.result) await vscode.env.clipboard.writeText(state.result.effectiveSource);
                        break;
                    case 'origin':
                        if (!Number.isInteger(action.row) || !Number.isInteger(action.origin)) return;
                        const row = state.result?.rows[action.row!];
                        const location = row?.provenances[action.origin!]?.uri;
                        if (!location || !row) return;
                        const uri = vscode.Uri.parse(location);
                        if (uri.scheme !== 'file') return;
                        const source = await vscode.workspace.openTextDocument(uri);
                        const editor = await vscode.window.showTextDocument(source, vscode.ViewColumn.Beside);
                        const escaped = row.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const match = new RegExp(`^[ \\t]*${escaped}(?:[ \\t:=]|\\.)`, 'm').exec(source.getText());
                        if (match) {
                            const position = source.positionAt(match.index);
                            editor.selection = new vscode.Selection(position, position);
                            editor.revealRange(new vscode.Range(position, position));
                        }
                        break;
                }
            } catch (error) { void panel.webview.postMessage({ type: 'error', message: message(error) }); }
        });
        const visibility = panel.onDidChangeViewState(() => {
            if (panel.visible && state.pending) this.invalidate(state, 0);
        });
        panel.onDidDispose(() => {
            state.disposed = true;
            clearTimeout(state.timer);
            state.token?.cancel();
            state.token?.dispose();
            state.watchers?.dispose();
            receiver.dispose();
            visibility.dispose();
            this.editors.delete(state);
        });
    }

    refresh(): void {
        for (const state of this.editors) this.invalidate(state, 0);
        for (const source of this.sources.keys()) this.sourceChanged.fire(vscode.Uri.parse(source));
    }

    private invalidate(state: EditorState, delay = 300): void {
        state.generation++;
        state.pending = true;
        state.result = undefined;
        clearTimeout(state.timer);
        void state.panel.webview.postMessage({ type: 'loading' });
        state.timer = setTimeout(() => void this.update(state), delay);
    }

    private async update(state: EditorState): Promise<void> {
        if (state.disposed || state.running || !state.panel.visible) return;
        const generation = state.generation;
        state.running = true;
        state.pending = false;
        state.token = new vscode.CancellationTokenSource();
        try {
            const result = await this.request(state.document, state.options, state.token.token);
            if (state.disposed || generation !== state.generation) return;
            if (result.documentVersion !== state.document.version) {
                this.invalidate(state);
                return;
            }
            state.result = result;
            state.watchers?.dispose();
            state.watchers = watchDependencies(result.dependencies, () => this.invalidate(state));
            void state.panel.webview.postMessage({ type: 'result', result });
            this.postStatus(state);
        } catch (error) {
            if (!state.disposed && generation === state.generation) {
                void state.panel.webview.postMessage({ type: 'error', message: message(error) });
            }
        } finally {
            state.running = false;
            state.token.dispose();
            state.token = undefined;
            if (state.pending && !state.disposed) {
                clearTimeout(state.timer);
                state.timer = setTimeout(() => void this.update(state), 300);
            }
        }
    }

    private dirtyDependencies(result: EffectiveResult | undefined, target: vscode.Uri): boolean {
        return vscode.workspace.textDocuments.some(document => document.isDirty
            && !sameFile(document.uri, target) && this.dependsOn(result, document.uri));
    }

    private postStatus(state: EditorState): void {
        if (!state.disposed) void state.panel.webview.postMessage({ type: 'status', dirty: state.document.isDirty,
            dirtyDependencies: this.dirtyDependencies(state.result, state.document.uri) });
    }

    private dependsOn(result: EffectiveResult | undefined, uri: vscode.Uri): boolean {
        return result?.dependencies.some(dependency => sameFile(vscode.Uri.parse(dependency), uri)) ?? false;
    }

    private refreshSources(uri: vscode.Uri, saved: boolean): void {
        for (const [key, source] of this.sources) {
            if (sameFile(source.target, uri) || (saved && source.dependencies.some(item => sameFile(vscode.Uri.parse(item), uri)))) {
                this.sourceChanged.fire(vscode.Uri.parse(key));
            }
        }
    }

    dispose(): void {
        for (const state of this.editors) state.panel.dispose();
        for (const source of this.sources.values()) source.watcher?.dispose();
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.sourceChanged.dispose();
    }
}

function sameFile(left: vscode.Uri, right: vscode.Uri): boolean {
    if (left.scheme !== right.scheme) return false;
    return process.platform === 'win32' ? left.fsPath.toLowerCase() === right.fsPath.toLowerCase() : left.fsPath === right.fsPath;
}

function watchDependencies(dependencies: string[], changed: () => void): vscode.Disposable {
    const directories = new Set(dependencies.map(uri => vscode.Uri.parse(uri))
        .filter(uri => uri.scheme === 'file').map(uri => path.dirname(uri.fsPath)));
    const watchers = [...directories].map(directory => {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(directory, '*'));
        watcher.onDidChange(changed);
        watcher.onDidCreate(changed);
        watcher.onDidDelete(changed);
        return watcher;
    });
    return vscode.Disposable.from(...watchers);
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function effectiveHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = randomBytes(18).toString('base64');
    const asset = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts)).toString();
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')}">
<link rel="stylesheet" href="${asset('media', 'effective.css')}">
<title>Bnd Effective</title></head><body>
<header><div class="toolbar">
<input id="filter" type="search" placeholder="Filter properties" aria-label="Filter properties">
<label><input id="expanded" type="checkbox" checked>Expanded</label>
<label><input id="merged" type="checkbox" checked>Merged</label>
<div class="actions">
<button id="refresh" title="Refresh" aria-label="Refresh"><i class="codicon codicon-refresh" aria-hidden="true"></i></button>
<button id="copy" title="Copy effective source" aria-label="Copy effective source" disabled><i class="codicon codicon-copy" aria-hidden="true"></i></button>
<button id="effectiveSource" title="Show effective source" aria-label="Show effective source"><i class="codicon codicon-file-code" aria-hidden="true"></i></button>
<button id="source" title="Open original source" aria-label="Open original source"><i class="codicon codicon-go-to-file" aria-hidden="true"></i></button>
</div></div>
<div class="summary"><span id="count" role="status">Loading properties...</span><span id="snapshot"></span></div>
<div id="notice" role="status" hidden></div><div id="error" role="alert" hidden></div>
</header>
<main aria-label="Effective properties"><table><colgroup><col><col><col><col></colgroup>
<thead><tr><th scope="col">Key</th><th scope="col">Value</th><th scope="col">Provenance</th><th scope="col">Errors</th></tr></thead>
<tbody id="rows"></tbody></table><p id="empty" hidden>No matching properties.</p></main>
<script nonce="${nonce}" src="${asset('media', 'effective.js')}"></script></body></html>`;
}