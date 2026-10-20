import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function waitForDiagnostic(uri: vscode.Uri, code: string, timeout: number): Promise<vscode.Diagnostic> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const found = vscode.languages.getDiagnostics(uri).find(diagnostic =>
            (typeof diagnostic.code === 'object' ? diagnostic.code?.value : diagnostic.code) === code);
        if (found) {
            return found;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    const seen = vscode.languages.getDiagnostics(uri).map(diagnostic => `${String(diagnostic.code)}: ${diagnostic.message}`);
    throw new Error(`No ${code} diagnostic within ${timeout} ms; saw ${JSON.stringify(seen)}`);
}

suite('Property conflict quick fixes', () => {
    test('reports duplicate merged keys from unsaved text and offers rename and removal', async function () {
        this.timeout(120000);
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-quickfix-'));
        const file = path.join(temporary, 'bnd.bnd');
        fs.writeFileSync(file, '-propertyconflicts: warning\n-runvm: -Da\n');
        const extension = vscode.extensions.getExtension('klibio.bnd')!;
        try {
            await extension.activate();
            // earlier suites may have stopped the client via deactivate(); restart to get a live Java server
            await vscode.commands.executeCommand('bnd.server.restart');
            const uri = vscode.Uri.file(file);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: false });
            const edit = new vscode.WorkspaceEdit();
            edit.insert(uri, document.positionAt(document.getText().length), '-runvm: -Db\n');
            await vscode.workspace.applyEdit(edit);

            const diagnostic = await waitForDiagnostic(uri, 'bnd.propertyconflict', 90000);
            assert.strictEqual(diagnostic.source, 'bnd');
            assert.strictEqual(diagnostic.range.start.line, 2, 'conflict is reported on the second definition');
            assert.strictEqual(diagnostic.range.end.character, 6, 'range covers the key only');
            assert.ok(diagnostic.message.includes('`-runvm` is defined more than once'), diagnostic.message);

            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                'vscode.executeCodeActionProvider', uri, diagnostic.range, vscode.CodeActionKind.QuickFix.value);
            const titles = (actions ?? []).map(action => action.title);
            assert.ok(titles.includes('Rename to `-runvm.bnd` to merge values'), JSON.stringify(titles));
            assert.ok(titles.includes('Remove this definition of `-runvm`'), JSON.stringify(titles));

            const rename = actions!.find(action => action.title.startsWith('Rename to'))!;
            assert.ok(rename.edit, 'quick fix must carry a workspace edit');
            assert.ok(await vscode.workspace.applyEdit(rename.edit!));
            assert.strictEqual(document.getText(), '-propertyconflicts: warning\n-runvm: -Da\n-runvm.bnd: -Db\n');
            assert.strictEqual(fs.readFileSync(file, 'utf8'), '-propertyconflicts: warning\n-runvm: -Da\n',
                'quick fix must not save the document');

            await vscode.commands.executeCommand('workbench.action.files.revert');
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });
});
