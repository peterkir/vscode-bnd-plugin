import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BndExplorerProvider, FileNode, copyName } from '../../bndExplorer';

const node = (file: string, directory = false): FileNode =>
    ({ uri: vscode.Uri.file(file), name: path.basename(file), directory });

suite('bnd workspace Explorer', () => {
    test('sorts folders first and hides independently configured default names', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-explorer-'));
        const provider = new BndExplorerProvider();
        try {
            fs.mkdirSync(path.join(directory, '.git'));
            fs.mkdirSync(path.join(directory, 'node_modules'));
            fs.mkdirSync(path.join(directory, 'src'));
            fs.writeFileSync(path.join(directory, 'bnd.bnd'), '');
            const root = { uri: vscode.Uri.file(directory), name: 'sample', directory: true, root: true };
            const children = await provider.getChildren(root);
            assert.deepStrictEqual(children.map(node => node.name), ['src', 'bnd.bnd']);
            const folder = provider.getTreeItem(children[0]);
            const file = provider.getTreeItem(children[1]);
            assert.strictEqual(folder.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            assert.strictEqual(file.command?.command, 'vscode.open');
            assert.strictEqual(file.resourceUri?.fsPath, vscode.Uri.file(path.join(directory, 'bnd.bnd')).fsPath);
            assert.deepStrictEqual(await provider.getChildren(children[1]), []);
            assert.strictEqual(provider.getParent(root), undefined);
            const transfer = new vscode.DataTransfer();
            provider.handleDrag([children[1]], transfer);
            assert.strictEqual(await transfer.get('text/uri-list')?.asString(), children[1].uri.toString());
        } finally {
            provider.dispose();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    test('contributes its file tree before Repositories', () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'));
        assert.deepStrictEqual(manifest.contributes.views.bnd.map((view: { id: string }) => view.id),
            ['bnd.explorer', 'bnd.repositories']);
        assert.deepStrictEqual(manifest.contributes.configuration.properties['bnd.explorer.exclude'].default,
            ['.git', 'node_modules']);
    });

    test('names copies like the built-in Explorer', () => {
        assert.strictEqual(copyName('a.txt', 1), 'a copy.txt');
        assert.strictEqual(copyName('a.txt', 2), 'a copy 2.txt');
        assert.strictEqual(copyName('folder', 1), 'folder copy');
        assert.strictEqual(copyName('.gitignore', 1), '.gitignore copy');
    });

    test('offers the built-in Explorer context menu groups', () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'));
        const commands = manifest.contributes.menus['view/item/context']
            .filter((item: { when: string }) => item.when.startsWith('view == bnd.explorer'))
            .map((item: { command: string }) => item.command);
        for (const command of ['newFile', 'newFolder', 'openToSide', 'openWith', 'revealInOS', 'openInTerminal',
            'findInFolder', 'cut', 'copy', 'paste', 'copyPath', 'copyRelativePath', 'rename', 'delete',
            'selectForCompare', 'compareWithSelected', 'compareSelected']) {
            assert.ok(commands.includes(`bnd.explorer.${command}`), command);
        }
        const keys = manifest.contributes.keybindings.filter((binding: { when: string }) => binding.when.includes('focusedView == bnd.explorer'));
        assert.ok(keys.some((binding: { command: string; key: string }) => binding.command === 'bnd.explorer.rename' && binding.key === 'f2'));
    });

    test('copies, pastes, renames and deletes files like the built-in Explorer', async () => {
        await vscode.extensions.getExtension('klibio.bnd')!.activate();
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-explorer-actions-'));
        const window = vscode.window as unknown as Record<string, unknown>;
        const originals = { showInputBox: window.showInputBox, showWarningMessage: window.showWarningMessage };
        try {
            const file = path.join(directory, 'a.txt');
            fs.writeFileSync(file, 'content');
            fs.mkdirSync(path.join(directory, 'sub'));
            await vscode.commands.executeCommand('bnd.explorer.copy', node(file));
            await vscode.commands.executeCommand('bnd.explorer.paste', node(path.join(directory, 'sub'), true));
            await vscode.commands.executeCommand('bnd.explorer.paste', node(directory, true));
            assert.strictEqual(fs.readFileSync(path.join(directory, 'sub', 'a.txt'), 'utf8'), 'content');
            assert.strictEqual(fs.readFileSync(path.join(directory, 'a copy.txt'), 'utf8'), 'content');

            window.showInputBox = async () => 'b.txt';
            await vscode.commands.executeCommand('bnd.explorer.rename', node(file));
            assert.ok(!fs.existsSync(file) && fs.existsSync(path.join(directory, 'b.txt')));

            await vscode.commands.executeCommand('bnd.explorer.cut', node(path.join(directory, 'b.txt')));
            await vscode.commands.executeCommand('bnd.explorer.paste', node(path.join(directory, 'sub'), true));
            assert.ok(!fs.existsSync(path.join(directory, 'b.txt')) && fs.existsSync(path.join(directory, 'sub', 'b.txt')));

            window.showWarningMessage = async (...args: unknown[]) => args[args.length - 1];
            await vscode.commands.executeCommand('bnd.explorer.delete', node(path.join(directory, 'sub'), true));
            assert.ok(!fs.existsSync(path.join(directory, 'sub')));
        } finally {
            Object.assign(window, originals);
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});