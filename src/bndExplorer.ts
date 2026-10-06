import * as path from 'path';
import * as vscode from 'vscode';

export const explorerViewId = 'bnd.explorer';
const internalMime = 'application/vnd.code.tree.bnd.explorer';

export interface FileNode {
    uri: vscode.Uri;
    name: string;
    directory: boolean;
    root?: boolean;
}

export function nodeFor(uri: vscode.Uri, directory: boolean): FileNode {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const root = !!folder && folder.uri.toString() === uri.toString();
    return { uri, directory, root, name: root ? folder!.name : path.posix.basename(uri.path) };
}

/** Explorer-style unique name: "a copy.txt", "a copy 2.txt". */
export function copyName(name: string, attempt: number): string {
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    return `${base} copy${attempt > 1 ? ` ${attempt}` : ''}${ext}`;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

const isInside = (child: vscode.Uri, parent: vscode.Uri): boolean =>
    child.toString() === parent.toString() || child.toString().startsWith(parent.toString().replace(/\/?$/, '/'));

export class BndExplorerProvider implements vscode.TreeDataProvider<FileNode>,
    vscode.TreeDragAndDropController<FileNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<FileNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    readonly dragMimeTypes = ['text/uri-list'];
    readonly dropMimeTypes = [internalMime, 'text/uri-list'];
    private timer?: ReturnType<typeof setTimeout>;

    refresh(): void {
        this.changed.fire(undefined);
    }

    scheduleRefresh(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.refresh(), 200);
    }

    async getChildren(node?: FileNode): Promise<FileNode[]> {
        if (!node) {
            return (vscode.workspace.workspaceFolders ?? []).map(folder => ({
                uri: folder.uri, name: folder.name, directory: true, root: true,
            }));
        }
        if (!node.directory) return [];
        const excluded = new Set(vscode.workspace.getConfiguration('bnd.explorer', node.uri)
            .get<string[]>('exclude', ['.git', 'node_modules']));
        const entries = await vscode.workspace.fs.readDirectory(node.uri);
        const children = await Promise.all(entries.filter(([name]) => !excluded.has(name)).map(async ([name, type]) => {
            const uri = vscode.Uri.joinPath(node.uri, name);
            if (type & vscode.FileType.SymbolicLink) {
                type = await vscode.workspace.fs.stat(uri).then(stat => stat.type, () => vscode.FileType.File);
            }
            return { uri, name, directory: !!(type & vscode.FileType.Directory) };
        }));
        return children.sort((left, right) => Number(right.directory) - Number(left.directory)
            || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));
    }

    getTreeItem(node: FileNode): vscode.TreeItem {
        const item = new vscode.TreeItem(node.name, node.directory
            ? node.root ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        item.id = node.uri.toString();
        item.resourceUri = node.uri;
        item.tooltip = node.uri.fsPath;
        item.iconPath = node.directory ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
        item.contextValue = node.root ? 'bndExplorerRoot' : node.directory ? 'bndExplorerFolder' : 'bndExplorerFile';
        if (!node.directory) item.command = { command: 'vscode.open', title: 'Open File', arguments: [node.uri] };
        return item;
    }

    getParent(node: FileNode): FileNode | undefined {
        if (node.root || !vscode.workspace.getWorkspaceFolder(node.uri)) return undefined;
        return nodeFor(vscode.Uri.joinPath(node.uri, '..'), true);
    }

    handleDrag(nodes: readonly FileNode[], transfer: vscode.DataTransfer): void {
        transfer.set('text/uri-list', new vscode.DataTransferItem(nodes.map(node => node.uri.toString()).join('\r\n')));
    }

    async handleDrop(target: FileNode | undefined, transfer: vscode.DataTransfer): Promise<void> {
        const folder = target ? folderOf(target) : vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!folder) return;
        const internal = transfer.get(internalMime)?.value as FileNode[] | undefined;
        if (internal?.length) {
            await transferInto(internal.map(node => node.uri), folder, true);
        } else {
            const text = await transfer.get('text/uri-list')?.asString();
            const uris = (text ?? '').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => vscode.Uri.parse(line));
            await transferInto(uris, folder, false);
        }
        this.refresh();
    }

    dispose(): void {
        clearTimeout(this.timer);
        this.changed.dispose();
    }
}

function folderOf(node: FileNode): vscode.Uri {
    return node.directory ? node.uri : vscode.Uri.joinPath(node.uri, '..');
}

/** Moves or copies resources into a folder; copies get Explorer-style unique names. */
async function transferInto(sources: vscode.Uri[], folder: vscode.Uri, move: boolean): Promise<vscode.Uri[]> {
    const edit = new vscode.WorkspaceEdit();
    const created: vscode.Uri[] = [];
    for (const source of sources) {
        if (isInside(folder, source)) {
            void vscode.window.showErrorMessage(`Cannot ${move ? 'move' : 'copy'} '${path.posix.basename(source.path)}' into itself.`);
            continue;
        }
        const name = path.posix.basename(source.path);
        let target = vscode.Uri.joinPath(folder, name);
        if (move && target.toString() === source.toString()) continue;
        if (move && await exists(target)) {
            const replace = await vscode.window.showWarningMessage(
                `A file or folder with the name '${name}' already exists in the destination folder. Do you want to replace it?`,
                { modal: true }, 'Replace');
            if (replace !== 'Replace') continue;
        }
        for (let attempt = 1; !move && await exists(target); attempt++) {
            target = vscode.Uri.joinPath(folder, copyName(name, attempt));
        }
        if (move) edit.renameFile(source, target, { overwrite: true });
        else await vscode.workspace.fs.copy(source, target, { overwrite: false });
        created.push(target);
    }
    if (move) await vscode.workspace.applyEdit(edit);
    return created;
}

export function registerExplorerView(context: vscode.ExtensionContext): BndExplorerProvider {
    const provider = new BndExplorerProvider();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
    const view = vscode.window.createTreeView(explorerViewId, {
        treeDataProvider: provider, dragAndDropController: provider, canSelectMany: true, showCollapseAll: true,
    });
    let clipboard: { uris: vscode.Uri[]; cut: boolean } | undefined;
    let compareSource: vscode.Uri | undefined;

    const selection = (node?: FileNode, nodes?: FileNode[]): FileNode[] =>
        nodes?.length ? nodes : node ? [node] : [...view.selection];
    const single = (node?: FileNode): FileNode | undefined => node ?? view.selection[0];
    const targetFolder = (node?: FileNode): vscode.Uri | undefined => {
        const chosen = single(node);
        return chosen ? folderOf(chosen) : vscode.workspace.workspaceFolders?.[0]?.uri;
    };
    const reveal = async (uri: vscode.Uri, directory: boolean): Promise<void> => {
        provider.refresh();
        await view.reveal(nodeFor(uri, directory), { select: true, focus: true }).then(undefined, () => undefined);
    };
    const run = <T extends unknown[]>(action: (...args: T) => Promise<unknown> | unknown) => async (...args: T) => {
        try { await action(...args); }
        catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
    };
    const create = (directory: boolean) => run(async (node?: FileNode) => {
        const folder = targetFolder(node);
        if (!folder) return;
        const name = await vscode.window.showInputBox({
            prompt: directory ? 'New folder name' : 'New file name (use / to create sub folders)',
            validateInput: async value => {
                if (!value.trim()) return 'A file or folder name must be provided.';
                if (/[\\:*?"<>|]/.test(value) && process.platform === 'win32') return 'The name contains invalid characters.';
                return await exists(vscode.Uri.joinPath(folder, value.trim()))
                    ? `A file or folder '${value.trim()}' already exists at this location.` : undefined;
            },
        });
        if (!name) return;
        const uri = vscode.Uri.joinPath(folder, name.trim());
        if (directory) {
            await vscode.workspace.fs.createDirectory(uri);
        } else {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(uri, { ignoreIfExists: false });
            if (!await vscode.workspace.applyEdit(edit)) return;
            await vscode.window.showTextDocument(uri, { preview: false });
        }
        await reveal(uri, directory);
    });
    const copyPaths = (relative: boolean) => run(async (node?: FileNode, nodes?: FileNode[]) => {
        const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
        const paths = selection(node, nodes).map(item => relative ? vscode.workspace.asRelativePath(item.uri, multiRoot) : item.uri.fsPath);
        if (paths.length) await vscode.env.clipboard.writeText(paths.join(process.platform === 'win32' ? '\r\n' : '\n'));
    });
    const setClipboard = (cut: boolean) => (node?: FileNode, nodes?: FileNode[]) => {
        const items = selection(node, nodes).filter(item => !item.root || !cut);
        if (!items.length) return;
        clipboard = { uris: items.map(item => item.uri), cut };
        void vscode.commands.executeCommand('setContext', 'bnd.explorer.canPaste', true);
    };

    context.subscriptions.push(
        provider, watcher, view,
        watcher.onDidCreate(() => provider.scheduleRefresh()),
        watcher.onDidDelete(() => provider.scheduleRefresh()),
        vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('bnd.explorer')) provider.refresh();
        }),
        vscode.commands.registerCommand('bnd.explorer.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('bnd.explorer.newFile', create(false)),
        vscode.commands.registerCommand('bnd.explorer.newFolder', create(true)),
        vscode.commands.registerCommand('bnd.explorer.openToSide', run(async (node?: FileNode, nodes?: FileNode[]) => {
            for (const item of selection(node, nodes).filter(entry => !entry.directory)) {
                await vscode.commands.executeCommand('vscode.open', item.uri, { viewColumn: vscode.ViewColumn.Beside, preview: false });
            }
        })),
        vscode.commands.registerCommand('bnd.explorer.openWith', run(async (node?: FileNode) => {
            const item = single(node);
            if (!item || item.directory) return;
            await vscode.commands.executeCommand('vscode.open', item.uri, { preview: false });
            await vscode.commands.executeCommand('workbench.action.reopenWithEditor');
        })),
        vscode.commands.registerCommand('bnd.explorer.reveal', run(async (node?: FileNode) => {
            const item = single(node);
            if (item) await vscode.commands.executeCommand('revealInExplorer', item.uri);
        })),
        vscode.commands.registerCommand('bnd.explorer.revealInOS', run(async (node?: FileNode) => {
            const item = single(node);
            if (item) await vscode.commands.executeCommand('revealFileInOS', item.uri);
        })),
        vscode.commands.registerCommand('bnd.explorer.openInTerminal', run((node?: FileNode) => {
            const folder = targetFolder(node);
            if (folder) vscode.window.createTerminal({ cwd: folder, name: path.posix.basename(folder.path) }).show();
        })),
        vscode.commands.registerCommand('bnd.explorer.findInFolder', run(async (node?: FileNode) => {
            const folder = targetFolder(node);
            if (!folder) return;
            const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
            const relative = vscode.workspace.asRelativePath(folder, multiRoot);
            await vscode.commands.executeCommand('workbench.action.findInFiles', {
                filesToInclude: relative === folder.fsPath ? '' : `./${relative}`,
                triggerSearch: false,
            });
        })),
        vscode.commands.registerCommand('bnd.explorer.cut', setClipboard(true)),
        vscode.commands.registerCommand('bnd.explorer.copy', setClipboard(false)),
        vscode.commands.registerCommand('bnd.explorer.paste', run(async (node?: FileNode) => {
            const folder = targetFolder(node);
            if (!folder || !clipboard) return;
            const created = await transferInto(clipboard.uris, folder, clipboard.cut);
            if (clipboard.cut) {
                clipboard = undefined;
                void vscode.commands.executeCommand('setContext', 'bnd.explorer.canPaste', false);
            }
            provider.refresh();
            if (created.length === 1) await reveal(created[0], (await vscode.workspace.fs.stat(created[0])).type === vscode.FileType.Directory);
        })),
        vscode.commands.registerCommand('bnd.explorer.copyPath', copyPaths(false)),
        vscode.commands.registerCommand('bnd.explorer.copyRelativePath', copyPaths(true)),
        vscode.commands.registerCommand('bnd.explorer.rename', run(async (node?: FileNode) => {
            const item = single(node);
            if (!item || item.root) return;
            const dot = item.directory ? -1 : item.name.lastIndexOf('.');
            const name = await vscode.window.showInputBox({
                prompt: 'New name',
                value: item.name,
                valueSelection: [0, dot > 0 ? dot : item.name.length],
                validateInput: async value => {
                    if (!value.trim()) return 'A file or folder name must be provided.';
                    if (value.trim() === item.name) return undefined;
                    return await exists(vscode.Uri.joinPath(item.uri, '..', value.trim()))
                        ? `A file or folder '${value.trim()}' already exists at this location.` : undefined;
                },
            });
            if (!name || name.trim() === item.name) return;
            const target = vscode.Uri.joinPath(item.uri, '..', name.trim());
            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(item.uri, target);
            if (await vscode.workspace.applyEdit(edit)) await reveal(target, item.directory);
        })),
        vscode.commands.registerCommand('bnd.explorer.delete', run(async (node?: FileNode, nodes?: FileNode[]) => {
            const items = selection(node, nodes).filter(item => !item.root);
            if (!items.length) return;
            const subject = items.length === 1 ? `'${items[0].name}'` : `the following ${items.length} files/folders`;
            const detail = items.length === 1 ? undefined : items.map(item => item.name).join('\n');
            const action = process.platform === 'win32' ? 'Move to Recycle Bin' : 'Move to Trash';
            const choice = await vscode.window.showWarningMessage(`Are you sure you want to delete ${subject}?`,
                { modal: true, detail: `${detail ? `${detail}\n\n` : ''}You can restore ${items.length === 1 ? 'it' : 'them'} from the ${process.platform === 'win32' ? 'Recycle Bin' : 'Trash'}.` },
                action);
            if (choice !== action) return;
            const edit = new vscode.WorkspaceEdit();
            for (const item of items) edit.deleteFile(item.uri, { recursive: true, ignoreIfNotExists: true });
            await vscode.workspace.applyEdit(edit);
            provider.refresh();
        })),
        vscode.commands.registerCommand('bnd.explorer.selectForCompare', (node?: FileNode) => {
            const item = single(node);
            if (!item || item.directory) return;
            compareSource = item.uri;
            void vscode.commands.executeCommand('setContext', 'bnd.explorer.compareSelected', true);
        }),
        vscode.commands.registerCommand('bnd.explorer.compareWithSelected', run(async (node?: FileNode) => {
            const item = single(node);
            if (!item || item.directory || !compareSource) return;
            await vscode.commands.executeCommand('vscode.diff', compareSource, item.uri,
                `${path.posix.basename(compareSource.path)} ↔ ${item.name}`);
        })),
        vscode.commands.registerCommand('bnd.explorer.compareSelected', run(async (node?: FileNode, nodes?: FileNode[]) => {
            const items = selection(node, nodes).filter(item => !item.directory);
            if (items.length !== 2) return;
            await vscode.commands.executeCommand('vscode.diff', items[0].uri, items[1].uri, `${items[0].name} ↔ ${items[1].name}`);
        })),
    );
    return provider;
}
