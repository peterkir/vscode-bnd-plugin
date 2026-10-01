import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { BND_COMMANDS } from './bndCommandData';
import { cmdConfigureLibrary } from './bndLibrary';
import { inspectJavaExecutable, normalizePath, outputChannel } from './extension';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Returns the configured bnd executable (e.g. "bnd" or "java -jar /path/to/biz.aQute.bnd.jar"). */
function bndExec(): string {
    const cfg = vscode.workspace.getConfiguration('bnd');
    return expandEnvironmentPlaceholders(cfg.get<string>('cli.executable', 'bnd'));
}

export function bndJavaExecutable(): string {
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

function convertWindowsPathsToBash(text: string): string {
    return text.replace(/(["']?)([A-Za-z]):[\\/]([^"'\n\r]+)(["']?)/g, (_match, q1, drive, rest, q2) => {
        const bashPath = `/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
        return `${q1}${bashPath}${q2}`;
    });
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
        const bashRemainder = convertWindowsPathsToBash(remainder);
        return `${quoteForBash(bashExecutable)}${bashRemainder}`;
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

async function validateBndExecutable(): Promise<boolean> {
    const exec = bndExec();
    const jarMatch = exec.match(/-jar\s+["']?([^"']+\.jar)["']?/i);
    if (jarMatch) {
        let rawPath = jarMatch[1].trim();
        if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(rawPath)) {
            rawPath = `${rawPath.charAt(1).toUpperCase()}:${rawPath.slice(2)}`;
        }
        try {
            await fs.access(rawPath);
        } catch {
            const action = await vscode.window.showErrorMessage(
                `bnd CLI JAR not found at "${jarMatch[1]}".`,
                'Configure bnd Library...',
                'Open Settings'
            );
            if (action === 'Configure bnd Library...') {
                await vscode.commands.executeCommand('bnd.cli.configureLib');
            } else if (action === 'Open Settings') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'bnd.cli.executable');
            }
            return false;
        }
    }
    return true;
}

/**
 * Extracts a major version number from an execution environment string.
 * Examples: "JavaSE-17" -> 17, "JavaSE-1.8" -> 8, "JavaSE-21" -> 21, "JavaSE-8" -> 8, "11" -> 11.
 */
export function parseRuneeMajorVersion(runee: string): number | undefined {
    const trimmed = runee.trim().replace(/^['"]|['"]$/g, '');
    const match = trimmed.match(/(?:javase(?:\/compact\d+)?-)?(?:1\.)?(\d+)/i);
    if (!match) {
        return undefined;
    }
    const val = parseInt(match[1], 10);
    return isNaN(val) ? undefined : val;
}

/**
 * Finds the bnd workspace root directory (containing cnf/) by traversing parent directories.
 */
export async function findBndWorkspaceRoot(startPath: string): Promise<string> {
    try {
        let currentDir = (await fs.stat(startPath).catch(() => undefined))?.isDirectory()
            ? startPath
            : path.dirname(startPath);

        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const cnfPath = path.join(currentDir, 'cnf');
            try {
                const stat = await fs.stat(cnfPath);
                if (stat.isDirectory()) {
                    return currentDir;
                }
            } catch {
                // Continue walking up
            }
            currentDir = path.dirname(currentDir);
        }
    } catch {
        // Ignore errors
    }

    return workspaceRoot() || path.dirname(startPath);
}

function expandIncludeMacros(includeItem: string, wsRoot: string, projectDir: string): string {
    let expanded = includeItem.trim();
    expanded = expanded.replace(/\$\{(?:workspace|workspaceURI)\}/gi, wsRoot);
    expanded = expanded.replace(/\$\{(?:project|projectURI|\.|dir)\}/gi, projectDir);
    expanded = expanded.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/gi, (_f, name) => process.env[name] || '');
    return expanded;
}

/**
 * Parses a .bndrun or .bnd file for its -runee instruction, resolving recursive -include directives.
 */
export async function parseRuneeFromFile(
    filePath: string,
    wsRoot?: string,
    visited = new Set<string>()
): Promise<string | undefined> {
    const normalized = path.normalize(filePath);
    const key = normalized.toLowerCase();
    if (visited.has(key)) {
        return undefined;
    }
    visited.add(key);

    let content: string;
    try {
        content = await fs.readFile(normalized, 'utf8');
    } catch {
        return undefined;
    }

    if (!wsRoot) {
        wsRoot = await findBndWorkspaceRoot(normalized);
    }
    const fileDir = path.dirname(normalized);

    const rawLines = content.split(/\r?\n/);
    const logicalLines: string[] = [];
    let currentLine = '';

    for (const raw of rawLines) {
        const trimmed = raw.trim();
        if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('!')) {
            if (currentLine) {
                logicalLines.push(currentLine);
                currentLine = '';
            }
            continue;
        }

        if (raw.endsWith('\\')) {
            currentLine += raw.slice(0, -1) + ' ';
        } else {
            currentLine += raw;
            logicalLines.push(currentLine);
            currentLine = '';
        }
    }
    if (currentLine) {
        logicalLines.push(currentLine);
    }

    let directRunee: string | undefined;
    const includePaths: string[] = [];

    for (const line of logicalLines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        const runeeMatch = trimmed.match(/^-\s*runee(?:\.[a-zA-Z0-9_-]+)?\s*(?::=|=|:)\s*([^\r\n#]+)/i);
        if (runeeMatch && !directRunee) {
            let val = runeeMatch[1].trim();
            val = val.replace(/^['"]|['"]$/g, '').trim();
            val = val.split(/\s*#/)[0].trim();
            if (val) {
                directRunee = val;
            }
        }

        const incMatch = trimmed.match(/^-\s*include(?:\.[a-zA-Z0-9_-]+)?\s*(?::=|=|:)\s*([^\r\n#]+)/i);
        if (incMatch) {
            const rawInc = incMatch[1].trim();
            const parts = rawInc.split(',');
            for (const part of parts) {
                let cleanPart = part.trim();
                cleanPart = cleanPart.replace(/^[-~]+/, '').trim();
                cleanPart = cleanPart.replace(/^['"]|['"]$/g, '').trim();
                cleanPart = cleanPart.split(/\s*#/)[0].trim();
                if (!cleanPart) {
                    continue;
                }
                const expanded = expandIncludeMacros(cleanPart, wsRoot, fileDir);
                const resolved = path.isAbsolute(expanded)
                    ? path.normalize(expanded)
                    : path.resolve(fileDir, expanded);
                includePaths.push(resolved);
            }
        }
    }

    if (directRunee) {
        return directRunee;
    }

    for (const inc of includePaths) {
        const incRunee = await parseRuneeFromFile(inc, wsRoot, visited);
        if (incRunee) {
            return incRunee;
        }
    }

    return undefined;
}

async function isJavaHomeValid(home: string): Promise<boolean> {
    const javaExec = javaBinaryPath(home);
    try {
        await fs.access(javaExec);
        return true;
    } catch {
        return false;
    }
}

async function getJavaMajorVersionFromHome(home: string): Promise<number | undefined> {
    try {
        const releasePath = path.join(home, 'release');
        const content = await fs.readFile(releasePath, 'utf8');
        const versionMatch = content.match(/^JAVA_VERSION="([^"]+)"/m);
        if (versionMatch) {
            const raw = versionMatch[1];
            let major = parseInt(raw.split('.')[0], 10);
            if (major === 1) {
                const parts = raw.split('.');
                major = parts.length > 1 ? parseInt(parts[1], 10) : 1;
            }
            if (!isNaN(major)) {
                return major;
            }
        }
    } catch {
        // Fallback to executable inspection
    }

    const exec = javaBinaryPath(home);
    const info = inspectJavaExecutable(exec);
    return info.valid ? info.major : undefined;
}

/**
 * Searches configured Java runtimes and the system environment for a Java runtime
 * matching the requested -runee execution environment.
 */
export async function findJavaRuntimeHomeForRunee(runee: string): Promise<{ home: string; major: number } | undefined> {
    const targetMajor = parseRuneeMajorVersion(runee);
    if (!targetMajor) {
        return undefined;
    }

    // 1. Check java.configuration.runtimes
    const runtimes = getConfiguredJavaRuntimes()
        .filter((runtime): runtime is JavaRuntimeEntry & { path: string } => typeof runtime.path === 'string' && runtime.path.length > 0);

    for (const entry of runtimes) {
        if (entry.name && parseRuneeMajorVersion(entry.name) === targetMajor) {
            if (await isJavaHomeValid(entry.path)) {
                return { home: entry.path, major: targetMajor };
            }
        }
    }

    for (const entry of runtimes) {
        const major = await getJavaMajorVersionFromHome(entry.path);
        if (major === targetMajor && (await isJavaHomeValid(entry.path))) {
            return { home: entry.path, major: targetMajor };
        }
    }

    // 2. Check bnd.cli.javaExecutable / configuredExecutableHome
    const cliExec = bndJavaExecutable();
    const cliHome = getJavaHomeFromExecutable(cliExec);
    if (cliHome) {
        const major = await getJavaMajorVersionFromHome(cliHome);
        if (major === targetMajor && (await isJavaHomeValid(cliHome))) {
            return { home: cliHome, major: targetMajor };
        }
    }

    // 3. Check JAVA_HOME environment variable
    const envJavaHome = process.env['JAVA_HOME'];
    if (envJavaHome) {
        const normalizedHome = normalizePath(envJavaHome);
        const major = await getJavaMajorVersionFromHome(normalizedHome);
        if (major === targetMajor && (await isJavaHomeValid(normalizedHome))) {
            return { home: normalizedHome, major: targetMajor };
        }
    }

    // 4. Check default PATH java
    const info = inspectJavaExecutable('java');
    if (info.valid && info.major === targetMajor) {
        const pathHome = getJavaHomeFromExecutable(info.executablePath);
        if (pathHome && (await isJavaHomeValid(pathHome))) {
            return { home: pathHome, major: targetMajor };
        }
    }

    // 5. Try discovering from parent directory of known Java runtimes
    const candidateRoots = new Set<string>();
    if (envJavaHome) {
        candidateRoots.add(path.dirname(normalizePath(envJavaHome)));
    }
    for (const entry of runtimes) {
        candidateRoots.add(path.dirname(normalizePath(entry.path)));
    }
    for (const root of candidateRoots) {
        try {
            const discovered = await findJavaRuntimeHomes(root);
            for (const home of discovered) {
                const major = await getJavaMajorVersionFromHome(home);
                if (major === targetMajor && (await isJavaHomeValid(home))) {
                    return { home, major: targetMajor };
                }
            }
        } catch {
            // Ignore discovery failures
        }
    }

    return undefined;
}

function extractTargetFileFromArgs(args: string): string | undefined {
    // Look for arguments ending with .bndrun or .bnd (e.g. "run foo.bndrun" or "resolve file.bndrun")
    const match = args.match(/(?:^|\s)["']?([^"'\r\n\t\s]+\.(?:bndrun|bnd))["']?(?:\s|$)/i);
    if (match) {
        return match[1].trim();
    }
    return activeRunFile();
}

function runInTerminal(args: string): void {
    void runInTerminalInternal(args);
}

async function runInTerminalInternal(args: string): Promise<void> {
    const valid = await validateBndExecutable();
    if (!valid) {
        return;
    }

    let javaHome: string | undefined;
    let effectiveBndExec = bndExec();

    const targetFile = extractTargetFileFromArgs(args);
    let runeeInfo = 'none';

    if (targetFile) {
        const wsRoot = workspaceRoot() || process.cwd();
        const absTarget = path.isAbsolute(targetFile) ? targetFile : path.resolve(wsRoot, targetFile);
        const runee = await parseRuneeFromFile(absTarget);
        if (runee) {
            runeeInfo = runee;
            const matchedRuntime = await findJavaRuntimeHomeForRunee(runee);
            if (matchedRuntime) {
                javaHome = matchedRuntime.home;
                const javaExec = javaBinaryPath(matchedRuntime.home);
                effectiveBndExec = replaceJavaExecutable(effectiveBndExec, javaExec);
                vscode.window.setStatusBarMessage(`bnd: using Java ${matchedRuntime.major} (${runee})`, 4000);
            } else {
                const requiredMajor = parseRuneeMajorVersion(runee);
                void vscode.window.showWarningMessage(
                    `File requires ${runee} (Java ${requiredMajor ?? '?'}), but no matching Java runtime (Java >= ${requiredMajor ?? '?'}) was found in settings. Using default runtime.`
                );
            }
        }
    }

    if (!javaHome) {
        javaHome = await ensureJavaRuntimeConfigured();
    }

    if (!javaHome) {
        return;
    }

    const command = commandForActiveShell(`${effectiveBndExec} ${args}`);

    if (outputChannel) {
        outputChannel.appendLine(`[CLI Execution] Command: bnd ${args}`);
        outputChannel.appendLine(`  - Target file: ${targetFile ?? 'none'}`);
        outputChannel.appendLine(`  - Detected -runee: ${runeeInfo}`);
        outputChannel.appendLine(`  - Selected JAVA_HOME: ${javaHome}`);
        outputChannel.appendLine(`  - Raw Executable: ${effectiveBndExec}`);
        outputChannel.appendLine(`  - Terminal Command: ${command}`);
    }

    const wsRoot = workspaceRoot();
    const term = createBndTerminal(buildTerminalEnvironment(javaHome), wsRoot);
    term.show(true);
    term.sendText(command);
}

export function quoteForCommand(commandPart: string): string {
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

// ─── Active-editor helper ─────────────────────────────────────────────────────

/**
 * If an explicit URI or the currently active editor is a `.bndrun` file, returns its
 * workspace-relative path so it can be passed directly to the CLI.
 * Returns `undefined` when no `.bndrun` file is active.
 */
export function activeBndrunFile(uri?: vscode.Uri): string | undefined {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri || targetUri.scheme !== 'file') { return undefined; }
    if (!targetUri.fsPath.endsWith('.bndrun')) { return undefined; }
    return vscode.workspace.asRelativePath(targetUri);
}

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

// ─── CLI Argument Builders ────────────────────────────────────────────────────

/** Single source of truth for the argument strings passed to the bnd JAR. */
export const cliArgs = {
    build: (mode: '' | '--test' | '--watch' = '') => `build ${mode}`.trim(),
    run: (bndrun?: string) => (bndrun ? `run ${bndrun}` : 'run'),
    test: () => 'test',
    runtests: (bndrun?: string) => (bndrun ? `runtests ${bndrun}` : 'runtests'),
    // `resolve` is a command group; the `resolve` sub-command does the work, `-W` writes -runbundles back
    resolve: (bndruns?: string) => (bndruns ? `resolve resolve -W ${bndruns}` : 'resolve resolve -W'),
    clean: () => 'clean',
    baseline: () => 'baseline',
    verify: (jars: string) => `verify ${jars}`,
    print: (flag: string, jar: string) => `print ${flag} ${jar}`,
    diff: (newer?: string, older?: string) => (newer && older ? `diff ${newer} ${older}` : 'diff'),
    wrap: (jar: string) => `wrap ${jar}`,
    export: (bndrun: string) => `export ${bndrun}`,
    release: () => 'release',
    properties: () => 'properties',
    info: () => 'info',
    version: () => 'version',
    macro: (expression: string) => `macro '${expression}'`,
    repo: (subCommand: string) => `repo ${subCommand}`,
} as const;

// ─── Individual Command Handlers ──────────────────────────────────────────────

/** bnd build [-t] [-w] */
async function cmdBuild(): Promise<void> {
    const choice = await vscode.window.showQuickPick(
        [
            { label: 'Build', description: 'bnd build', cmd: '' as const },
            { label: 'Build for test', description: 'bnd build --test', cmd: '--test' as const },
            { label: 'Watch (continuous)', description: 'bnd build --watch', cmd: '--watch' as const },
        ],
        { title: 'Bnd: Build Project', placeHolder: 'Select build mode' },
    );
    if (!choice) { return; }
    runInTerminal(cliArgs.build(choice.cmd));
}

/** bnd run [bndrun] */
async function cmdRun(uri?: vscode.Uri): Promise<void> {
    const active = activeBndrunFile(uri);
    if (active) {
        runInTerminal(cliArgs.run(active));
        return;
    }

    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal(cliArgs.run());
        return;
    }
    const file = await pickBndrunFile('Bnd: Run', true);
    if (file === undefined) { return; }
    runInTerminal(cliArgs.run(file || undefined));
}

/** bnd test */
async function cmdTest(): Promise<void> {
    runInTerminal(cliArgs.test());
}

/** bnd runtests [bndrun] */
async function cmdRunTests(uri?: vscode.Uri): Promise<void> {
    const active = activeBndrunFile(uri);
    if (active) {
        runInTerminal(cliArgs.runtests(active));
        return;
    }

    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal(cliArgs.runtests());
        return;
    }
    const file = await pickBndrunFile('Bnd: Run OSGi Tests', true);
    if (file === undefined) { return; }
    runInTerminal(cliArgs.runtests(file || undefined));
}

/** bnd resolve resolve -W [bndrun...] */
async function cmdResolve(uri?: vscode.Uri): Promise<void> {
    const active = activeBndrunFile(uri);
    if (active) {
        runInTerminal(cliArgs.resolve(active));
        return;
    }

    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal(cliArgs.resolve());
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
    runInTerminal(cliArgs.resolve(paths || undefined));
}

/** bnd clean */
async function cmdClean(): Promise<void> {
    runInTerminal(cliArgs.clean());
}

/** bnd baseline */
async function cmdBaseline(): Promise<void> {
    runInTerminal(cliArgs.baseline());
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
    runInTerminal(cliArgs.verify(choices.map(c => c.label).join(' ')));
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
        runInTerminal(cliArgs.print(modeChoice.flag, jarPath));
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
    runInTerminal(cliArgs.print(modeChoice.flag, jarChoice.label));
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
        runInTerminal(cliArgs.diff());
        return;
    }
    const olderPath = await vscode.window.showInputBox({
        title: 'Bnd: Diff — older / baseline JAR',
        prompt: 'Path to the OLDER baseline JAR',
        placeHolder: 'archive/bundle-1.0.0.jar',
    });
    if (!olderPath) { return; }
    runInTerminal(cliArgs.diff(newerPath, olderPath));
}

/** bnd wrap [jar] */
async function cmdWrap(): Promise<void> {
    const jarPath = await vscode.window.showInputBox({
        title: 'Bnd: Wrap JAR',
        prompt: 'Path to the plain JAR to wrap as an OSGi bundle',
        placeHolder: 'lib/library.jar',
    });
    if (!jarPath) { return; }
    runInTerminal(cliArgs.wrap(jarPath));
}

/** bnd export [bndrun] */
async function cmdExport(uri?: vscode.Uri): Promise<void> {
    const active = activeBndrunFile(uri);
    if (active) {
        runInTerminal(cliArgs.export(active));
        return;
    }

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
    runInTerminal(cliArgs.export(choice.label));
}

/** bnd release */
async function cmdRelease(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        'Release this project to its configured repository?',
        { modal: true },
        'Release',
    );
    if (confirm !== 'Release') { return; }
    runInTerminal(cliArgs.release());
}

/** bnd properties */
async function cmdProperties(): Promise<void> {
    runInTerminal(cliArgs.properties());
}

/** bnd info */
async function cmdInfo(): Promise<void> {
    runInTerminal(cliArgs.info());
}

/** bnd version */
async function cmdVersion(): Promise<void> {
    runInTerminal(cliArgs.version());
}

/** bnd macro <expr> */
async function cmdMacro(): Promise<void> {
    const expr = await vscode.window.showInputBox({
        title: 'Bnd: Evaluate Macro',
        prompt: 'Enter a bnd macro expression to evaluate',
        placeHolder: '${version;===;1.2.3.qualifier}',
    });
    if (!expr) { return; }
    runInTerminal(cliArgs.macro(expr));
}

/** bnd repo ... — interactive sub-command selection */
async function cmdRepo(): Promise<void> {
    const subItems = [
        { label: 'list', description: 'List all bundles in repos', cmd: 'list' },
        { label: 'get', description: 'Get bundle from repo', cmd: 'get' },
        { label: 'put', description: 'Put bundle into repo', cmd: 'put' },
        { label: 'repos', description: 'List the configured repositories', cmd: 'repos' },
    ];
    const choice = await vscode.window.showQuickPick(subItems, {
        title: 'Bnd: Repo — select sub-command',
    });
    if (!choice) { return; }
    runInTerminal(cliArgs.repo(choice.cmd));
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
    const register = (id: string, handler: (...args: any[]) => unknown) =>
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
    register('bnd.cli.configureLib',  () => cmdConfigureLibrary(context));
    register('bnd.cli.selectJavaRuntime', cmdSelectJavaRuntime);
    register('bnd.cli.discoverJavaRuntimes', cmdDiscoverJavaRuntimes);
    register('bnd.cli.showReference', cmdShowReference);
}
