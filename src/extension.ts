import * as path from 'path';
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
    // Register bnd CLI commands (always, regardless of LSP settings)
    registerCliCommands(context);

    const config = vscode.workspace.getConfiguration('bnd.lsp');
    const lspEnabled: boolean = config.get('enable', true);

    if (lspEnabled) {
        const started = await tryStartJavaLsp(context);
        if (!started) {
            startNodeLsp(context);
        }
    } else {
        startNodeLsp(context);
    }

    // Restart the server when relevant settings change
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (
                e.affectsConfiguration('bnd.lsp.enable') ||
                e.affectsConfiguration('bnd.lsp.javaExecutable') ||
                e.affectsConfiguration('bnd.lsp.serverVersion') ||
                e.affectsConfiguration('bnd.lsp.downloadBaseUrl')
            ) {
                await stopClient();
                const newConfig = vscode.workspace.getConfiguration('bnd.lsp');
                const enabled: boolean = newConfig.get('enable', true);
                if (enabled) {
                    const started = await tryStartJavaLsp(context);
                    if (!started) {
                        startNodeLsp(context);
                    }
                } else {
                    startNodeLsp(context);
                }
            }
        })
    );

    context.subscriptions.push({ dispose: () => stopClient() });
}

export function deactivate(): Thenable<void> | undefined {
    return stopClient();
}

// ─── Java LSP ──────────────────────────────────────────────────────────────

/**
 * Attempts to start the Java-based bnd language server.
 * Downloads the JAR if necessary.
 *
 * @returns true if the server was successfully started, false otherwise.
 */
async function tryStartJavaLsp(context: vscode.ExtensionContext): Promise<boolean> {
    const lspConfig = vscode.workspace.getConfiguration('bnd.lsp');
    const javaExe: string = lspConfig.get('javaExecutable', 'java');

    const jarPath = await ensureJar(context);
    if (!jarPath) {
        return false;
    }

    const serverOptions: ServerOptions = {
        command: javaExe,
        args: ['-jar', jarPath],
        transport: TransportKind.stdio,
    };

    client = createLanguageClient(serverOptions);
    await client.start();
    return true;
}

// ─── Node LSP fallback ─────────────────────────────────────────────────────

/**
 * Starts the built-in Node.js-based language server as a fallback.
 */
function startNodeLsp(context: vscode.ExtensionContext): void {
    const serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );

    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.ipc,
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] },
        },
    };

    client = createLanguageClient(serverOptions);
    client.start();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function createLanguageClient(serverOptions: ServerOptions): LanguageClient {
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'bnd' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{bnd,bndrun}'),
        },
    };

    return new LanguageClient(
        'bndLanguageServer',
        'Bnd Language Server',
        serverOptions,
        clientOptions
    );
}

async function stopClient(): Promise<void> {
    if (client) {
        const c = client;
        client = undefined;
        await c.stop();
    }
}
