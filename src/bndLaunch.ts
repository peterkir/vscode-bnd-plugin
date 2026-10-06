import * as path from 'path';
import * as vscode from 'vscode';
import { findJavaRuntimeHomeForRunee } from './bndCliCommands';

export const launchPrepareCommand = 'bnd.launch.prepare';
export const launchDisposeCommand = 'bnd.launch.dispose';
export const bndDebugType = 'bnd';
export const javaDebugExtensionId = 'vscjava.vscode-java-debug';
const launchIdKey = '__bndLaunchId';

export type LaunchKind = 'run' | 'test';

export interface BndLaunchConfiguration extends vscode.DebugConfiguration {
    target?: string;
    kind?: LaunchKind;
    tests?: string[];
    vmArgs?: string | string[];
    args?: string | string[];
    env?: Record<string, string>;
    console?: string;
    buildBeforeLaunch?: boolean;
    javaExec?: string;
    shortenCommandLine?: string;
    sourcePaths?: string[];
    projectName?: string;
}

export interface PreparedLaunch {
    launchId: string;
    mainClass: string;
    classPaths: string[];
    vmArgs: string[];
    args: string[];
    env: Record<string, string>;
    cwd: string;
    javaExecutable?: string | null;
    runee?: string | null;
    name?: string | null;
    warnings: string[];
    sourcePaths?: string[];
}

export interface LaunchServer {
    supports(command: string): Promise<boolean>;
    execute(command: string, args: unknown[], token?: vscode.CancellationToken): Promise<unknown>;
}

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === 'string');

export function parsePreparedLaunch(value: unknown): PreparedLaunch {
    const result = value as (Partial<PreparedLaunch> & { error?: string; errors?: unknown }) | null;
    if (result?.error) {
        const details = isStringArray(result.errors) && result.errors.length ? result.errors : [result.error];
        throw new Error(details.join('\n'));
    }
    if (!result || typeof result.launchId !== 'string' || typeof result.mainClass !== 'string'
        || !isStringArray(result.classPaths) || !isStringArray(result.vmArgs) || !isStringArray(result.args)
        || typeof result.cwd !== 'string' || !result.env || typeof result.env !== 'object'
        || !Object.values(result.env).every(item => typeof item === 'string')
        || !isStringArray(result.warnings ?? []) || !isStringArray(result.sourcePaths ?? [])) {
        throw new Error('The language server returned an incompatible launch response.');
    }
    return { ...result, warnings: result.warnings ?? [] } as PreparedLaunch;
}

/** Splits a command line string honoring single and double quotes. */
export function splitArguments(value: string | string[] | undefined): string[] {
    if (value === undefined) return [];
    if (Array.isArray(value)) return value;
    const result: string[] = [];
    let current = '';
    let quote: string | undefined;
    let pending = false;
    for (const char of value) {
        if (quote) {
            if (char === quote) quote = undefined;
            else current += char;
        } else if (char === '"' || char === "'") {
            quote = char;
            pending = true;
        } else if (/\s/.test(char)) {
            if (pending || current) result.push(current);
            current = '';
            pending = false;
        } else {
            current += char;
        }
    }
    if (pending || current) result.push(current);
    return result;
}

export function toJavaDebugConfiguration(prepared: PreparedLaunch, config: BndLaunchConfiguration,
    javaExec?: string): vscode.DebugConfiguration {
    const java: vscode.DebugConfiguration = {
        type: 'java',
        request: 'launch',
        name: config.name || prepared.name || 'bnd launch',
        mainClass: prepared.mainClass,
        classPaths: prepared.classPaths,
        sourcePaths: [...new Set([...(prepared.sourcePaths ?? []), ...(config.sourcePaths ?? [])])],
        vmArgs: [...prepared.vmArgs, ...splitArguments(config.vmArgs)],
        args: [...prepared.args, ...splitArguments(config.args)],
        env: { ...prepared.env, ...(config.env ?? {}) },
        cwd: prepared.cwd,
        console: config.console ?? 'integratedTerminal',
        shortenCommandLine: config.shortenCommandLine ?? 'auto',
        [launchIdKey]: prepared.launchId,
    };
    const exec = config.javaExec || prepared.javaExecutable || javaExec;
    if (exec) java.javaExec = exec;
    if (config.projectName) java.projectName = config.projectName;
    if (config.noDebug) java.noDebug = true;
    return java;
}

export function isLaunchTarget(fsPath: string): boolean {
    return fsPath.endsWith('.bndrun') || path.basename(fsPath) === 'bnd.bnd';
}

export function hasTestpath(text: string): boolean {
    return /^-testpath\s*[:=]/m.test(text);
}

export function hasRunSpec(text: string): boolean {
    return /^-run(fw|bundles)\s*[:=]/m.test(text);
}

function javaExecutableFromHome(home: string): string {
    return path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

export class BndDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(private readonly server: LaunchServer, private readonly log: vscode.LogOutputChannel) {}

    async provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined): Promise<vscode.DebugConfiguration[]> {
        const configs = await discoverConfigurations(folder);
        return configs.length ? configs : [{ type: bndDebugType, request: 'launch', name: 'bnd: Debug current file', target: '${file}' }];
    }

    resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined,
        config: BndLaunchConfiguration): BndLaunchConfiguration | undefined {
        if (!config.type && !config.request && !config.name) {
            const document = vscode.window.activeTextEditor?.document;
            if (!document || !isLaunchTarget(document.uri.fsPath)) {
                void vscode.window.showErrorMessage('Open a .bndrun or bnd.bnd file to launch it with bnd.');
                return undefined;
            }
            const test = path.basename(document.uri.fsPath) === 'bnd.bnd' && hasTestpath(document.getText())
                && !hasRunSpec(document.getText());
            return { type: bndDebugType, request: 'launch', name: 'bnd: Launch current file', target: '${file}', kind: test ? 'test' : 'run' };
        }
        config.target ??= '${file}';
        return config;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined,
        config: BndLaunchConfiguration, token?: vscode.CancellationToken): Promise<undefined> {
        try {
            await this.launch(folder, config, token);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log.error(`bnd launch failed: ${message}`);
            void vscode.window.showErrorMessage(`bnd launch failed: ${message}`);
        }
        // The bnd session is replaced by a Java debug session.
        return undefined;
    }

    private async launch(folder: vscode.WorkspaceFolder | undefined, config: BndLaunchConfiguration,
        token?: vscode.CancellationToken): Promise<void> {
        const target = config.target;
        if (!target || !isLaunchTarget(target)) throw new Error(`Expected a .bndrun or bnd.bnd target, got "${target ?? ''}".`);
        if (!(await this.server.supports(launchPrepareCommand))) {
            throw new Error('Launching requires the Java bnd Language Server with launch support. The Node server and older Java servers do not support it.');
        }
        if (!vscode.workspace.isTrusted) throw new Error('Launching requires a trusted workspace.');
        if (!vscode.extensions.getExtension(javaDebugExtensionId)) {
            const install = 'Install Debugger for Java';
            void vscode.window.showErrorMessage('bnd launches require the Debugger for Java extension.', install).then(choice => {
                if (choice === install) void vscode.commands.executeCommand('workbench.extensions.installExtension', javaDebugExtensionId);
            });
            return;
        }

        const kind: LaunchKind = config.kind === 'test' ? 'test' : 'run';
        const raw = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `bnd: Preparing ${path.basename(target)}`,
        }, () => this.server.execute(launchPrepareCommand, [{
            uri: vscode.Uri.file(target).toString(),
            kind,
            tests: config.tests ?? [],
            build: config.buildBeforeLaunch ?? true,
        }], token));
        const prepared = parsePreparedLaunch(raw);
        for (const warning of prepared.warnings) this.log.warn(`${path.basename(target)}: ${warning}`);

        let javaExec: string | undefined;
        if (!config.javaExec && !prepared.javaExecutable && prepared.runee) {
            const runtime = await findJavaRuntimeHomeForRunee(prepared.runee);
            if (runtime) javaExec = javaExecutableFromHome(runtime.home);
            else this.log.warn(`No Java runtime found for -runee ${prepared.runee}; using the Java debugger default.`);
        }

        const javaConfig = toJavaDebugConfiguration(prepared, config, javaExec);
        this.log.info(`Launching ${target} (${kind}) with main class ${prepared.mainClass}`);
        let started = false;
        try {
            started = await vscode.debug.startDebugging(folder, javaConfig, { noDebug: !!config.noDebug });
        } finally {
            if (!started) await this.dispose(prepared.launchId);
        }
    }

    async dispose(launchId: string): Promise<void> {
        try {
            if (await this.server.supports(launchDisposeCommand)) {
                await this.server.execute(launchDisposeCommand, [launchId]);
            }
        } catch (err) {
            this.log.warn(`Could not dispose bnd launch ${launchId}: ${err}`);
        }
    }

    onSessionTerminated(session: vscode.DebugSession): void {
        const id = session.configuration[launchIdKey];
        if (typeof id === 'string') void this.dispose(id);
    }
}

async function discoverConfigurations(folder: vscode.WorkspaceFolder | undefined): Promise<BndLaunchConfiguration[]> {
    if (!folder) return [];
    const exclude = '**/{node_modules,generated,bin,bin_test,target,.git}/**';
    const [bndruns, projects] = await Promise.all([
        vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.bndrun'), exclude, 200),
        vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/bnd.bnd'), exclude, 200),
    ]);
    const relative = (uri: vscode.Uri) => path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
    const configs: BndLaunchConfiguration[] = bndruns.sort((a, b) => a.fsPath.localeCompare(b.fsPath)).map(uri => ({
        type: bndDebugType,
        request: 'launch',
        name: `bnd: ${relative(uri)}`,
        target: `\${workspaceFolder}/${relative(uri)}`,
        kind: 'run',
    }));
    for (const uri of projects.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        if (hasTestpath(text)) {
            configs.push({
                type: bndDebugType,
                request: 'launch',
                name: `bnd tests: ${path.basename(path.dirname(uri.fsPath))}`,
                target: `\${workspaceFolder}/${relative(uri)}`,
                kind: 'test',
            });
        }
    }
    return configs;
}

export class BndLaunchCodeLensProvider implements vscode.CodeLensProvider {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.changed.event;

    refresh(): void {
        this.changed.fire();
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!vscode.workspace.getConfiguration('bnd').get<boolean>('launch.codeLens', true)
            || document.uri.scheme !== 'file' || !isLaunchTarget(document.uri.fsPath)) {
            return [];
        }
        const range = new vscode.Range(0, 0, 0, 0);
        const text = document.getText();
        const lenses: vscode.CodeLens[] = [];
        if (document.uri.fsPath.endsWith('.bndrun') || hasRunSpec(text)) {
            lenses.push(
                new vscode.CodeLens(range, { title: 'Run OSGi', command: 'bnd.launch.run', arguments: [document.uri] }),
                new vscode.CodeLens(range, { title: 'Debug OSGi', command: 'bnd.launch.debug', arguments: [document.uri] }),
            );
        }
        if (hasTestpath(text)) {
            lenses.push(
                new vscode.CodeLens(range, { title: 'Run OSGi tests', command: 'bnd.launch.runTests', arguments: [document.uri] }),
                new vscode.CodeLens(range, { title: 'Debug OSGi tests', command: 'bnd.launch.debugTests', arguments: [document.uri] }),
            );
        }
        return lenses;
    }
}

export async function pickLaunchTarget(kind: LaunchKind): Promise<vscode.Uri | undefined> {
    const files = await vscode.workspace.findFiles('**/{*.bndrun,bnd.bnd}',
        '**/{node_modules,generated,bin,bin_test,target,.git}/**', 500);
    if (!files.length) {
        void vscode.window.showWarningMessage('No .bndrun or bnd.bnd files found in the workspace.');
        return undefined;
    }
    const items = files
        .map(uri => ({ uri, label: path.basename(uri.fsPath), description: path.dirname(vscode.workspace.asRelativePath(uri, true)) }))
        .sort((a, b) => `${a.description}/${a.label}`.localeCompare(`${b.description}/${b.label}`));
    const picked = await vscode.window.showQuickPick(items, {
        title: kind === 'test' ? 'Select the bnd project to test' : 'Select the .bndrun or bnd.bnd file to launch',
        placeHolder: 'Type to filter by file or folder name',
        matchOnDescription: true,
    });
    return picked?.uri;
}

async function startFromUri(arg: vscode.Uri | { uri?: vscode.Uri } | undefined, kind: LaunchKind,
    noDebug: boolean): Promise<void> {
    let target = arg instanceof vscode.Uri ? arg : arg?.uri;
    if (!target) {
        const active = vscode.window.activeTextEditor?.document.uri;
        target = active?.scheme === 'file' && isLaunchTarget(active.fsPath) ? active : await pickLaunchTarget(kind);
        if (!target) return;
    }
    if (target.scheme !== 'file' || !isLaunchTarget(target.fsPath)) {
        void vscode.window.showWarningMessage('Select a .bndrun or bnd.bnd file to launch.');
        return;
    }
    const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === target.toString());
    if (document?.isDirty) await document.save();
    const label = kind === 'test' ? 'tests' : path.basename(target.fsPath);
    const config: BndLaunchConfiguration = {
        type: bndDebugType,
        request: 'launch',
        name: `bnd ${kind === 'test' ? 'test' : 'run'}: ${label}`,
        target: target.fsPath,
        kind,
    };
    await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(target), config, { noDebug });
}

export function registerLaunchSupport(context: vscode.ExtensionContext, server: LaunchServer,
    log: vscode.LogOutputChannel): void {
    const provider = new BndDebugConfigurationProvider(server, log);
    const codeLens = new BndLaunchCodeLensProvider();
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider(bndDebugType, provider),
        vscode.debug.registerDebugConfigurationProvider(bndDebugType, {
            provideDebugConfigurations: folder => discoverConfigurations(folder),
        }, vscode.DebugConfigurationProviderTriggerKind.Dynamic),
        vscode.debug.onDidTerminateDebugSession(session => provider.onSessionTerminated(session)),
        vscode.languages.registerCodeLensProvider({ language: 'bnd', scheme: 'file' }, codeLens),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('bnd.launch.codeLens')) codeLens.refresh();
        }),
        vscode.commands.registerCommand('bnd.launch.run', (arg?: vscode.Uri | { uri?: vscode.Uri }) => startFromUri(arg, 'run', true)),
        vscode.commands.registerCommand('bnd.launch.debug', (arg?: vscode.Uri | { uri?: vscode.Uri }) => startFromUri(arg, 'run', false)),
        vscode.commands.registerCommand('bnd.launch.runTests', (arg?: vscode.Uri | { uri?: vscode.Uri }) => startFromUri(arg, 'test', true)),
        vscode.commands.registerCommand('bnd.launch.debugTests', (arg?: vscode.Uri | { uri?: vscode.Uri }) => startFromUri(arg, 'test', false)),
    );
}
