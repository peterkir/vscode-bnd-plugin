import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';
import { registerCliCommands } from './bndCliCommands';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {
    // Path to the compiled language server
    const serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );

    // Start the server in a separate Node.js process.
    // In debug mode the server is started with --inspect so you can attach a debugger.
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

    // Register the client for the 'bnd' language
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'bnd' }],
        synchronize: {
            // Re-send file change events for *.bnd and *.bndrun to the server
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{bnd,bndrun}'),
        },
    };

    client = new LanguageClient(
        'bndLanguageServer',
        'Bnd Language Server',
        serverOptions,
        clientOptions
    );

    client.start();
    context.subscriptions.push({ dispose: () => client.stop() });

    // Register bnd CLI commands
    registerCliCommands(context);
}

export function deactivate(): Thenable<void> | undefined {
    return client ? client.stop() : undefined;
}
