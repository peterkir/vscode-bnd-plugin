import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BND_COMMANDS } from './bndCommandData';

const BND_GROUP_PATH = 'biz/aQute/bnd';
const BND_ARTIFACT_ID = 'biz.aQute.bnd';
const BND_DEFAULT_VERSION = '7.2.3';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Returns the configured bnd executable (e.g. "bnd" or "java -jar /path/to/biz.aQute.bnd.jar"). */
function bndExec(): string {
    const cfg = vscode.workspace.getConfiguration('bnd');
    return expandEnvironmentPlaceholders(cfg.get<string>('cli.executable', 'bnd'));
}

function bndMavenRepository(): string {
    const cfg = vscode.workspace.getConfiguration('bnd');
    return cfg.get<string>('cli.mavenRepository', 'https://repo.maven.apache.org/maven2').replace(/\/+$/, '');
}

function bndJavaExecutable(): string {
    const cfg = vscode.workspace.getConfiguration('bnd');
    return expandEnvironmentPlaceholders(cfg.get<string>('cli.javaExecutable', 'java'));
}

/** Returns the current workspace folder path, or undefined. */
function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// ─── Terminal Helper ──────────────────────────────────────────────────────────

/** Create a fresh terminal for each bnd command execution. */
function createBndTerminal(env: NodeJS.ProcessEnv, cwd: string | undefined): vscode.Terminal {
    return vscode.window.createTerminal({
        name: 'bnd',
        env,
        cwd,
    });
}

function stripWrappedQuotes(value: string): string {
    return value.replace(/^['"]|['"]$/g, '');
}

type WindowsShellKind = 'bash' | 'powershell' | 'cmd' | 'other';

function configuredWindowsShellKind(): WindowsShellKind {
    if (process.platform !== 'win32') {
        return 'other';
    }

    const terminalCfg = vscode.workspace.getConfiguration('terminal.integrated');
    const profileName = terminalCfg.get<string>('defaultProfile.windows', '');
    const profiles = terminalCfg.get<Record<string, unknown>>('profiles.windows', {});

    const shellHints: string[] = [];
    if (profileName) {
        shellHints.push(profileName);
    }

    const profile = (profiles && typeof profiles === 'object')
        ? (profiles as Record<string, unknown>)[profileName]
        : undefined;
    if (profile && typeof profile === 'object') {
        const p = (profile as { path?: unknown }).path;
        if (typeof p === 'string') {
            shellHints.push(p);
        } else if (Array.isArray(p)) {
            for (const v of p) {
                if (typeof v === 'string') {
                    shellHints.push(v);
                }
            }
        }

        const source = (profile as { source?: unknown }).source;
        if (typeof source === 'string') {
            shellHints.push(source);
        }
    }

    const hint = shellHints.join(' ').toLowerCase();
    if (/(git\s*bash|bash\.exe|mingw|msys|wsl\.exe)/.test(hint)) {
        return 'bash';
    }
    if (/(power\s*shell|pwsh|powershell\.exe|windows powershell)/.test(hint)) {
        return 'powershell';
    }
    if (/(command\s*prompt|cmd\.exe|^cmd$)/.test(hint)) {
        return 'cmd';
    }

    return 'other';
}

function splitExecutableCommand(command: string): { executable: string; remainder: string } {
    const trimmed = command.trim();
    const match = trimmed.match(/^("[^"]+"|'[^']+'|\S+)([\s\S]*)$/);
    if (!match) {
        return { executable: trimmed, remainder: '' };
    }

    return {
        executable: match[1],
        remainder: match[2] ?? '',
    };
}

function toGitBashPath(executablePath: string): string {
    const normalized = stripWrappedQuotes(executablePath);
    const drivePath = normalized.match(/^([A-Za-z]):[\\/](.*)$/);
    if (!drivePath) {
        return normalized;
    }

    const drive = drivePath[1].toLowerCase();
    const tail = drivePath[2].replace(/\\/g, '/');
    return `/${drive}/${tail}`;
}

function quoteForBash(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function commandForActiveShell(command: string): string {
    if (process.platform !== 'win32') {
        return command;
    }

    const shellKind = configuredWindowsShellKind();
    const { executable, remainder } = splitExecutableCommand(command);
    const unquotedExecutable = stripWrappedQuotes(executable);

    if (shellKind === 'bash') {
        const bashExecutable = toGitBashPath(unquotedExecutable);
        return `${quoteForBash(bashExecutable)}${remainder}`;
    }

    if (shellKind === 'powershell') {
        if (/^".*"$/.test(executable) || /^'.*'$/.test(executable)) {
            return `& ${executable}${remainder}`;
        }
    }

    return `${executable}${remainder}`;
}

function envValue(name: string): string | undefined {
    const direct = process.env[name];
    if (direct !== undefined) {
        return direct;
    }

    // Windows environment variables are case-insensitive.
    const target = name.toLowerCase();
    const foundKey = Object.keys(process.env).find(key => key.toLowerCase() === target);
    return foundKey ? process.env[foundKey] : undefined;
}

function expandEnvironmentPlaceholders(value: string): string {
    return value
        .replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (full, name: string) => envValue(name) ?? full)
        .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, (full, name: string) => envValue(name) ?? full)
        .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (full, name: string) => envValue(name) ?? full);
}

function getJavaHomeFromExecutable(javaExec: string): string | undefined {
    const normalized = stripWrappedQuotes(javaExec.trim());
    if (!normalized) {
        return undefined;
    }

    const baseName = path.basename(normalized).toLowerCase();
    const javaNames = process.platform === 'win32'
        ? new Set(['java', 'java.exe'])
        : new Set(['java']);
    if (!javaNames.has(baseName)) {
        return undefined;
    }

    const hasExplicitPath = path.isAbsolute(normalized)
        || normalized.includes('/')
        || normalized.includes('\\');
    if (!hasExplicitPath) {
        return undefined;
    }

    const binDir = path.dirname(normalized);
    if (path.basename(binDir).toLowerCase() !== 'bin') {
        return undefined;
    }

    return path.dirname(binDir);
}

function configuredJavaRuntimeHome(): string | undefined {
    const configuredExecutableHome = getJavaHomeFromExecutable(bndJavaExecutable());
    if (configuredExecutableHome) {
        return configuredExecutableHome;
    }

    const runtimes = getConfiguredJavaRuntimes()
        .filter((runtime): runtime is JavaRuntimeEntry & { path: string } => typeof runtime.path === 'string' && runtime.path.length > 0);
    const preferredRuntime = runtimes.find(runtime => runtime.default) ?? runtimes[0];
    if (preferredRuntime) {
        return preferredRuntime.path;
    }

    return undefined;
}

function buildTerminalEnvironment(javaHome: string): NodeJS.ProcessEnv {
    const pathDelimiter = path.delimiter;
    const currentPath = process.env.PATH ?? process.env.Path ?? '';
    const javaBin = path.join(javaHome, 'bin');

    return {
        JAVA_HOME: javaHome,
        PATH: currentPath ? `${javaBin}${pathDelimiter}${currentPath}` : javaBin,
        Path: currentPath ? `${javaBin}${pathDelimiter}${currentPath}` : javaBin,
    };
}

async function pickJavaRuntimeHome(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Bnd: Select Java Runtime Home',
        openLabel: 'Use Java Runtime',
    });
    if (!picked || picked.length === 0) {
        return undefined;
    }

    const runtimeHome = picked[0].fsPath;
    const javaExec = javaBinaryPath(runtimeHome);
    try {
        await fs.access(javaExec);
        return runtimeHome;
    } catch {
        vscode.window.showErrorMessage(`Selected folder does not contain a Java executable at ${javaExec}`);
        return undefined;
    }
}

async function configureJavaRuntimeFromFolder(): Promise<string | undefined> {
    const runtimeHome = await pickJavaRuntimeHome();
    if (!runtimeHome) {
        return undefined;
    }

    const javaExec = javaBinaryPath(runtimeHome);
    await configureJavaExecutable(javaExec);
    vscode.window.showInformationMessage(`Configured bnd CLI Java runtime: ${javaExec}`);
    return runtimeHome;
}

async function ensureJavaRuntimeConfigured(): Promise<string | undefined> {
    const existingRuntime = configuredJavaRuntimeHome();
    if (existingRuntime) {
        return existingRuntime;
    }

    const action = await vscode.window.showWarningMessage(
        'A Java runtime must be configured before running bnd commands.',
        { modal: true },
        'Select Java Runtime',
        'Discover Runtimes'
    );

    if (action === 'Select Java Runtime') {
        return configureJavaRuntimeFromFolder();
    }

    if (action === 'Discover Runtimes') {
        await vscode.commands.executeCommand('bnd.cli.discoverJavaRuntimes');
        const discoveredRuntime = configuredJavaRuntimeHome();
        if (discoveredRuntime) {
            return discoveredRuntime;
        }

        const selectDiscovered = await vscode.window.showInformationMessage(
            'Java runtimes were discovered. Select one to continue.',
            'Select Java Runtime'
        );
        if (selectDiscovered === 'Select Java Runtime') {
            await cmdSelectJavaRuntime();
            return configuredJavaRuntimeHome();
        }
    }

    return undefined;
}

function runInTerminal(args: string): void {
    void runInTerminalInternal(args);
}

async function runInTerminalInternal(args: string): Promise<void> {
    const javaHome = await ensureJavaRuntimeConfigured();
    if (!javaHome) {
        return;
    }

    const wsRoot = workspaceRoot();
    const term = createBndTerminal(buildTerminalEnvironment(javaHome), wsRoot);
    term.show(true);
    const command = commandForActiveShell(`${bndExec()} ${args}`);
    term.sendText(command);
}

async function fetchUrl(url: string): Promise<Uint8Array> {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'vscode-bnd',
            'Accept': '*/*',
        },
        redirect: 'follow',
    });
    if (!response.ok) {
        throw new Error(`Request failed with ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
    const bytes = await fetchUrl(url);
    return new TextDecoder('utf-8').decode(bytes);
}

function parseVersions(metadataXml: string): string[] {
    const versions = [...metadataXml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map(match => match[1].trim())
        .filter(Boolean);
    return [...new Set(versions)];
}

function parseLatestVersion(metadataXml: string, versions: string[]): string {
    const release = metadataXml.match(/<release>([^<]+)<\/release>/)?.[1]?.trim();
    const latest = metadataXml.match(/<latest>([^<]+)<\/latest>/)?.[1]?.trim();
    return release || latest || versions[versions.length - 1] || BND_DEFAULT_VERSION;
}

interface BndVersionMetadata {
    latest: string;
    versions: string[];
}

async function fetchBndVersionMetadata(): Promise<BndVersionMetadata> {
    const metadataUrl = `${bndMavenRepository()}/${BND_GROUP_PATH}/${BND_ARTIFACT_ID}/maven-metadata.xml`;
    const metadataXml = await fetchText(metadataUrl);
    const versions = parseVersions(metadataXml);
    return {
        latest: parseLatestVersion(metadataXml, versions),
        versions,
    };
}

function jarFileName(version: string): string {
    return `${BND_ARTIFACT_ID}-${version}.jar`;
}

function jarDownloadUrl(version: string): string {
    return `${bndMavenRepository()}/${BND_GROUP_PATH}/${BND_ARTIFACT_ID}/${version}/${jarFileName(version)}`;
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(uri);
}

async function configureDownloadedJar(jarUri: vscode.Uri): Promise<void> {
    const executable = `${quoteForCommand(bndJavaExecutable())} -jar "${jarUri.fsPath}"`;
    await vscode.workspace.getConfiguration('bnd').update(
        'cli.executable',
        executable,
        vscode.ConfigurationTarget.Global,
    );
}

function quoteForCommand(commandPart: string): string {
    const expanded = expandEnvironmentPlaceholders(commandPart);
    const stripped = stripWrappedQuotes(expanded);
    if (/^".*"$/.test(expanded)) {
        return expanded;
    }

    const needsQuotes = /\s/.test(stripped);

    return needsQuotes ? `"${stripped}"` : stripped;
}

interface JavaRuntimeEntry {
    name?: string;
    path?: string;
    default?: boolean;
    [key: string]: unknown;
}

function javaBinaryPath(runtimeHome: string): string {
    return path.join(runtimeHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

function normalizeFsPath(p: string): string {
    return process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p);
}

function getConfiguredJavaRuntimes(): JavaRuntimeEntry[] {
    const value = vscode.workspace.getConfiguration('java').get<unknown>('configuration.runtimes', []);
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is JavaRuntimeEntry => typeof entry === 'object' && entry !== null);
}

async function updateConfiguredJavaRuntimes(runtimes: JavaRuntimeEntry[]): Promise<void> {
    await vscode.workspace.getConfiguration('java').update(
        'configuration.runtimes',
        runtimes,
        vscode.ConfigurationTarget.Global,
    );
}

function replaceJavaExecutable(currentExecutable: string, javaExecutable: string): string {
    const jarMatch = currentExecutable.match(/^("[^"]+"|\S+)(\s+-jar\s+.+)$/);
    if (jarMatch) {
        return `${quoteForCommand(javaExecutable)}${jarMatch[2]}`;
    }
    return currentExecutable;
}

async function configureJavaExecutable(javaExecutable: string): Promise<void> {
    const bndCfg = vscode.workspace.getConfiguration('bnd');
    await bndCfg.update('cli.javaExecutable', javaExecutable, vscode.ConfigurationTarget.Global);

    const currentExecutable = bndCfg.get<string>('cli.executable', 'bnd');
    const updated = replaceJavaExecutable(currentExecutable, javaExecutable);
    if (updated !== currentExecutable) {
        await bndCfg.update('cli.executable', updated, vscode.ConfigurationTarget.Global);
    }
}

async function readRuntimeDisplayName(runtimeHome: string): Promise<string> {
    try {
        const releasePath = path.join(runtimeHome, 'release');
        const content = await fs.readFile(releasePath, 'utf8');
        const version = content.match(/^JAVA_VERSION="([^"]+)"/m)?.[1];
        if (version) {
            const major = version.split('.')[0];
            return `JavaSE-${major}`;
        }
    } catch {
        // Ignore missing or unreadable release files.
    }
    return path.basename(runtimeHome);
}

async function findJavaRuntimeHomes(rootFolder: string): Promise<string[]> {
    const foundHomes = new Set<string>();
    const skippedDirs = new Set(['.git', '.svn', '.hg', 'node_modules', 'target', 'build', 'dist', '.gradle', '.m2']);

    const walk = async (dir: string): Promise<void> => {
        let entries: Dirent[];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (skippedDirs.has(entry.name.toLowerCase())) {
                    continue;
                }
                await walk(entryPath);
                continue;
            }

            const isJavaBinary = process.platform === 'win32'
                ? entry.name.toLowerCase() === 'java.exe'
                : entry.name === 'java';
            if (!isJavaBinary) {
                continue;
            }

            if (path.basename(path.dirname(entryPath)).toLowerCase() !== 'bin') {
                continue;
            }

            foundHomes.add(path.dirname(path.dirname(entryPath)));
        }
    };

    await walk(rootFolder);
    return [...foundHomes];
}

async function downloadBndJar(context: vscode.ExtensionContext, version: string): Promise<vscode.Uri> {
    const toolDir = vscode.Uri.joinPath(context.globalStorageUri, 'library', 'tool');
    await ensureDirectory(toolDir);

    const jarUri = vscode.Uri.joinPath(toolDir, jarFileName(version));
    const jarBytes = await fetchUrl(jarDownloadUrl(version));
    await vscode.workspace.fs.writeFile(jarUri, jarBytes);
    return jarUri;
}

async function pickBndVersion(versions: string[], latest: string): Promise<string | undefined> {
    const recentVersions = [...versions].reverse().slice(0, 20);

    const quickPickItems: vscode.QuickPickItem[] = [
        ...recentVersions.map(version => ({
            label: version,
            description: version === latest ? 'Latest release' : version === BND_DEFAULT_VERSION ? 'Default recommended version' : undefined,
        })),
        {
            label: 'Enter another version...',
            description: 'Type an explicit older or newer version',
        },
    ];

    const choice = await vscode.window.showQuickPick(quickPickItems, {
        title: 'Bnd: Download bnd CLI JAR Version',
        placeHolder: 'Select an available version or enter another one',
    });
    if (!choice) { return undefined; }
    if (choice.label === 'Enter another version...') {
        return vscode.window.showInputBox({
            title: 'Bnd: Download bnd CLI JAR Version',
            prompt: 'Enter the bnd version to download from Maven Central or your configured mirror',
            value: BND_DEFAULT_VERSION,
            validateInput: value => value.trim() ? undefined : 'Version is required.',
        });
    }
    return choice.label;
}

// ─── Active-editor helper ─────────────────────────────────────────────────────

/**
 * If the currently active editor is a `.bnd` or `.bndrun` file, returns its
 * workspace-relative path so it can be passed directly to the CLI.
 * Returns `undefined` when no such file is active.
 */
function activeRunFile(): string | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') { return undefined; }
    if (!uri.fsPath.endsWith('.bndrun') && !uri.fsPath.endsWith('.bnd')) { return undefined; }
    return vscode.workspace.asRelativePath(uri);
}

interface RunFileItem extends vscode.QuickPickItem {
    /** Workspace-relative path, or '' to mean "current project default". */
    file: string;
}

/**
 * Shows a QuickPick of all `.bndrun` files in the workspace.
 * When the active editor is a `.bnd`/`.bndrun` file that file is floated to
 * the top of the list and pre-focused so the user can confirm with Enter.
 *
 * @param title         Title shown in the picker header.
 * @param allowDefault  When true, a "(current project)" entry is prepended.
 * @returns The chosen relative file path, `''` for the current-project entry,
 *          or `undefined` if the user cancelled.
 */
async function pickBndrunFile(title: string, allowDefault: boolean): Promise<string | undefined> {
    const found = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    const active = activeRunFile();

    const items: RunFileItem[] = [];

    if (allowDefault) {
        items.push({
            label: '$(folder) (current project)',
            description: 'Use the default bndrun of the current project',
            file: '',
        });
    }

    // Active file first, rest sorted alphabetically
    const sorted = [...found].sort((a, b) => {
        const ra = vscode.workspace.asRelativePath(a);
        const rb = vscode.workspace.asRelativePath(b);
        if (ra === active) { return -1; }
        if (rb === active) { return 1; }
        return ra.localeCompare(rb);
    });

    for (const f of sorted) {
        const rel = vscode.workspace.asRelativePath(f);
        items.push({
            label: rel,
            description: rel === active ? '$(edit) currently open' : undefined,
            file: rel,
        });
    }

    if (items.length === 0) {
        return undefined;
    }

    return new Promise(resolve => {
        const qp = vscode.window.createQuickPick<RunFileItem>();
        qp.title = title;
        qp.placeholder = 'Select a .bndrun file';
        qp.items = items;

        // Pre-focus the active file so Enter runs it immediately
        if (active) {
            const activeItem = items.find(i => i.file === active);
            if (activeItem) { qp.activeItems = [activeItem]; }
        }

        qp.onDidAccept(() => {
            const selected = qp.selectedItems[0];
            resolve(selected?.file);
            qp.dispose();
        });
        qp.onDidHide(() => {
            resolve(undefined);
            qp.dispose();
        });
        qp.show();
    });
}

// ─── Individual Command Handlers ──────────────────────────────────────────────

/** bnd build [-t] [-w] */
async function cmdBuild(): Promise<void> {
    const choice = await vscode.window.showQuickPick(
        [
            { label: 'Build', description: 'bnd build', cmd: '' },
            { label: 'Build for test', description: 'bnd build --test', cmd: '--test' },
            { label: 'Watch (continuous)', description: 'bnd build --watch', cmd: '--watch' },
        ],
        { title: 'Bnd: Build Project', placeHolder: 'Select build mode' },
    );
    if (!choice) { return; }
    runInTerminal(`build ${choice.cmd}`.trim());
}

/** bnd run [bndrun] */
async function cmdRun(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal('run');
        return;
    }
    const file = await pickBndrunFile('Bnd: Run', true);
    if (file === undefined) { return; }
    runInTerminal(file ? `run ${file}` : 'run');
}

/** bnd test */
async function cmdTest(): Promise<void> {
    runInTerminal('test');
}

/** bnd runtests [bndrun] */
async function cmdRunTests(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal('runtests');
        return;
    }
    const file = await pickBndrunFile('Bnd: Run OSGi Tests', true);
    if (file === undefined) { return; }
    runInTerminal(file ? `runtests ${file}` : 'runtests');
}

/** bnd resolve [bndrun...] */
async function cmdResolve(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal('resolve');
        return;
    }
    const items = files.map(f => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
        picked: false,
    }));
    const choices = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Resolve',
        placeHolder: 'Select .bndrun file(s) to resolve',
        canPickMany: true,
    });
    if (!choices) { return; }
    const paths = choices.map(c => c.label).join(' ');
    runInTerminal(paths ? `resolve ${paths}` : 'resolve');
}

/** bnd clean */
async function cmdClean(): Promise<void> {
    runInTerminal('clean');
}

/** bnd baseline */
async function cmdBaseline(): Promise<void> {
    runInTerminal('baseline');
}

/** bnd verify [jar...] */
async function cmdVerify(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/generated/*.jar', '**/node_modules/**');
    if (files.length === 0) {
        vscode.window.showInformationMessage('No JARs found. Run "bnd verify <path/to/jar>" manually.');
        return;
    }
    const items = files.map(f => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
        picked: false,
    }));
    const choices = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Verify JARs',
        placeHolder: 'Select JAR(s) to verify',
        canPickMany: true,
    });
    if (!choices) { return; }
    runInTerminal(`verify ${choices.map(c => c.label).join(' ')}`);
}

/** bnd print [jar] */
async function cmdPrint(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/generated/*.jar', '**/node_modules/**');
    const modeItems = [
        { label: 'Manifest', description: 'Show the bundle manifest (-m)', flag: '-m' },
        { label: 'Imports / Exports', description: 'Show imports and exports (-i)', flag: '-i' },
        { label: 'Resources', description: 'List all resources (-l)', flag: '-l' },
        { label: 'API usage', description: 'Show API usage (-a)', flag: '-a' },
        { label: 'Components', description: 'Show DS components (-C)', flag: '-C' },
        { label: 'Full', description: 'Print everything (-f)', flag: '-f' },
    ];

    const modeChoice = await vscode.window.showQuickPick(modeItems, {
        title: 'Bnd: Print Bundle — select view',
    });
    if (!modeChoice) { return; }

    if (files.length === 0) {
        const jarPath = await vscode.window.showInputBox({
            title: 'Bnd: Print Bundle',
            prompt: 'Path to JAR file',
            placeHolder: 'path/to/bundle.jar',
        });
        if (!jarPath) { return; }
        runInTerminal(`print ${modeChoice.flag} ${jarPath}`);
        return;
    }

    const jarItems = files.map(f => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
    }));
    const jarChoice = await vscode.window.showQuickPick(jarItems, {
        title: 'Bnd: Print Bundle — select JAR',
    });
    if (!jarChoice) { return; }
    runInTerminal(`print ${modeChoice.flag} ${jarChoice.label}`);
}

/** bnd diff [newer] [older] */
async function cmdDiff(): Promise<void> {
    const newerPath = await vscode.window.showInputBox({
        title: 'Bnd: Diff — newer JAR',
        prompt: 'Path to the NEWER JAR (leave blank for current project)',
        placeHolder: 'generated/bundle.jar',
    });
    if (newerPath === undefined) { return; }
    if (!newerPath) {
        runInTerminal('diff');
        return;
    }
    const olderPath = await vscode.window.showInputBox({
        title: 'Bnd: Diff — older / baseline JAR',
        prompt: 'Path to the OLDER baseline JAR',
        placeHolder: 'archive/bundle-1.0.0.jar',
    });
    if (!olderPath) { return; }
    runInTerminal(`diff ${newerPath} ${olderPath}`);
}

/** bnd wrap [jar] */
async function cmdWrap(): Promise<void> {
    const jarPath = await vscode.window.showInputBox({
        title: 'Bnd: Wrap JAR',
        prompt: 'Path to the plain JAR to wrap as an OSGi bundle',
        placeHolder: 'lib/library.jar',
    });
    if (!jarPath) { return; }
    runInTerminal(`wrap ${jarPath}`);
}

/** bnd export [bndrun] */
async function cmdExport(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        vscode.window.showInformationMessage('No .bndrun files found in workspace.');
        return;
    }
    const items = files.map(f => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
    }));
    const choice = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Export',
        placeHolder: 'Select a .bndrun file to export',
    });
    if (!choice) { return; }
    runInTerminal(`export ${choice.label}`);
}

/** bnd release */
async function cmdRelease(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        'Release this project to its configured repository?',
        { modal: true },
        'Release',
    );
    if (confirm !== 'Release') { return; }
    runInTerminal('release');
}

/** bnd properties */
async function cmdProperties(): Promise<void> {
    runInTerminal('properties');
}

/** bnd info */
async function cmdInfo(): Promise<void> {
    runInTerminal('info');
}

/** bnd version */
async function cmdVersion(): Promise<void> {
    runInTerminal('version');
}

/** bnd macro <expr> */
async function cmdMacro(): Promise<void> {
    const expr = await vscode.window.showInputBox({
        title: 'Bnd: Evaluate Macro',
        prompt: 'Enter a bnd macro expression to evaluate',
        placeHolder: '${version;===;1.2.3.qualifier}',
    });
    if (!expr) { return; }
    runInTerminal(`macro '${expr}'`);
}

/** bnd repo ... — interactive sub-command selection */
async function cmdRepo(): Promise<void> {
    const subItems = [
        { label: 'list', description: 'List all bundles in repos', cmd: 'list' },
        { label: 'get', description: 'Get bundle from repo', cmd: 'get' },
        { label: 'put', description: 'Put bundle into repo', cmd: 'put' },
        { label: 'info', description: 'Show repo info', cmd: 'info' },
    ];
    const choice = await vscode.window.showQuickPick(subItems, {
        title: 'Bnd: Repo — select sub-command',
    });
    if (!choice) { return; }
    runInTerminal(`repo ${choice.cmd}`);
}

async function cmdDownloadCli(context: vscode.ExtensionContext): Promise<void> {
    try {
        const { latest } = await fetchBndVersionMetadata();

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Downloading bnd ${latest}`,
                cancellable: false,
            },
            async progress => {
                progress.report({ message: 'Downloading JAR from configured Maven repository...' });
                const jarUri = await downloadBndJar(context, latest);
                progress.report({ message: 'Updating bnd.cli.executable...' });
                await configureDownloadedJar(jarUri);
                vscode.window.showInformationMessage(
                    `Configured bnd.cli.executable to use ${path.basename(jarUri.fsPath)} from ${path.dirname(jarUri.fsPath)}.`
                );
            },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to download bnd CLI JAR: ${message}`);
    }
}

async function cmdDownloadCliVersion(context: vscode.ExtensionContext): Promise<void> {
    try {
        const { latest, versions } = await fetchBndVersionMetadata();
        const version = await pickBndVersion(versions, latest);
        if (!version) { return; }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Downloading bnd ${version}`,
                cancellable: false,
            },
            async progress => {
                progress.report({ message: 'Downloading JAR from configured Maven repository...' });
                const jarUri = await downloadBndJar(context, version);
                progress.report({ message: 'Updating bnd.cli.executable...' });
                await configureDownloadedJar(jarUri);
                vscode.window.showInformationMessage(
                    `Configured bnd.cli.executable to use ${path.basename(jarUri.fsPath)} from ${path.dirname(jarUri.fsPath)}.`
                );
            },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to download bnd CLI JAR version: ${message}`);
    }
}

async function cmdSelectJavaRuntime(): Promise<void> {
    const runtimes = getConfiguredJavaRuntimes().filter(runtime => typeof runtime.path === 'string' && runtime.path.length > 0);

    if (runtimes.length === 0) {
        const action = await vscode.window.showWarningMessage(
            'No Java runtimes are configured in java.configuration.runtimes.',
            'Select Java Runtime...',
            'Discover from Folder...'
        );
        if (action === 'Select Java Runtime...') {
            await configureJavaRuntimeFromFolder();
        }
        if (action === 'Discover from Folder...') {
            await vscode.commands.executeCommand('bnd.cli.discoverJavaRuntimes');
        }
        return;
    }

    const items = runtimes.map(runtime => ({
        label: runtime.name || path.basename(runtime.path as string),
        description: runtime.path as string,
        detail: runtime.default ? 'Default Java runtime' : undefined,
        runtime,
    }));

    const selected = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Select Java Runtime',
        placeHolder: 'Select a configured Java runtime for bnd CLI',
    });
    if (!selected) {
        return;
    }

    const runtimeHome = selected.runtime.path as string;
    await configureJavaExecutable(javaBinaryPath(runtimeHome));
    vscode.window.showInformationMessage(`Configured bnd CLI Java runtime: ${javaBinaryPath(runtimeHome)}`);
}

async function cmdDiscoverJavaRuntimes(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Bnd: Select Root Folder to Discover Java Runtimes',
    });
    if (!picked || picked.length === 0) {
        return;
    }

    const rootFolder = picked[0].fsPath;
    const discovered = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Discovering Java runtimes',
            cancellable: false,
        },
        async () => findJavaRuntimeHomes(rootFolder),
    );

    if (discovered.length === 0) {
        vscode.window.showInformationMessage('No Java runtimes found in the selected root folder.');
        return;
    }

    const existing = getConfiguredJavaRuntimes();
    const existingPaths = new Set(
        existing
            .map(runtime => typeof runtime.path === 'string' ? normalizeFsPath(runtime.path) : '')
            .filter(Boolean)
    );

    const additions: JavaRuntimeEntry[] = [];
    for (const runtimeHome of discovered) {
        const normalized = normalizeFsPath(runtimeHome);
        if (existingPaths.has(normalized)) {
            continue;
        }
        additions.push({
            name: await readRuntimeDisplayName(runtimeHome),
            path: runtimeHome,
        });
        existingPaths.add(normalized);
    }

    if (additions.length === 0) {
        vscode.window.showInformationMessage('All discovered Java runtimes are already configured.');
        return;
    }

    await updateConfiguredJavaRuntimes([...existing, ...additions]);
    vscode.window.showInformationMessage(`Added ${additions.length} Java runtime(s) to java.configuration.runtimes.`);
}

// ─── CLI Reference Webview ─────────────────────────────────────────────────

function buildWebviewHtml(panel: vscode.WebviewPanel): string {
    const nonce = Math.random().toString(36).substring(2);

    const rows = BND_COMMANDS.map(cmd => {
        const opts = cmd.options.length > 0
            ? `<ul class="opts">${cmd.options.map(o =>
                `<li><code>${o.short} --${o.long}${o.arg ? ` &lt;${o.arg}&gt;` : ''}</code>${o.description ? ` — ${escHtml(o.description)}` : ''}</li>`
              ).join('')}</ul>`
            : '';
        const exs = cmd.examples.length > 0
            ? `<div class="examples"><strong>Examples:</strong>${cmd.examples.map(e =>
                `<pre>${escHtml(e)}</pre>`).join('')}</div>`
            : '';
        return `<details id="cmd-${escHtml(cmd.name)}">
  <summary><span class="cmd-name">${escHtml(cmd.name)}</span> <span class="cmd-summary">${escHtml(cmd.summary)}</span></summary>
  <div class="cmd-body">
    <p class="synopsis"><code>bnd ${escHtml(cmd.synopsis)}</code></p>
    ${opts}
    ${exs}
  </div>
</details>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bnd CLI Reference</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 8px 16px; }
  h1 { font-size: 1.3em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  #search { width: 100%; box-sizing: border-box; padding: 6px; margin-bottom: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-size: 1em; }
  details { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 4px 0; }
  details[open] { background: var(--vscode-editor-inactiveSelectionBackground); }
  summary { cursor: pointer; padding: 6px 8px; list-style: none; display: flex; align-items: baseline; gap: 10px; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '▶'; font-size: 0.7em; color: var(--vscode-descriptionForeground); }
  details[open] summary::before { content: '▼'; }
  .cmd-name { font-weight: bold; font-family: var(--vscode-editor-font-family); color: var(--vscode-textLink-foreground); }
  .cmd-summary { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .cmd-body { padding: 4px 16px 8px; }
  .synopsis { margin: 4px 0; }
  .opts { margin: 4px 0; padding-left: 20px; }
  .opts li { margin: 2px 0; font-size: 0.9em; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  pre { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 4px 0; font-size: 0.88em; white-space: pre-wrap; }
  .hidden { display: none !important; }
  #count { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 6px; }
</style>
</head>
<body>
<h1>Bnd CLI Reference</h1>
<input id="search" type="text" placeholder="Filter commands…" autocomplete="off" />
<div id="count"></div>
<div id="list">
${rows}
</div>
<script nonce="${nonce}">
  const search = document.getElementById('search');
  const countEl = document.getElementById('count');
  const items = Array.from(document.querySelectorAll('#list > details'));
  function filter() {
    const q = search.value.toLowerCase().trim();
    let visible = 0;
    items.forEach(el => {
      const text = el.textContent.toLowerCase();
      const show = !q || text.includes(q);
      el.classList.toggle('hidden', !show);
      if (show) { visible++; }
    });
    countEl.textContent = q ? visible + ' of ' + items.length + ' commands' : items.length + ' commands';
  }
  search.addEventListener('input', filter);
  filter();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let referencePanel: vscode.WebviewPanel | undefined;

function cmdShowReference(): void {
    if (referencePanel) {
        referencePanel.reveal();
        return;
    }
    referencePanel = vscode.window.createWebviewPanel(
        'bndCliReference',
        'Bnd CLI Reference',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
    );
    referencePanel.webview.html = buildWebviewHtml(referencePanel);
    referencePanel.onDidDispose(() => { referencePanel = undefined; });
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** Register all bnd CLI VS Code commands. */
export function registerCliCommands(context: vscode.ExtensionContext): void {
    const register = (id: string, handler: () => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));

    register('bnd.cli.build',         cmdBuild);
    register('bnd.cli.run',           cmdRun);
    register('bnd.cli.test',          cmdTest);
    register('bnd.cli.runtests',      cmdRunTests);
    register('bnd.cli.resolve',       cmdResolve);
    register('bnd.cli.clean',         cmdClean);
    register('bnd.cli.baseline',      cmdBaseline);
    register('bnd.cli.verify',        cmdVerify);
    register('bnd.cli.print',         cmdPrint);
    register('bnd.cli.diff',          cmdDiff);
    register('bnd.cli.wrap',          cmdWrap);
    register('bnd.cli.export',        cmdExport);
    register('bnd.cli.release',       cmdRelease);
    register('bnd.cli.properties',    cmdProperties);
    register('bnd.cli.info',          cmdInfo);
    register('bnd.cli.version',       cmdVersion);
    register('bnd.cli.macro',         cmdMacro);
    register('bnd.cli.repo',          cmdRepo);
    register('bnd.cli.downloadCli',   () => cmdDownloadCli(context));
    register('bnd.cli.downloadCliVersion', () => cmdDownloadCliVersion(context));
    register('bnd.cli.selectJavaRuntime', cmdSelectJavaRuntime);
    register('bnd.cli.discoverJavaRuntimes', cmdDiscoverJavaRuntimes);
    register('bnd.cli.showReference', cmdShowReference);
}
