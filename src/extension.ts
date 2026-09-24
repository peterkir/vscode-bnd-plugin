import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    Executable,
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    StreamInfo,
    TransportKind,
} from 'vscode-languageclient/node';
import { registerCliCommands } from './bndCliCommands';

let client: LanguageClient | undefined;
let clientReady: Promise<void> | undefined;

export function activate(context: vscode.ExtensionContext): void {
    void startLanguageClient(context);

    // Command to restart language server
    context.subscriptions.push(
        vscode.commands.registerCommand('bnd.server.restart', async () => {
            if (client) {
                await client.stop();
                client = undefined;
                clientReady = undefined;
            }
            await startLanguageClient(context);
            vscode.window.showInformationMessage('bnd Language Server restarted.');
        })
    );

    // LSP-backed helper commands
    context.subscriptions.push(
        vscode.commands.registerCommand('bnd.resolve', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!targetUri || !targetUri.fsPath.endsWith('.bndrun')) {
                vscode.window.showWarningMessage('Please open or select a .bndrun file to resolve.');
                return;
            }
            if (!client) {
                vscode.window.showErrorMessage('bnd Language Server is not running.');
                return;
            }
            try {
                if (!(await supportsServerCommand('bnd.resolve'))) {
                    vscode.window.showWarningMessage('The selected bnd Language Server does not support resolution.');
                    return;
                }
                const res = await client.sendRequest('workspace/executeCommand', {
                    command: 'bnd.resolve',
                    arguments: [targetUri.toString()],
                });
                vscode.window.showInformationMessage(`bnd resolution completed: ${JSON.stringify(res)}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Resolution failed: ${err?.message ?? err}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('bnd.build.project', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!targetUri) {
                vscode.window.showWarningMessage('Please open a bnd file in a project.');
                return;
            }
            if (!client) {
                vscode.window.showErrorMessage('bnd Language Server is not running.');
                return;
            }
            try {
                if (!(await supportsServerCommand('bnd.build.project'))) {
                    vscode.window.showWarningMessage('The selected bnd Language Server does not support project builds.');
                    return;
                }
                const res = await client.sendRequest('workspace/executeCommand', {
                    command: 'bnd.build.project',
                    arguments: [targetUri.toString()],
                });
                vscode.window.showInformationMessage(`bnd project build result: ${JSON.stringify(res)}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Build failed: ${err?.message ?? err}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('bnd.macro.expand', async () => {
            const editor = vscode.window.activeTextEditor;
            const expr = await vscode.window.showInputBox({
                prompt: 'Enter bnd macro expression to evaluate (e.g. ${bsn} or ${tstamp})',
                value: '${tstamp}',
            });
            if (!expr) {
                return;
            }
            if (!client) {
                vscode.window.showErrorMessage('bnd Language Server is not running.');
                return;
            }
            try {
                if (!(await supportsServerCommand('bnd.macro.expand'))) {
                    vscode.window.showWarningMessage('The selected bnd Language Server does not support macro evaluation.');
                    return;
                }
                const targetUri = editor?.document.uri?.toString();
                const args = targetUri ? [expr, targetUri] : [expr];
                const res: any = await client.sendRequest('workspace/executeCommand', {
                    command: 'bnd.macro.expand',
                    arguments: args,
                });
                vscode.window.showInformationMessage(`Result: ${res?.result ?? JSON.stringify(res)}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Evaluation failed: ${err?.message ?? err}`);
            }
        })
    );

    // Register bnd CLI commands
    registerCliCommands(context);
}

async function startLanguageClient(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('bnd');
    const mode = config.get<string>('server.mode', 'java');

    let serverOptions: ServerOptions;

    if (mode === 'socket') {
        const port = config.get<number>('server.socketPort', 5007);
        serverOptions = () => {
            const socket = net.connect({ port, host: '127.0.0.1' });
            const streamInfo: StreamInfo = {
                writer: socket,
                reader: socket,
            };
            return Promise.resolve(streamInfo);
        };
    } else if (mode === 'java') {
        // Resolve java executable
        const javaExecutable =
            config.get<string>('server.javaExecutable') ||
            config.get<string>('cli.javaExecutable') ||
            (process.env['JAVA_HOME'] ? path.join(process.env['JAVA_HOME']!, 'bin', 'java') : 'java');

        // Resolve JAR path
        let jarPath = config.get<string>('server.jar');
        if (!jarPath || !fs.existsSync(jarPath)) {
            jarPath = context.asAbsolutePath(path.join('server', 'biz.aQute.bnd.lsp.jar'));
        }

        if (!fs.existsSync(jarPath)) {
            vscode.window.showWarningMessage(
                `bnd Language Server JAR not found at ${jarPath}. Falling back to Node.js server.`
            );
            serverOptions = createNodeServerOptions(context);
        } else {
            const jvmArgs = config.get<string[]>('server.jvmArgs', []);
            const executable: Executable = {
                command: javaExecutable,
                args: [...jvmArgs, '-jar', jarPath],
                options: { env: process.env },
            };
            serverOptions = {
                run: executable,
                debug: executable,
            };
        }
    } else {
        serverOptions = createNodeServerOptions(context);
    }

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'bnd' }],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{bnd,bndrun,mvn,packageinfo}'),
        },
    };

    client = new LanguageClient(
        'bndLanguageServer',
        'bnd Language Server',
        serverOptions,
        clientOptions
    );

    clientReady = client.start();
    context.subscriptions.push({
        dispose: () => {
            if (client) {
                client.stop();
            }
        },
    });
    await clientReady;
}

async function supportsServerCommand(command: string): Promise<boolean> {
    await clientReady;
    return client?.initializeResult?.capabilities.executeCommandProvider?.commands.includes(command) ?? false;
}

function createNodeServerOptions(context: vscode.ExtensionContext): ServerOptions {
    const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
    return {
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
}

export function deactivate(): Thenable<void> | undefined {
    return client ? client.stop() : undefined;
}
