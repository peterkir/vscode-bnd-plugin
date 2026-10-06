import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { ResolutionRepositoryEntry, resolutionEntryMime } from './bndRepositories';

export const resolutionViewId = 'bnd.resolution';
export const resolutionAnalyzeCommand = 'bnd.resolution.analyze';
const stateKey = 'bnd.resolution.resources';

export interface ResolutionRow {
    source: string;
    namespace: string;
    attributes: Record<string, unknown>;
    directives: Record<string, unknown>;
    optional?: boolean;
    resolved?: boolean;
}

export interface ResolutionAnalysis {
    resources: string[];
    requirements: ResolutionRow[];
    capabilities: ResolutionRow[];
}

export interface ResolutionServer {
    supports(command: string): Promise<boolean>;
    execute(command: string, args: unknown[], token?: vscode.CancellationToken): Promise<unknown>;
}

export function filterResolutionRows(rows: ResolutionRow[], filter: string,
    hideOptional = false, unresolvedOnly = false): ResolutionRow[] {
    const terms = filter.trim().split(/\s+/).filter(Boolean).map(term => {
        const pattern = term.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp(pattern, 'i');
    });
    return rows.filter(row => {
        if (hideOptional && row.optional) return false;
        if (unresolvedOnly && row.resolved) return false;
        const searchable = `${row.namespace} ${row.source} ${JSON.stringify(row.attributes)} ${JSON.stringify(row.directives)}`;
        return terms.every(term => term.test(searchable));
    });
}

export function formatResolutionRow(row: ResolutionRow): string {
    return [
        `${row.namespace} ${JSON.stringify(row.attributes)}`,
        `Directives: ${JSON.stringify(row.directives)}`,
        `Source: ${row.source}`,
    ].join('\n');
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') throw new Error('Incompatible bnd resolution response.');
    const result = value as Record<string, unknown>;
    if (typeof result.error === 'string') throw new Error(result.error);
    return result;
}

function parseRow(value: unknown): ResolutionRow {
    const row = object(value);
    if (typeof row.namespace !== 'string' || typeof row.source !== 'string') {
        throw new Error('Incompatible bnd resolution row.');
    }
    return {
        source: row.source,
        namespace: row.namespace,
        attributes: row.attributes && typeof row.attributes === 'object' ? row.attributes as Record<string, unknown> : {},
        directives: row.directives && typeof row.directives === 'object' ? row.directives as Record<string, unknown> : {},
        optional: row.optional === true,
        resolved: row.resolved === true,
    };
}

function parseAnalysis(value: unknown): ResolutionAnalysis {
    const result = object(value);
    return {
        resources: Array.isArray(result.resources) ? result.resources.filter((entry): entry is string => typeof entry === 'string') : [],
        requirements: Array.isArray(result.requirements) ? result.requirements.map(parseRow) : [],
        capabilities: Array.isArray(result.capabilities) ? result.capabilities.map(parseRow) : [],
    };
}

export class ResolutionViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly resources = new Set<string>();
    private view: vscode.WebviewView | undefined;
    private selectionRevision = 0;
    private analysisRevision = 0;

    constructor(private readonly context: vscode.ExtensionContext, private readonly server: ResolutionServer) {
        for (const uri of context.workspaceState.get<string[]>(stateKey, [])) this.resources.add(uri);
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true };
        view.webview.html = this.html(view.webview);
        this.post({ type: 'resources', resources: [...this.resources] });
        this.disposables.push(view.webview.onDidReceiveMessage(message => {
            void this.handleMessage(message).catch(error => this.postError(error));
        }));
        this.disposables.push(view.onDidDispose(() => {
            if (this.view === view) this.view = undefined;
        }));
        void this.refresh();
    }

    async add(uri?: vscode.Uri): Promise<void> {
        let inputs: vscode.Uri[] = uri ? [uri] : [];
        if (!inputs.length) {
            const active = vscode.window.activeTextEditor?.document.uri;
            if (active && this.isSupported(active)) inputs = [active];
            else inputs = await vscode.window.showOpenDialog({
                canSelectMany: true,
                filters: { 'bnd resources': ['bnd', 'jar'] },
                openLabel: 'Add to Resolution View',
            }) ?? [];
        }
        for (const input of inputs) {
            if (!this.isSupported(input)) {
                void vscode.window.showWarningMessage('Resolution View accepts local .bnd and .jar files.');
                continue;
            }
            this.resources.add(input.toString());
        }
        await this.saveAndRefresh();
    }

    async remove(uri: string): Promise<void> {
        this.resources.delete(uri);
        await this.saveAndRefresh();
    }

    async clear(): Promise<void> {
        this.resources.clear();
        await this.saveAndRefresh();
    }

    async refresh(): Promise<void> {
        const revision = ++this.analysisRevision;
        if (!this.view) return;
        if (!vscode.workspace.isTrusted) {
            this.post({ type: 'error', message: 'Resolution analysis requires a trusted workspace.' });
            return;
        }
        if (!this.resources.size) {
            this.post({ type: 'data', data: { resources: [], requirements: [], capabilities: [] } satisfies ResolutionAnalysis });
            return;
        }
        if (!(await this.server.supports(resolutionAnalyzeCommand))) {
            this.post({ type: 'error', message: 'Resolution analysis requires an updated Java bnd Language Server.' });
            return;
        }
        try {
            const response = await this.server.execute(resolutionAnalyzeCommand, [{ uris: [...this.resources] }]);
            if (revision === this.analysisRevision) this.post({ type: 'data', data: parseAnalysis(response) });
        } catch (error) {
            if (revision === this.analysisRevision) this.postError(error);
        }
    }

    dispose(): void {
        this.disposables.splice(0).forEach(disposable => disposable.dispose());
    }

    private async saveAndRefresh(): Promise<void> {
        await this.context.workspaceState.update(stateKey, [...this.resources]);
        this.post({ type: 'resources', resources: [...this.resources] });
        await this.refresh();
    }

    private async handleMessage(message: { type?: string; uri?: string; text?: string; entries?: unknown; uris?: unknown }): Promise<void> {
        switch (message?.type) {
            case 'add':
                await this.add();
                break;
            case 'refresh':
                await this.refresh();
                break;
            case 'clear':
                await this.clear();
                break;
            case 'remove':
                if (typeof message.uri === 'string') await this.remove(message.uri);
                break;
            case 'copy':
                if (typeof message.text === 'string') await vscode.env.clipboard.writeText(message.text);
                break;
            case 'addRepositoryEntries':
                await this.addRepositoryEntries(message.entries);
                break;
            case 'addUris':
                if (Array.isArray(message.uris)) {
                    for (const uri of message.uris) {
                        if (typeof uri !== 'string') continue;
                        const parsed = vscode.Uri.parse(uri);
                        if (this.isSupported(parsed)) this.resources.add(parsed.toString());
                    }
                    await this.saveAndRefresh();
                }
                break;
            case 'ready':
                this.post({ type: 'resources', resources: [...this.resources] });
                await this.refresh();
                break;
        }
    }

    async selectRepositoryEntries(entries: ResolutionRepositoryEntry[]): Promise<void> {
        await this.addRepositoryEntries(entries, true);
    }

    async addRepositoryEntries(value: unknown, replace = false): Promise<void> {
        if (!vscode.workspace.isTrusted) throw new Error('Resolution analysis requires a trusted workspace.');
        if (!Array.isArray(value)) throw new Error('Invalid repository drag data.');
        const revision = ++this.selectionRevision;
        const uris: string[] = [];
        for (const entry of value) {
            if (!entry || typeof entry !== 'object') continue;
            const candidate = entry as Partial<ResolutionRepositoryEntry>;
            if (typeof candidate.workspace !== 'string' || typeof candidate.repo !== 'number'
                || typeof candidate.repoName !== 'string' || typeof candidate.bsn !== 'string'
                || (candidate.version !== undefined && typeof candidate.version !== 'string')) continue;
            let version = candidate.version;
            if (!version) {
                const listing = object(await this.server.execute('bnd.repositories.versions', [candidate]));
                const latest = Array.isArray(listing.versions) ? listing.versions[0] : undefined;
                if (!latest || typeof latest.version !== 'string') throw new Error(`No versions available for ${candidate.bsn}.`);
                version = latest.version;
            }
            const result = object(await this.server.execute('bnd.repositories.get', [{ ...candidate, version }]));
            if (typeof result.file !== 'string') throw new Error('Incompatible bnd repository response.');
            uris.push(vscode.Uri.file(result.file).toString());
        }
        if (replace && revision !== this.selectionRevision) return;
        if (replace) this.resources.clear();
        uris.forEach(uri => this.resources.add(uri));
        await this.saveAndRefresh();
    }

    private postError(error: unknown): void {
        this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }

    private post(message: unknown): void {
        void this.view?.webview.postMessage(message);
    }

    private isSupported(uri: vscode.Uri): boolean {
        return uri.scheme === 'file' && /\.(bnd|jar)$/i.test(uri.fsPath);
    }

    private html(webview: vscode.Webview): string {
        const nonce = randomBytes(16).toString('base64');
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
* { box-sizing: border-box; }
body { padding: 0 12px 12px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); }
h1 { font-size: 13px; font-weight: 600; margin: 0 auto 0 0; }
button, input { color: inherit; font: inherit; }
button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; padding: 4px 8px; cursor: pointer; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
#filter { width: min(360px, 100%); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 5px 7px; }
.controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 8px 0; }
.controls label { display: inline-flex; align-items: center; gap: 5px; }
#resources { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 0 8px; }
.resource { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 5px; }
.resource span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resource button { padding: 0 3px; background: transparent; }
body.dragover { outline: 1px dashed var(--vscode-focusBorder); outline-offset: -4px; }
.columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; min-height: 140px; }
section { min-width: 0; }
h2 { font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border); padding: 7px 0; margin: 0; }
.group { font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); padding: 8px 0 3px; }
.row { padding: 5px 7px; border-left: 2px solid var(--vscode-panel-border); margin: 3px 0; cursor: pointer; overflow: hidden; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row.unresolved { border-left-color: var(--vscode-editorError-foreground); }
.row .main { display: flex; align-items: baseline; gap: 7px; overflow-wrap: anywhere; }
.row code { font-family: var(--vscode-editor-font-family); font-size: 11px; }
.row .meta { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 3px; overflow-wrap: anywhere; }
.status { color: var(--vscode-descriptionForeground); font-size: 10px; white-space: nowrap; }
#message { padding: 8px 0; color: var(--vscode-descriptionForeground); }
#message.error { color: var(--vscode-errorForeground); }
@media (max-width: 560px) { .columns { grid-template-columns: minmax(0, 1fr); } }
</style>
</head>
<body>
<header><h1>Resolution</h1><button data-action="add" title="Add active file or choose resources">Add resource</button><button data-action="refresh" title="Refresh analysis">Refresh</button><button data-action="clear" title="Remove all resources">Clear</button></header>
<div class="controls"><input id="filter" type="search" placeholder="Filter; spaces separate terms, * and ? are wildcards" aria-label="Filter requirements and capabilities"><label><input id="hideOptional" type="checkbox">Hide optional</label><label><input id="unresolvedOnly" type="checkbox">Unresolved only</label></div>
<div id="resources" aria-label="Analyzed resources"></div><div id="message" role="status">Add a .bnd file, JAR, or repository bundle to inspect its requirements and capabilities.</div>
<div class="columns"><section><h2 id="reqTitle">Requirements</h2><div id="requirements"></div></section><section><h2 id="capTitle">Capabilities</h2><div id="capabilities"></div></section></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const repositoryEntryMime = '${resolutionEntryMime}';
const state = { resources: [], requirements: [], capabilities: [] };
const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const details = row => [row.namespace + ' ' + JSON.stringify(row.attributes), 'Directives: ' + JSON.stringify(row.directives), 'Source: ' + row.source].join('\\n');
function rowMatches(row, terms) {
  const searchable = row.namespace + ' ' + row.source + ' ' + JSON.stringify(row.attributes) + ' ' + JSON.stringify(row.directives);
    const escapeChar = char => '|.^$+(){}[]\\\\'.includes(char) ? '\\\\' + char : char;
    return terms.every(term => { const pattern = term.split('').map(char => char === '*' ? '.*' : char === '?' ? '.' : escapeChar(char)).join(''); return new RegExp(pattern, 'i').test(searchable); });
}
function visibleRows(rows, requirements) {
  const terms = document.getElementById('filter').value.trim().split(/\\s+/).filter(Boolean);
  return rows.filter(row => !(requirements && document.getElementById('hideOptional').checked && row.optional)
    && !(requirements && document.getElementById('unresolvedOnly').checked && row.resolved)
    && rowMatches(row, terms));
}
function renderRows(target, rows, requirements) {
  const groups = new Map();
  for (const row of visibleRows(rows, requirements)) { const entries = groups.get(row.namespace) || []; entries.push(row); groups.set(row.namespace, entries); }
  target.replaceChildren();
  for (const [namespace, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const group = document.createElement('div'); group.className = 'group'; group.textContent = namespace + ' (' + entries.length + ')'; target.append(group);
    for (const row of entries) {
      const item = document.createElement('div'); item.className = 'row' + (requirements && !row.resolved ? ' unresolved' : '');
      const value = row.attributes[row.namespace] ?? Object.values(row.attributes)[0] ?? '';
      const status = requirements ? (row.resolved ? 'matched' : 'unresolved') : '';
      item.title = details(row); item.dataset.copy = details(row); item.tabIndex = 0; item.setAttribute('role', 'button');
      item.innerHTML = '<div class="main"><code>' + esc(value) + '</code><span class="status">' + status + (row.optional ? ' · optional' : '') + '</span></div><div class="meta">' + esc(row.source) + '</div>';
      item.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: item.dataset.copy }));
      item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); } });
      target.append(item);
    }
  }
}
function render() {
  const requirements = visibleRows(state.requirements, true);
  const capabilities = visibleRows(state.capabilities, false);
  document.getElementById('reqTitle').textContent = 'Requirements (' + requirements.length + ')';
  document.getElementById('capTitle').textContent = 'Capabilities (' + capabilities.length + ')';
  renderRows(document.getElementById('requirements'), state.requirements, true);
  renderRows(document.getElementById('capabilities'), state.capabilities, false);
  const list = document.getElementById('resources'); list.replaceChildren();
  for (const uri of state.resources) {
    const chip = document.createElement('div'); chip.className = 'resource';
    const label = document.createElement('span'); label.textContent = decodeURIComponent(uri.split(/[\\/]/).pop().split('?')[0]); label.title = uri;
    const remove = document.createElement('button'); remove.textContent = 'x'; remove.title = 'Remove resource'; remove.setAttribute('aria-label', 'Remove ' + label.textContent);
    remove.addEventListener('click', () => vscode.postMessage({ type: 'remove', uri }));
    chip.append(label, remove); list.append(chip);
  }
  const message = document.getElementById('message');
  message.textContent = state.resources.length ? '' : 'Add a .bnd file, JAR, or repository bundle to inspect its requirements and capabilities.';
  message.className = '';
}
document.querySelectorAll('header button').forEach(button => button.addEventListener('click', () => vscode.postMessage({ type: button.dataset.action })));
document.getElementById('filter').addEventListener('input', render);
document.getElementById('hideOptional').addEventListener('change', render);
document.getElementById('unresolvedOnly').addEventListener('change', render);
document.addEventListener('dragover', event => {
    if (Array.from(event.dataTransfer.types).some(type => type === repositoryEntryMime || type === 'text/uri-list')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; document.body.classList.add('dragover'); }
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('dragover'); });
document.addEventListener('drop', event => {
    document.body.classList.remove('dragover');
    const raw = event.dataTransfer.getData(repositoryEntryMime);
        const uriList = event.dataTransfer.getData('text/uri-list');
        if (!raw && !uriList) return;
    event.preventDefault();
        try {
            if (raw) vscode.postMessage({ type: 'addRepositoryEntries', entries: JSON.parse(raw) });
            else vscode.postMessage({ type: 'addUris', uris: uriList.split(/\\r?\\n/).filter(uri => uri && !uri.startsWith('#')) });
        }
    catch { vscode.postMessage({ type: 'error', message: 'Invalid repository drag data.' }); }
});
window.addEventListener('message', event => {
  const message = event.data;
    if (message.type === 'data') { state.requirements = message.data.requirements; state.capabilities = message.data.capabilities; render(); }
  if (message.type === 'resources') { state.resources = message.resources; render(); }
  if (message.type === 'error') { const target = document.getElementById('message'); target.textContent = message.message; target.className = 'error'; }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}

export function registerResolutionView(context: vscode.ExtensionContext, server: ResolutionServer): ResolutionViewProvider {
    const provider = new ResolutionViewProvider(context, server);
    context.subscriptions.push(
        provider,
        vscode.window.registerWebviewViewProvider(resolutionViewId, provider, { webviewOptions: { retainContextWhenHidden: true } }),
        vscode.commands.registerCommand('bnd.resolution.add', (resource?: vscode.Uri | { uri?: vscode.Uri }) => {
                        const uri = resource && typeof resource === 'object' && 'uri' in resource ? resource.uri : resource;
                        return provider.add(uri && typeof uri === 'object' && 'fsPath' in uri ? uri as vscode.Uri : undefined);
        }),
        vscode.commands.registerCommand('bnd.resolution.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('bnd.resolution.clear', () => provider.clear()),
    );
    return provider;
}