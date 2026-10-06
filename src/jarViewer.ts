import * as path from 'path';
import * as zlib from 'zlib';
import { randomBytes } from 'crypto';
import * as vscode from 'vscode';

export const jarViewType = 'bnd.jarViewer';
export const jarEntryScheme = 'bnd-jar';
export const jarPrintCommand = 'bnd.jar.printText';
/** Same read limit as the bndtools JAR editor. */
export const readLimit = 1_000_000;
export const charsets = ['utf-8', 'utf-16le', 'utf-16be', 'iso-8859-1', 'windows-1252', 'iso-8859-15', 'us-ascii',
    'shift_jis', 'euc-jp', 'gbk', 'big5', 'euc-kr', 'koi8-r']
    .filter(label => { try { new TextDecoder(label); return true; } catch { return false; } });

export interface JarEntry {
    name: string;
    directory: boolean;
    method: number;
    size: number;
    compressedSize: number;
    modified: number;
    offset: number;
}

export interface JarArchive { data: Uint8Array; entries: Map<string, JarEntry> }

export type ShowAs = 'auto' | 'text' | 'hex';

export type JarPrinter = (uri: vscode.Uri, token: vscode.CancellationToken) => Promise<string>;

/** Parses the ZIP central directory, including ZIP64 archives. */
export function readArchive(data: Uint8Array): JarArchive {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a ZIP archive: end of central directory not found.');
    let count = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    if ((count === 0xffff || offset === 0xffffffff) && eocd >= 20 && buffer.readUInt32LE(eocd - 20) === 0x07064b50) {
        const zip64 = Number(buffer.readBigUInt64LE(eocd - 12));
        if (buffer.readUInt32LE(zip64) !== 0x06064b50) throw new Error('Corrupt ZIP64 end of central directory.');
        count = Number(buffer.readBigUInt64LE(zip64 + 32));
        offset = Number(buffer.readBigUInt64LE(zip64 + 48));
    }
    const entries = new Map<string, JarEntry>();
    for (let i = 0, p = offset; i < count; i++) {
        if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
        const nameLength = buffer.readUInt16LE(p + 28);
        const extraLength = buffer.readUInt16LE(p + 30);
        const commentLength = buffer.readUInt16LE(p + 32);
        const raw = buffer.toString('utf8', p + 46, p + 46 + nameLength);
        let size = buffer.readUInt32LE(p + 24);
        let compressedSize = buffer.readUInt32LE(p + 20);
        let local = buffer.readUInt32LE(p + 42);
        for (let e = p + 46 + nameLength, end = e + extraLength; e + 4 <= end;) {
            const id = buffer.readUInt16LE(e);
            const length = buffer.readUInt16LE(e + 2);
            if (id === 0x0001) {
                let q = e + 4;
                if (size === 0xffffffff) { size = Number(buffer.readBigUInt64LE(q)); q += 8; }
                if (compressedSize === 0xffffffff) { compressedSize = Number(buffer.readBigUInt64LE(q)); q += 8; }
                if (local === 0xffffffff) local = Number(buffer.readBigUInt64LE(q));
            }
            e += 4 + length;
        }
        const name = raw.split('/').filter(part => part && part !== '.' && part !== '..').join('/');
        if (name) {
            entries.set(name, {
                name, directory: raw.endsWith('/'), method: buffer.readUInt16LE(p + 10), size, compressedSize,
                modified: dosTime(buffer.readUInt16LE(p + 14), buffer.readUInt16LE(p + 12)), offset: local,
            });
        }
        p += 46 + nameLength + extraLength + commentLength;
    }
    return { data, entries };
}

function dosTime(date: number, time: number): number {
    return new Date((date >> 9) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime();
}

/** Reads an entry, inflating at most limit bytes when a limit is given. */
export async function readEntry(archive: JarArchive, entry: JarEntry, limit?: number): Promise<Buffer> {
    const buffer = Buffer.from(archive.data.buffer, archive.data.byteOffset, archive.data.byteLength);
    if (buffer.readUInt32LE(entry.offset) !== 0x04034b50) throw new Error(`Corrupt local header for ${entry.name}.`);
    const start = entry.offset + 30 + buffer.readUInt16LE(entry.offset + 26) + buffer.readUInt16LE(entry.offset + 28);
    const compressed = buffer.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return Buffer.from(limit === undefined ? compressed : compressed.subarray(0, limit));
    if (entry.method !== 8) throw new Error(`Unsupported compression method ${entry.method} for ${entry.name}.`);
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        const inflater = zlib.createInflateRaw();
        inflater.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            total += chunk.length;
            if (limit !== undefined && total >= limit) {
                inflater.destroy();
                resolve(Buffer.concat(chunks).subarray(0, limit));
            }
        });
        inflater.on('error', reject);
        inflater.on('end', () => resolve(Buffer.concat(chunks)));
        inflater.end(compressed);
    });
}

/** Port of aQute.lib.hex.Hex.isBinary: a buffer containing a 0 byte is binary. */
export function isBinary(data: Uint8Array): boolean {
    return data.includes(0);
}

/** Port of aQute.lib.hex.Hex.format: 16 bytes per row, two groups of 8, hex and ASCII columns. */
export function hexFormat(data: Uint8Array): string {
    const lines: string[] = [];
    for (let rover = 0; rover < data.length; rover += 16) {
        let hex = '';
        let ascii = '';
        for (let g = 0, p = rover; g < 2 && p < data.length; g++) {
            hex += ' ';
            ascii += '  ';
            for (let i = 0; i < 8 && p < data.length; i++) {
                const c = data[p++];
                hex += ' ' + c.toString(16).toUpperCase().padStart(2, '0');
                ascii += c < 0x20 || c > 0x7e ? '.' : String.fromCharCode(c);
            }
        }
        lines.push(`0x${rover.toString(16).padStart(4, '0')}${hex.padEnd(50)}${ascii}\n`);
    }
    return lines.join('');
}

export function formatSize(size: number): string {
    const prefixes = ['', 'k', 'M', 'G', 'T', 'P', 'E'];
    let index = 0;
    let value = size;
    while (value >= 1000 && index < prefixes.length - 1) { value /= 1000; index++; }
    return index === 0 ? `${value} b` : `${value.toFixed(2)} ${prefixes[index]}b`;
}

export function renderEntry(data: Buffer, showAs: ShowAs, charset: string, limited: boolean): { content: string; mode: 'text' | 'hex' } {
    const mode = showAs === 'auto' ? (isBinary(data) ? 'hex' : 'text') : showAs;
    let content = mode === 'hex' ? hexFormat(data)
        : new TextDecoder(charsets.includes(charset) ? charset : 'utf-8').decode(data);
    if (limited) content += `\n\nLimited to ${readLimit}`;
    return { content, mode };
}

/** bndtools selects feature.xml, then META-INF/MANIFEST.MF, when a JAR is opened. */
export function defaultSelection(entries: Map<string, JarEntry>): string | undefined {
    return ['feature.xml', 'META-INF/MANIFEST.MF'].find(name => entries.has(name));
}

export function entryUri(jar: vscode.Uri, name: string): vscode.Uri {
    return vscode.Uri.from({ scheme: jarEntryScheme, path: `/${name}`, query: jar.toString() });
}

export function acceptsJarUri(uri: vscode.Uri): boolean {
    return /\.jar$/i.test(uri.path);
}

class JarDocument implements vscode.CustomDocument {
    constructor(readonly uri: vscode.Uri) {}
    dispose(): void {}
}

export class JarViewerProvider implements vscode.CustomReadonlyEditorProvider<JarDocument>, vscode.FileSystemProvider, vscode.Disposable {
    private readonly archives = new Map<string, Promise<JarArchive>>();
    private readonly fileChanged = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.fileChanged.event;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext, private readonly print: JarPrinter) {
        this.subscriptions.push(
            vscode.window.registerCustomEditorProvider(jarViewType, this, {
                supportsMultipleEditorsPerDocument: true,
                webviewOptions: { enableFindWidget: true, retainContextWhenHidden: false },
            }),
            vscode.workspace.registerFileSystemProvider(jarEntryScheme, this, { isCaseSensitive: true, isReadonly: true }),
            vscode.commands.registerCommand('bnd.jar.open', async (target?: vscode.Uri | { uri?: vscode.Uri }) => {
                const uri = target instanceof vscode.Uri ? target : target?.uri ?? activeJar();
                if (!(uri instanceof vscode.Uri) || !acceptsJarUri(uri)) {
                    void vscode.window.showWarningMessage('Select a .jar file to open in the bnd JAR Viewer.');
                    return;
                }
                await vscode.commands.executeCommand('vscode.openWith', uri, jarViewType);
            }),
        );
    }

    archive(uri: vscode.Uri): Promise<JarArchive> {
        const key = uri.toString();
        let archive = this.archives.get(key);
        if (!archive) {
            archive = Promise.resolve(vscode.workspace.fs.readFile(uri)).then(readArchive);
            archive.catch(() => this.archives.delete(key));
            this.archives.set(key, archive);
        }
        return archive;
    }

    private invalidate(uri: vscode.Uri): void {
        this.archives.delete(uri.toString());
        this.fileChanged.fire([{ type: vscode.FileChangeType.Changed, uri: vscode.Uri.from({ scheme: jarEntryScheme, path: '/', query: uri.toString() }) }]);
    }

    openCustomDocument(uri: vscode.Uri): JarDocument {
        return new JarDocument(uri);
    }

    resolveCustomEditor(document: JarDocument, panel: vscode.WebviewPanel): void {
        const uri = document.uri;
        let printToken: vscode.CancellationTokenSource | undefined;
        panel.webview.options = { enableScripts: true, localResourceRoots: [
            vscode.Uri.joinPath(this.context.extensionUri, 'media'),
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
        ] };
        panel.webview.html = jarViewerHtml(panel.webview, this.context.extensionUri, path.basename(uri.path));
        const post = (message: unknown) => void panel.webview.postMessage(message);
        const sendTree = async () => {
            try {
                const archive = await this.archive(uri);
                const entries = [...archive.entries.values()].map(entry => ({ name: entry.name, directory: entry.directory }));
                post({ type: 'tree', entries, selection: defaultSelection(archive.entries), charsets });
            } catch (error) {
                post({ type: 'error', message: message(error) });
            }
        };
        const receiver = panel.webview.onDidReceiveMessage(async (event: unknown) => {
            if (!event || typeof event !== 'object') return;
            const action = event as { type?: string; name?: string; showAs?: ShowAs; charset?: string; limit?: boolean };
            try {
                switch (action.type) {
                    case 'ready': await sendTree(); break;
                    case 'select': {
                        if (typeof action.name !== 'string') return;
                        const archive = await this.archive(uri);
                        const entry = archive.entries.get(action.name);
                        if (!entry || entry.directory) {
                            post({ type: 'entry', name: action.name, content: '', size: '', modified: '' });
                            return;
                        }
                        const limit = action.limit !== false ? readLimit : undefined;
                        const data = await readEntry(archive, entry, limit);
                        const showAs: ShowAs = action.showAs === 'text' || action.showAs === 'hex' ? action.showAs : 'auto';
                        const rendered = renderEntry(data, showAs, action.charset ?? 'utf-8', limit !== undefined && entry.size > limit);
                        post({ type: 'entry', name: entry.name, ...rendered, size: formatSize(entry.size),
                            modified: new Date(entry.modified).toISOString() });
                        break;
                    }
                    case 'open':
                        if (typeof action.name === 'string' && (await this.archive(uri)).entries.has(action.name)) {
                            await vscode.commands.executeCommand('vscode.open', entryUri(uri, action.name), { preview: true });
                        }
                        break;
                    case 'print': {
                        printToken?.cancel();
                        const token = printToken = new vscode.CancellationTokenSource();
                        try {
                            const text = await this.print(uri, token.token);
                            if (token === printToken) post({ type: 'print', text });
                        } catch (error) {
                            if (token === printToken) post({ type: 'printError', message: message(error) });
                        }
                        break;
                    }
                }
            } catch (error) {
                post({ type: 'error', message: message(error) });
            }
        });
        const watchers: vscode.Disposable[] = [];
        if (uri.scheme === 'file') {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), path.basename(uri.path)));
            watchers.push(watcher,
                watcher.onDidChange(() => { this.invalidate(uri); post({ type: 'changed' }); }),
                watcher.onDidCreate(() => { this.invalidate(uri); post({ type: 'changed' }); }),
                watcher.onDidDelete(() => { this.invalidate(uri); panel.dispose(); }));
        }
        panel.onDidDispose(() => {
            printToken?.cancel();
            receiver.dispose();
            watchers.forEach(watcher => watcher.dispose());
        });
    }

    private async lookup(uri: vscode.Uri): Promise<{ archive: JarArchive; name: string; entry?: JarEntry; directory: boolean }> {
        const archive = await this.archive(vscode.Uri.parse(uri.query));
        const name = uri.path.replace(/^\/+|\/+$/g, '');
        const entry = archive.entries.get(name);
        const directory = name === '' || entry?.directory === true
            || [...archive.entries.keys()].some(key => key.startsWith(`${name}/`));
        if (!entry && !directory) throw vscode.FileSystemError.FileNotFound(uri);
        return { archive, name, entry, directory };
    }

    watch(): vscode.Disposable { return new vscode.Disposable(() => undefined); }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const { entry, directory } = await this.lookup(uri);
        return { type: directory ? vscode.FileType.Directory : vscode.FileType.File, ctime: entry?.modified ?? 0,
            mtime: entry?.modified ?? 0, size: directory ? 0 : entry!.size, permissions: vscode.FilePermission.Readonly };
    }

    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        const { archive, name, directory } = await this.lookup(uri);
        if (!directory) throw vscode.FileSystemError.FileNotADirectory(uri);
        const prefix = name ? `${name}/` : '';
        const children = new Map<string, vscode.FileType>();
        for (const entry of archive.entries.values()) {
            if (!entry.name.startsWith(prefix)) continue;
            const [child, ...rest] = entry.name.slice(prefix.length).split('/');
            if (child) children.set(child, rest.length || entry.directory ? vscode.FileType.Directory : vscode.FileType.File);
        }
        return [...children];
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const { archive, entry, directory } = await this.lookup(uri);
        if (directory || !entry) throw vscode.FileSystemError.FileIsADirectory(uri);
        return readEntry(archive, entry);
    }

    createDirectory(uri: vscode.Uri): never { throw vscode.FileSystemError.NoPermissions(uri); }
    writeFile(uri: vscode.Uri): never { throw vscode.FileSystemError.NoPermissions(uri); }
    delete(uri: vscode.Uri): never { throw vscode.FileSystemError.NoPermissions(uri); }
    rename(uri: vscode.Uri): never { throw vscode.FileSystemError.NoPermissions(uri); }

    dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.fileChanged.dispose();
        this.archives.clear();
    }
}

function activeJar(): vscode.Uri | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) return input.uri;
    return undefined;
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function jarViewerHtml(webview: vscode.Webview, extensionUri: vscode.Uri, title: string): string {
    const nonce = randomBytes(18).toString('base64');
    const asset = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts)).toString();
    const escaped = title.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')}">
<link rel="stylesheet" href="${asset('media', 'jarViewer.css')}">
<title>${escaped}</title></head><body>
<div role="tablist" class="tabs" aria-label="JAR Viewer pages">
<button role="tab" id="tab-tree" aria-controls="page-tree" aria-selected="true">Tree</button>
<button role="tab" id="tab-print" aria-controls="page-print" aria-selected="false" tabindex="-1">Print</button>
</div>
<div id="error" role="alert" hidden></div>
<section id="page-tree" role="tabpanel" aria-labelledby="tab-tree" class="split">
<nav aria-label="Content Tree"><h2>Content Tree</h2><ul id="tree" role="tree" aria-label="JAR entries" tabindex="0"></ul></nav>
<div class="entry">
<h2>Entry Content <span id="entry-name"></span>
<button id="open" title="Open entry in editor" aria-label="Open entry in editor" disabled><i class="codicon codicon-go-to-file" aria-hidden="true"></i></button></h2>
<pre id="content" tabindex="0" aria-label="Entry content"></pre>
<h2>Display Options</h2>
<div class="options">
<span>Size</span><output id="size"></output>
<span>Last Modified</span><output id="modified"></output>
<span>Show As:</span>
<span class="radios" role="radiogroup" aria-label="Show as">
<label><input type="radio" name="show" value="auto" checked>Auto</label>
<label><input type="radio" name="show" value="text">Text</label>
<label><input type="radio" name="show" value="hex">Binary (hex)</label></span>
<label for="charset">Text Encoding:</label><select id="charset" disabled></select>
<label class="limit"><input id="limit" type="checkbox" checked>Limit</label>
</div></div>
</section>
<section id="page-print" role="tabpanel" aria-labelledby="tab-print" hidden>
<div class="print-toolbar"><span id="print-status" role="status"></span>
<button id="print-refresh" title="Refresh" aria-label="Refresh"><i class="codicon codicon-refresh" aria-hidden="true"></i></button></div>
<pre id="print" tabindex="0" aria-label="bnd print output"></pre>
</section>
<script nonce="${nonce}" src="${asset('media', 'jarViewer.js')}"></script></body></html>`;
}
