import * as path from 'path';
import * as vscode from 'vscode';
import { isLaunchTarget, pickLaunchTarget } from './bndLaunch';

export const exportCommand = 'bnd.export';

export interface ExporterChoice extends vscode.QuickPickItem {
    exporter: string;
}

export const exporterChoices: ExporterChoice[] = [
    {
        label: 'Executable JAR',
        description: 'bnd.executablejar',
        detail: 'One JAR with the launcher, framework and run bundles, started with java -jar',
        exporter: 'bnd.executablejar',
    },
    {
        label: 'Run bundles folder',
        description: 'bnd.runbundles',
        detail: 'The -runbundles as JARs in a folder',
        exporter: 'bnd.runbundles',
    },
];

export interface ExportResult {
    success: boolean;
    exporter?: string;
    output?: string;
    errors: string[];
    warnings: string[];
    error?: string;
}

/** Normalizes the reply of the server command bnd.export. */
export function parseExportResult(reply: unknown): ExportResult {
    const value = (reply && typeof reply === 'object' ? reply : {}) as Record<string, unknown>;
    const strings = (key: string) => Array.isArray(value[key]) ? (value[key] as unknown[]).map(String) : [];
    const errors = strings('errors');
    if (typeof value.error === 'string') errors.unshift(value.error);
    return {
        success: value.success === true && errors.length === 0,
        exporter: typeof value.exporter === 'string' ? value.exporter : undefined,
        output: typeof value.output === 'string' ? value.output : undefined,
        errors,
        warnings: strings('warnings'),
    };
}

export interface ExportServer {
    supports(command: string): Promise<boolean>;
    execute(command: string, args: unknown[]): Promise<unknown>;
    unavailableMessage(): string | undefined;
}

export function registerExportCommand(context: vscode.ExtensionContext, server: ExportServer,
    output: vscode.OutputChannel): void {
    context.subscriptions.push(vscode.commands.registerCommand('bnd.lsp.export',
        async (arg?: vscode.Uri | { uri?: vscode.Uri; resourceUri?: vscode.Uri }) => {
            let target = arg instanceof vscode.Uri ? arg : arg?.uri ?? arg?.resourceUri;
            if (!target) {
                const active = vscode.window.activeTextEditor?.document.uri;
                target = active?.scheme === 'file' && isLaunchTarget(active.fsPath) ? active : await pickLaunchTarget('run');
                if (!target) return;
            }
            if (target.scheme !== 'file' || !isLaunchTarget(target.fsPath)) {
                void vscode.window.showWarningMessage('Select a .bndrun or bnd.bnd file to export.');
                return;
            }
            if (!(await server.supports(exportCommand))) {
                const unavailable = server.unavailableMessage();
                void vscode.window.showWarningMessage(unavailable
                    ?? 'The selected bnd Language Server does not support export.');
                return;
            }
            const choice = await vscode.window.showQuickPick(exporterChoices, {
                title: `Export ${path.basename(target.fsPath)}`,
                placeHolder: 'Select the export format',
            });
            if (!choice) return;
            const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === target.toString());
            if (document?.isDirty) await document.save();

            const uri = target;
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `bnd: exporting ${path.basename(uri.fsPath)} as ${choice.label}`,
            }, async () => {
                try {
                    return parseExportResult(await server.execute(exportCommand,
                        [{ uri: uri.toString(), exporter: choice.exporter }]));
                } catch (err: any) {
                    return parseExportResult({ error: String(err?.message ?? err) });
                }
            });

            output.appendLine(`bnd export ${uri.fsPath} (${choice.exporter})`);
            result.warnings.forEach(warning => output.appendLine(`  warning: ${warning}`));
            result.errors.forEach(error => output.appendLine(`  error: ${error}`));
            if (!result.success || !result.output) {
                output.show(true);
                void vscode.window.showErrorMessage(`bnd export failed: ${result.errors.join('; ') || 'no output'}`);
                return;
            }
            output.appendLine(`  wrote ${result.output}`);
            const reveal = 'Reveal';
            const picked = await vscode.window.showInformationMessage(`bnd exported ${result.output}`, reveal);
            if (picked === reveal) {
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.output));
            }
        }));
}
