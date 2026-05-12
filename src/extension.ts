import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';
import { registerCliCommands } from './bndCliCommands';

import * as cp from 'child_process';
import { promisify } from 'util';
const exec = promisify(cp.exec);

// Import pickBndrunFile from bndCliCommands
import { pickBndrunFile } from './bndCliCommands';

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

    // Register bnd-java debug configuration provider
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('bnd-java', new BndJavaDebugConfigProvider())
    );

    // Register debug command
    context.subscriptions.push(
        vscode.commands.registerCommand('bnd.debug.run', async () => {
            const bndrunFile = await pickBndrunFile('Select .bndrun or .bnd file to debug', true);
            if (!bndrunFile) {
                vscode.window.showWarningMessage('No .bndrun or .bnd file selected.');
                return;
            }
            await vscode.debug.startDebugging(
                vscode.workspace.workspaceFolders?.[0],
                {
                    type: 'bnd-java',
                    name: `Debug (bnd) ${bndrunFile}`,
                    request: 'launch',
                    bndrunFile
                }
            );
        })
    );
}

export function deactivate(): Thenable<void> | undefined {
    return client ? client.stop() : undefined;
}

class BndJavaDebugConfigProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | null> {
        // If config is empty, prompt for file
        let bndrunFile = config.bndrunFile;
        if (!bndrunFile) {
            bndrunFile = await pickBndrunFile('Select .bndrun or .bnd file to debug', true);
            if (!bndrunFile) {
                vscode.window.showWarningMessage('No .bndrun or .bnd file selected.');
                return null;
            }
        }

        // Run bnd export run to get the Java command
        let javaCmd = '';
        try {
            const bndCmd = `bnd export run ${bndrunFile}`;
            const { stdout } = await exec(bndCmd, { cwd: folder?.uri.fsPath });
            // Find the line that starts with 'java '
            const javaLine = stdout.split(/\r?\n/).find(line => line.trim().startsWith('java '));
            if (!javaLine) throw new Error('No java command found in bnd output');
            javaCmd = javaLine.trim();
        } catch (err) {
            vscode.window.showErrorMessage('Failed to extract Java command from bnd: ' + (err as Error).message);
            return null;
        }

        // Parse javaCmd into mainClass, classpath, vmArgs, args
        const parsed = parseJavaCommand(javaCmd);
        if (!parsed) {
            vscode.window.showErrorMessage('Could not parse Java command from bnd output.');
            return null;
        }

        // Return a Java debug config
        return {
            type: 'java',
            name: config.name || `Debug (bnd) ${bndrunFile}`,
            request: 'launch',
            mainClass: parsed.mainClass,
            classPaths: parsed.classpath,
            vmArgs: parsed.vmArgs,
            args: parsed.args,
            cwd: folder?.uri.fsPath,
            console: 'integratedTerminal',
        };
    }
}

function parseJavaCommand(cmd: string): { mainClass: string, classpath: string[], vmArgs: string, args: string } | null {
    // Simple parser for: java [vmArgs] -cp "..." mainClass [args]
    const match = cmd.match(/^java\s+([^\n]*?)\s+-cp\s+"([^"]+)"\s+([\w.$]+)\s*(.*)$/);
    if (!match) return null;
    return {
        vmArgs: match[1].trim(),
        classpath: match[2].split(';'),
        mainClass: match[3],
        args: match[4] || ''
    };
}
