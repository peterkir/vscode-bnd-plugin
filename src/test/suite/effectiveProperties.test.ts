import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acceptsEffectiveUri, effectiveHtml, parseEffectiveResult } from '../../effectiveProperties';

suite('Effective properties editor', () => {
    test('opens optional editor beside source and generates current unsaved values', async function () {
        this.timeout(30000);
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-effective-editor-'));
        const file = path.join(temporary, 'launch.bndrun');
        fs.writeFileSync(file, 'value: saved\n');
        const extension = vscode.extensions.getExtension('klibio.bnd')!;
        try {
            await extension.activate();
            const uri = vscode.Uri.file(file);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: false });
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
                'value: unsaved\nexpanded: ${value}\n');
            await vscode.workspace.applyEdit(edit);
            await vscode.commands.executeCommand('bnd.showEffectiveToSide', uri);
            const custom = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(tab =>
                tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'bnd.effective');
            assert.ok(custom, 'Expected optional Effective editor tab');
            assert.ok(document.isDirty, 'Opening Effective must not save source');
            await vscode.commands.executeCommand('bnd.showEffectiveSource', uri);
            const effective = vscode.window.activeTextEditor?.document;
            assert.strictEqual(effective?.uri.scheme, 'bnd-effective');
            assert.ok(effective?.getText().includes('expanded: unsaved'));
            assert.strictEqual(fs.readFileSync(file, 'utf8'), 'value: saved\n');
            await vscode.commands.executeCommand('bnd.openSource', uri);
            assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString());
            await vscode.commands.executeCommand('workbench.action.files.revert');
            const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
                (tab.input instanceof vscode.TabInputCustom || tab.input instanceof vscode.TabInputText)
                && tab.input.uri.path.includes(path.basename(temporary)));
            await vscode.window.tabGroups.close(tabs);
        } finally {
            const implementation: typeof import('../../extension') = require(path.join(extension.extensionPath, 'out', 'extension.js'));
            await implementation.deactivate();
            fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });

    test('accepts only saved bnd and bndrun file resources', () => {
        assert.ok(acceptsEffectiveUri(vscode.Uri.file('/workspace/target.bnd')));
        assert.ok(acceptsEffectiveUri(vscode.Uri.file('/workspace/launch.bndrun')));
        assert.ok(!acceptsEffectiveUri(vscode.Uri.file('/workspace/repository.mvn')));
        assert.ok(!acceptsEffectiveUri(vscode.Uri.parse('untitled:launch.bndrun')));
        assert.ok(!acceptsEffectiveUri(vscode.Uri.parse('bnd-effective:/launch.bndrun')));
    });

    test('rejects error and incompatible server responses', () => {
        assert.throws(() => parseEffectiveResult({ error: 'Not trusted' }), /Not trusted/);
        assert.throws(() => parseEffectiveResult(null), /incompatible/);
        assert.throws(() => parseEffectiveResult({ schemaVersion: 1, rows: [{}] }), /incompatible/);
    });

    test('uses local assets, strict CSP, and accessible native controls', () => {
        const webview = { cspSource: 'https://test.webview', asWebviewUri: (uri: vscode.Uri) => uri } as vscode.Webview;
        const html = effectiveHtml(webview, vscode.Uri.file('/extension'));
        assert.ok(html.includes("default-src 'none'"));
        assert.ok(!html.includes('unsafe-inline'));
        assert.ok(html.includes('effective.css'));
        assert.ok(html.includes('effective.js'));
        assert.ok(html.includes('aria-label="Filter properties"'));
        assert.ok(html.includes('scope="col">Provenance'));
        assert.ok(!html.includes('<iframe'));
    });
});