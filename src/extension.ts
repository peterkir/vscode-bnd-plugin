import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';
import { registerCliCommands } from './bndCliCommands';
import { ensureJar } from './bndLspDownloader';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Register bnd CLI commands (always active, independent of the LSP)
    registerCliCommands(context);

    await startJavaLsp(context);

    // Restart the server when relevant settings change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (
                e.affectsConfiguration('bnd.lsp.javaExecutable') ||
                e.affectsConfiguration('bnd.lsp.serverVersion') ||
                e.affectsConfiguration('bnd.lsp.downloadBaseUrl')
            ) {
                await stopClient();
                await startJavaLsp(context);
            }
        })
    );

    context.subscriptions.push({ dispose: async () => { await stopClient(); } });
}

export function deactivate(): Thenable<void> | undefined {
    return stopClient();
}

// ─── Java LSP ──────────────────────────────────────────────────────────────

/**
 * Starts the Java-based bnd language server, downloading the JAR if necessary.
 * On failure a notification is shown but no fallback is attempted.
 */
async function startJavaLsp(context: vscode.ExtensionContext): Promise<void> {
    const lspConfig = vscode.workspace.getConfiguration('bnd.lsp');
    const javaExe: string = lspConfig.get('javaExecutable', 'java');

    const jarPath = await ensureJar(context);
    if (!jarPath) {
        // ensureJar already presented the user with a Retry/Show Output notification
        return;
    }

    const serverOptions: ServerOptions = {
        command: javaExe,
        args: ['-jar', jarPath],
        transport: TransportKind.stdio,
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'bnd' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{bnd,bndrun}'),
        },
    };

    client = new LanguageClient(
        'bndLanguageServer',
        'Bnd Language Server',
        serverOptions,
        clientOptions
    );

    await client.start();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function stopClient(): Promise<void> {
    if (client) {
        const c = client;
        client = undefined;
        await c.stop();
    }
}
