import * as assert from 'assert';
import * as vscode from 'vscode';
import { EvaluationServer, SelectionEvaluationHoverProvider, macroExpandCommand, selectionExpression } from '../../selectionEvaluation';

suite('selection evaluation hover', () => {
    test('joins continuation lines of a selection', () => {
        assert.strictEqual(selectionExpression(`'\${a}/x',\\\n    '\${b}'`), `'\${a}/x','\${b}'`);
    });

    test('evaluates the selected text in the context of its file', async () => {
        const calls: unknown[][] = [];
        const server: EvaluationServer = {
            supports: async command => command === macroExpandCommand,
            execute: async (command, args) => {
                calls.push([command, ...args]);
                return { expression: args[0], result: 'c:/apps/fms/fcc_base' };
            },
        };
        const document = await vscode.workspace.openTextDocument({
            language: 'bnd',
            content: 'fms-home = c:/apps/fms\n-runproperties: \\\n  DIR=\'${fms-home}/fcc_base\'\n',
        });
        const editor = await vscode.window.showTextDocument(document);
        const provider = new SelectionEvaluationHoverProvider(server);
        const token = new vscode.CancellationTokenSource().token;
        try {
            const inside = new vscode.Position(2, 10);
            assert.strictEqual(await provider.provideHover(document, inside, token), undefined, 'no selection, no hover');

            editor.selection = new vscode.Selection(2, 7, 2, 27);
            assert.strictEqual(await provider.provideHover(document, new vscode.Position(0, 1), token), undefined,
                'hovering outside the selection');
            const hover = await provider.provideHover(document, inside, token);
            assert.deepStrictEqual(calls, [[macroExpandCommand, '${fms-home}/fcc_base', document.uri.toString()]]);
            assert.ok(hover?.range?.isEqual(editor.selection));
            const text = (hover!.contents[0] as vscode.MarkdownString).value;
            assert.match(text, /Evaluated selection/);
            assert.match(text, /c:\/apps\/fms\/fcc_base/);

            editor.selection = new vscode.Selection(0, 0, 0, 8);
            assert.strictEqual(await provider.provideHover(document, new vscode.Position(0, 2), token), undefined,
                'text without macros is not evaluated');
            assert.strictEqual(calls.length, 1);
        } finally {
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        }
    });
});
