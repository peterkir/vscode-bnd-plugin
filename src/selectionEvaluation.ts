import * as vscode from 'vscode';

export const macroExpandCommand = 'bnd.macro.expand';

export interface EvaluationServer {
    supports(command: string): Promise<boolean>;
    execute(command: string, args: unknown[], token?: vscode.CancellationToken): Promise<unknown>;
}

/** Joins the lines of a selection that spans backslash line continuations. */
export function selectionExpression(text: string): string {
    return text.replace(/\\\r?\n[ \t]*/g, '').trim();
}

/**
 * Shows the value a selected text evaluates to in the context of its file, i.e. with the
 * properties of the enclosing .bndrun, project, or workspace. Hover requests carry no selection,
 * so this runs in the client next to the server hover.
 */
export class SelectionEvaluationHoverProvider implements vscode.HoverProvider {
    constructor(private readonly server: EvaluationServer) {}

    async provideHover(document: vscode.TextDocument, position: vscode.Position,
        token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        const selection = vscode.window.visibleTextEditors
            .find(editor => editor.document === document)?.selections
            .find(candidate => !candidate.isEmpty && candidate.contains(position));
        if (!selection || !vscode.workspace.isTrusted) return undefined;
        const expression = selectionExpression(document.getText(selection));
        if (!expression || !expression.includes('$') || !(await this.server.supports(macroExpandCommand))) return undefined;
        const result = await this.server.execute(macroExpandCommand, [expression, document.uri.toString()], token) as { result?: unknown } | undefined;
        if (token.isCancellationRequested || typeof result?.result !== 'string' || result.result === expression) return undefined;
        const markdown = new vscode.MarkdownString()
            .appendMarkdown('**Evaluated selection**\n\n')
            .appendCodeblock(result.result, 'text');
        return new vscode.Hover(markdown, selection);
    }
}

export function registerSelectionEvaluation(context: vscode.ExtensionContext, server: EvaluationServer): void {
    context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'bnd', scheme: 'file' },
        new SelectionEvaluationHoverProvider(server)));
}
