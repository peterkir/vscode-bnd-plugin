import * as cp from 'child_process';
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
import { EffectivePropertiesProvider, effectiveCommand, parseEffectiveResult } from './effectiveProperties';
import { cmdSelectServerJar, refreshServerJar, resolveServerJar } from './serverJar';

let client: LanguageClient | undefined;
let clientReady: Promise<void> | undefined;
let configRestartTimer: NodeJS.Timeout | undefined;
export let outputChannel: vscode.LogOutputChannel;
let effectiveProvider: EffectivePropertiesProvider | undefined;

export interface JavaVersionInfo {
    valid: boolean;
    major?: number;
    rawVersion?: string;
    executablePath: string;
    error?: string;
}

export function resolveBndrunUri(uri: vscode.Uri): string {
    return uri.toString().replace(/^file:\/\/\/([a-z])%3A/i, 'file:///$1:');
}

export function activate(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('bnd Language Server', { log: true });
    context.subscriptions.push(outputChannel);
    // Assigned synchronously (not inside startLanguageClient) so callers awaiting clientReady
    // never observe it as undefined while Java-version detection is still in progress.
    clientReady = startLanguageClient(context).catch(handleLanguageClientError);
    effectiveProvider = new EffectivePropertiesProvider(context, async (document, options, token) => {
        if (!vscode.workspace.isTrusted) throw new Error('Effective properties require a trusted workspace.');
        await clientReady;
        const activeClient = client;
        if (!activeClient?.initializeResult?.capabilities.executeCommandProvider?.commands.includes(effectiveCommand)) {
            throw new Error('Effective properties require an updated Java bnd Language Server. Node and older servers do not support this view.');
        }
        const result = await activeClient.sendRequest('workspace/executeCommand', {
            command: effectiveCommand,
            arguments: [{ uri: document.uri.toString(), documentVersion: document.version, ...options }],
        }, token);
        if (activeClient !== client) throw new Error('Language server restarted. Refresh Effective properties.');
        return parseEffectiveResult(result);
    });
    context.subscriptions.push(effectiveProvider);
    context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void vscode.commands.executeCommand('bnd.server.restart');
    }));

    // Debounced: selecting a server JAR updates several settings in a row.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('bnd.server') || event.affectsConfiguration('bnd.cli.javaExecutable')) {
                clearTimeout(configRestartTimer);
                configRestartTimer = setTimeout(async () => {
                    outputChannel.appendLine('Configuration changed for bnd language server. Restarting...');
                    if (client) {
                        await client.stop();
                        client = undefined;
                        clientReady = undefined;
                    }
                    clientReady = startLanguageClient(context).catch(handleLanguageClientError);
                }, 300);
            }
        }),
        { dispose: () => clearTimeout(configRestartTimer) },
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('bnd.server.selectJar', () => cmdSelectServerJar(context))
    );

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
        vscode.commands.registerCommand('bnd.lsp.resolve', async (uri?: vscode.Uri) => {
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
                    arguments: [resolveBndrunUri(targetUri)],
                });
                if (res && typeof res === 'object' && 'error' in res) {
                    throw new Error(String(res.error));
                }
                vscode.window.showInformationMessage(`bnd resolution completed: ${JSON.stringify(res)}`);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Resolution failed: ${err?.message ?? err}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('bnd.lsp.buildProject', async (uri?: vscode.Uri) => {
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
        vscode.commands.registerCommand('bnd.lsp.expandMacro', async () => {
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

function stripQuotes(value: string): string {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

export function normalizePath(rawPath: string): string {
    let p = rawPath.trim();
    // Convert MSYS / Git Bash POSIX drive prefix (/c/... -> C:/...)
    if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(p)) {
        p = `${p.charAt(1).toUpperCase()}:${p.slice(2)}`;
    }
    return p;
}

export function inspectJavaExecutable(javaExec: string): JavaVersionInfo {
    const normalized = normalizePath(stripQuotes(javaExec));
    try {
        const res = cp.spawnSync(normalized, ['-version'], {
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true,
        });
        if (res.error) {
            return {
                valid: false,
                executablePath: normalized,
                error: res.error.message,
            };
        }
        const output = `${res.stderr || ''}\n${res.stdout || ''}`;
        const match = output.match(/(?:java|openjdk|version)\s*(?:version\s*)?"?([0-9]+(?:\.[0-9_]+)*)"?/i);
        if (!match) {
            return {
                valid: false,
                executablePath: normalized,
                error: output.trim() ? `Unexpected version output: ${output.trim()}` : 'No output from java -version',
            };
        }
        const rawVersion = match[1];
        let major = parseInt(rawVersion.split('.')[0], 10);
        if (major === 1) {
            const parts = rawVersion.split('.');
            major = parts.length > 1 ? parseInt(parts[1], 10) : 1;
        }
        return {
            valid: !isNaN(major),
            major,
            rawVersion,
            executablePath: normalized,
        };
    } catch (err: any) {
        return {
            valid: false,
            executablePath: normalized,
            error: err?.message ?? String(err),
        };
    }
}

export function findCompatibleJavaExecutable(
    config: vscode.WorkspaceConfiguration,
    minVersion = 17
): { selected?: JavaVersionInfo; allAttempted: JavaVersionInfo[] } {
    const candidates: string[] = [];

    // 1. Explicit server configuration
    const serverJava = config.get<string>('server.javaExecutable')?.trim();
    if (serverJava) {
        candidates.push(serverJava);
    }

    // 2. CLI java configuration (if specified and not generic default)
    const cliJava = config.get<string>('cli.javaExecutable')?.trim();
    if (cliJava && cliJava !== 'java') {
        candidates.push(cliJava);
    }

    // 3. VS Code java.configuration.runtimes
    const javaConfigRuntimes = vscode.workspace.getConfiguration('java').get<unknown>('configuration.runtimes', []);
    if (Array.isArray(javaConfigRuntimes)) {
        for (const entry of javaConfigRuntimes) {
            if (typeof entry === 'object' && entry !== null && 'path' in entry && typeof (entry as any).path === 'string') {
                const runtimePath = (entry as any).path;
                const binCandidate = path.join(normalizePath(runtimePath), 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
                candidates.push(binCandidate);
            }
        }
    }

    // 4. JAVA_HOME environment variable
    const javaHome = process.env['JAVA_HOME']?.trim();
    if (javaHome) {
        const binCandidate = path.join(normalizePath(javaHome), 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        candidates.push(binCandidate);
    }

    // 5. Default PATH 'java'
    candidates.push('java');

    const attempted: JavaVersionInfo[] = [];
    const seen = new Set<string>();

    for (const rawCandidate of candidates) {
        const candidate = normalizePath(stripQuotes(rawCandidate));
        const key = candidate.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const info = inspectJavaExecutable(candidate);
        attempted.push(info);
        if (info.valid && (info.major ?? 0) >= minVersion) {
            return { selected: info, allAttempted: attempted };
        }
    }

    return { selected: undefined, allAttempted: attempted };
}

/**
 * A running JVM keeps its -jar file open, and on Windows that blocks the bnd build from
 * replacing it, so a custom bnd.server.jar (typically a build output) is launched from a copy.
 */
export function copyCustomServerJar(context: vscode.ExtensionContext, jarPath: string): string {
    try {
        const stat = fs.statSync(jarPath);
        const copyDir = path.join(context.globalStorageUri.fsPath, 'server-jar');
        fs.mkdirSync(copyDir, { recursive: true });
        const baseName = path.basename(jarPath, '.jar');
        const copyName = `${baseName}-${Math.floor(stat.mtimeMs)}-${stat.size}.jar`;
        const copyPath = path.join(copyDir, copyName);
        if (!fs.existsSync(copyPath)) {
            fs.copyFileSync(jarPath, copyPath);
        }
        for (const entry of fs.readdirSync(copyDir)) {
            if (entry !== copyName && entry.startsWith(`${baseName}-`) && entry.endsWith('.jar')) {
                // Copies still used by other windows are locked; those are cleaned up on a later start.
                fs.rm(path.join(copyDir, entry), { force: true }, () => undefined);
            }
        }
        outputChannel?.appendLine(`Launching copy of custom server JAR ${jarPath} from ${copyPath}`);
        return copyPath;
    } catch (err) {
        outputChannel?.appendLine(`Could not copy custom server JAR ${jarPath}, launching it directly: ${err}`);
        return jarPath;
    }
}

async function startLanguageClient(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('bnd');
    const mode = config.get<string>('server.mode', 'java');

    let serverOptions: ServerOptions;
    let launchedJar: ReturnType<typeof resolveServerJar> | undefined;

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
        const resolved = resolveServerJar(context, config, message => {
            outputChannel.appendLine(message);
            void vscode.window.showWarningMessage(message);
        });
        const jarPath = resolved.isLocalBuild ? copyCustomServerJar(context, resolved.path) : resolved.path;
        outputChannel.appendLine(`bnd Language Server JAR source: ${resolved.origin}`);
        launchedJar = resolved;

        if (!fs.existsSync(jarPath)) {
            outputChannel.appendLine(`bnd Language Server JAR not found at ${jarPath}. Falling back to Node.js server.`);
            vscode.window.showWarningMessage(
                `bnd Language Server JAR not found at ${jarPath}. Falling back to Node.js server.`
            );
            serverOptions = createNodeServerOptions(context);
        } else {
            // Verify Java runtime availability and version (Java 17+)
            const { selected: javaInfo, allAttempted } = findCompatibleJavaExecutable(config, 17);

            if (!javaInfo) {
                const diagLines = allAttempted.map(
                    a => `  - ${a.executablePath}: ${a.error ? a.error : `Java ${a.rawVersion} (major: ${a.major})`}`
                ).join('\n');

                outputChannel.appendLine(
                    `bnd Language Server JAR requires Java 17+, but no compatible Java runtime was found:\n${diagLines}\nFalling back to Node.js server.`
                );

                const foundMsg = allAttempted.find(a => a.major !== undefined)
                    ? `found Java ${allAttempted.find(a => a.major !== undefined)!.major}`
                    : 'no Java runtime found';

                void vscode.window.showWarningMessage(
                    `bnd Language Server requires Java 17+ (${foundMsg}). Falling back to Node.js server.`,
                    'Select Java Runtime',
                    'Open Settings'
                ).then(action => {
                    if (action === 'Select Java Runtime') {
                        void vscode.commands.executeCommand('bnd.cli.selectJavaRuntime');
                    } else if (action === 'Open Settings') {
                        void vscode.commands.executeCommand('workbench.action.openSettings', 'bnd.server');
                    }
                });

                serverOptions = createNodeServerOptions(context);
            } else {
                outputChannel.appendLine(
                    `Starting bnd Language Server JAR with Java ${javaInfo.major} (${javaInfo.rawVersion}) at "${javaInfo.executablePath}"`
                );

                const jvmArgs = config.get<string[]>('server.jvmArgs', []);
                const executable: Executable = {
                    command: javaInfo.executablePath,
                    args: [...jvmArgs, '-jar', jarPath],
                    options: { env: process.env },
                };
                serverOptions = {
                    run: executable,
                    debug: executable,
                };
            }
        }
    } else {
        serverOptions = createNodeServerOptions(context);
    }

    // Download in parallel to the start, so startup never waits on the network.
    if (launchedJar?.pending) {
        void refreshServerJar(context, launchedJar.pending, launchedJar.path);
    }

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'bnd' }],
        initializationOptions: { workspaceTrusted: vscode.workspace.isTrusted },
        outputChannel,
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{bnd,bndrun,mvn,packageinfo}'),
        },
        initializationFailedHandler: (error) => {
            const msg = error instanceof Error ? (error.stack || error.message) : String(error);
            outputChannel.appendLine(`LSP initialization error: ${msg}`);
            outputChannel.show(true);
            return false;
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
    effectiveProvider?.refresh();
}

async function supportsServerCommand(command: string): Promise<boolean> {
    await clientReady;
    return client?.initializeResult?.capabilities.executeCommandProvider?.commands.includes(command) ?? false;
}

function handleLanguageClientError(error: unknown): void {
    const message = error instanceof Error ? (error.stack || error.message) : String(error);
    outputChannel.appendLine(`Language Server startup failed:\n${message}`);
    outputChannel.show(true);
    vscode.window.showErrorMessage(`bnd Language Server failed to start: ${error instanceof Error ? error.message : error}`);
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
