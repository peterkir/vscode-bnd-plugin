import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    BND_LSP_ARTIFACT,
    LibraryKind,
    LibrarySelection,
    TRACK_LATEST,
    customSelection,
    downloadLibrary,
    fetchReleaseMetadata,
    fetchSnapshotVersions,
    pickReleaseVersion,
    pickSnapshotVersion,
    releaseSelection,
    snapshotSelection,
    validateCustomJarUrl,
} from './bndLibrary';
import { normalizePath, outputChannel } from './extension';

export type ServerJarSource = 'bundled' | 'release' | 'snapshot' | 'url';

export interface ServerJarSettings {
    source: ServerJarSource;
    version: string;
    url: string;
    sha256: string;
}

export interface ResolvedServerJar {
    path: string;
    /** Human-readable origin for the output channel. */
    origin: string;
    /** A local build output (`bnd.server.jar`) that must be launched from a copy. */
    isLocalBuild: boolean;
    /** Remote source to download or refresh in the background. */
    pending?: ServerJarSettings;
}

type ConfigReader = Pick<vscode.WorkspaceConfiguration, 'get'>;
type StorageContext = Pick<vscode.ExtensionContext, 'globalStorageUri' | 'asAbsolutePath'>;

const KEEP_CACHED_JARS = 3;
const SELECT_TITLE = 'Bnd: Select Language Server JAR';
const inflight = new Map<string, Promise<string>>();

function log(message: string): void {
    outputChannel?.appendLine(`[server jar] ${message}`);
}

export function bundledServerJarPath(context: StorageContext): string {
    return context.asAbsolutePath(path.join('server', 'biz.aQute.bnd.lsp.jar'));
}

export function readServerJarSettings(config: ConfigReader): ServerJarSettings {
    return {
        source: config.get<ServerJarSource>('server.jarSource', 'bundled') ?? 'bundled',
        version: (config.get<string>('server.jarVersion', TRACK_LATEST) ?? '').trim() || TRACK_LATEST,
        url: (config.get<string>('server.jarUrl', '') ?? '').trim(),
        sha256: (config.get<string>('server.jarSha256', '') ?? '').trim(),
    };
}

function kindOf(source: Exclude<ServerJarSource, 'bundled'>): LibraryKind {
    return source === 'url' ? 'custom' : source;
}

/** Cache folder per URL, so a changed URL with the same file name never reuses a stale JAR. */
export function customUrlVersion(url: string): string {
    const base = customSelection(url, BND_LSP_ARTIFACT).version;
    return `${base}-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 8)}`;
}

function cacheRoot(context: StorageContext, kind: LibraryKind): string {
    return path.join(context.globalStorageUri.fsPath, 'library', BND_LSP_ARTIFACT.storage, kind);
}

function cachedJars(context: StorageContext, kind: LibraryKind, version?: string): { file: string; mtime: number }[] {
    const root = cacheRoot(context, kind);
    let dirs: string[];
    try {
        dirs = version
            ? [path.join(root, version)]
            : fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(root, e.name));
    } catch {
        return [];
    }
    const jars: { file: string; mtime: number }[] = [];
    for (const dir of dirs) {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            continue;
        }
        for (const entry of entries.filter(name => name.endsWith('.jar'))) {
            const file = path.join(dir, entry);
            jars.push({ file, mtime: fs.statSync(file).mtimeMs });
        }
    }
    return jars.sort((a, b) => b.mtime - a.mtime);
}

/** Newest downloaded JAR matching the settings, without any network access. */
export function findCachedServerJar(context: StorageContext, settings: ServerJarSettings): string | undefined {
    if (settings.source === 'bundled') {
        return undefined;
    }
    if (settings.source === 'url') {
        if (validateCustomJarUrl(settings.url)) {
            return undefined;
        }
        return cachedJars(context, 'custom', customUrlVersion(settings.url))[0]?.file;
    }
    const version = settings.version === TRACK_LATEST ? undefined : settings.version;
    return cachedJars(context, kindOf(settings.source), version)[0]?.file;
}

/**
 * Picks the JAR to launch now: `bnd.server.jar`, then a cached download for `bnd.server.jarSource`,
 * then the bundled JAR. Never touches the network.
 */
export function resolveServerJar(
    context: StorageContext,
    config: ConfigReader,
    warn: (message: string) => void,
): ResolvedServerJar {
    const configured = (config.get<string>('server.jar', '') ?? '').trim();
    if (configured) {
        const jarPath = normalizePath(configured);
        if (fs.existsSync(jarPath)) {
            return { path: jarPath, origin: `bnd.server.jar (${jarPath})`, isLocalBuild: true };
        }
        warn(`bnd.server.jar points to a missing file: ${jarPath}. Using bnd.server.jarSource instead.`);
    }

    const bundled = bundledServerJarPath(context);
    const settings = readServerJarSettings(config);
    if (settings.source === 'bundled') {
        return { path: bundled, origin: 'bundled', isLocalBuild: false };
    }
    if (settings.source === 'url') {
        const invalid = validateCustomJarUrl(settings.url);
        if (invalid) {
            warn(`bnd.server.jarUrl is invalid (${invalid}). Using the bundled language server JAR.`);
            return { path: bundled, origin: 'bundled (invalid bnd.server.jarUrl)', isLocalBuild: false };
        }
    }

    const cached = findCachedServerJar(context, settings);
    if (cached) {
        return { path: cached, origin: `${settings.source} (${path.basename(cached)})`, isLocalBuild: false, pending: settings };
    }
    return {
        path: bundled,
        origin: `bundled (${settings.source} JAR not downloaded yet)`,
        isLocalBuild: false,
        pending: settings,
    };
}

async function remoteSelection(settings: ServerJarSettings): Promise<LibrarySelection> {
    if (settings.source === 'release') {
        const version = settings.version === TRACK_LATEST
            ? (await fetchReleaseMetadata(BND_LSP_ARTIFACT)).latest
            : settings.version;
        const selection = releaseSelection(version, BND_LSP_ARTIFACT);
        return { ...selection, sha1Url: `${selection.url}.sha1` };
    }
    if (settings.source === 'snapshot') {
        let version = settings.version;
        if (version === TRACK_LATEST) {
            const versions = await fetchSnapshotVersions(BND_LSP_ARTIFACT);
            version = versions[versions.length - 1];
            if (!version) {
                throw new Error(`No ${BND_LSP_ARTIFACT.artifactId} snapshot versions found.`);
            }
        }
        const selection = await snapshotSelection(version, BND_LSP_ARTIFACT);
        return { ...selection, sha1Url: `${selection.url}.sha1` };
    }
    if (settings.source === 'url') {
        const invalid = validateCustomJarUrl(settings.url);
        if (invalid) {
            throw new Error(`Invalid bnd.server.jarUrl: ${invalid}`);
        }
        return {
            ...customSelection(settings.url, BND_LSP_ARTIFACT),
            version: customUrlVersion(settings.url),
            sha256: settings.sha256 || undefined,
        };
    }
    throw new Error('The bundled language server JAR needs no download.');
}

function pruneCachedJars(context: StorageContext, kind: LibraryKind, keep: string): void {
    for (const { file } of cachedJars(context, kind).slice(KEEP_CACHED_JARS)) {
        if (file !== keep) {
            // A JAR still used by another window is locked on Windows; a later start retries.
            fs.rm(file, { force: true }, () => undefined);
        }
    }
}

/** Downloads (or finds in the cache) the JAR described by the settings and returns its path. */
export function downloadServerJar(context: vscode.ExtensionContext, settings: ServerJarSettings): Promise<string> {
    const key = JSON.stringify(settings);
    const running = inflight.get(key);
    if (running) {
        return running;
    }
    const task = (async () => {
        const selection = await remoteSelection(settings);
        const jar = (await downloadLibrary(context, selection)).fsPath;
        pruneCachedJars(context, selection.kind, jar);
        log(`${settings.source} JAR available at ${jar}`);
        return jar;
    })().finally(() => inflight.delete(key));
    inflight.set(key, task);
    return task;
}

/** Background refresh after start; offers a restart when a different JAR became available. */
export async function refreshServerJar(
    context: vscode.ExtensionContext,
    settings: ServerJarSettings,
    launchedJar: string,
): Promise<void> {
    try {
        const jar = await downloadServerJar(context, settings);
        if (path.resolve(jar) === path.resolve(launchedJar)) {
            return;
        }
        const action = await vscode.window.showInformationMessage(
            `bnd Language Server JAR ${path.basename(jar)} is ready.`,
            'Restart Language Server',
        );
        if (action) {
            await vscode.commands.executeCommand('bnd.server.restart');
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Could not provide the ${settings.source} language server JAR: ${message}`);
        void vscode.window.showWarningMessage(
            `bnd Language Server JAR (${settings.source}) unavailable: ${message}`,
            'Select Language Server JAR',
        ).then(action => {
            if (action) {
                void vscode.commands.executeCommand('bnd.server.selectJar');
            }
        });
    }
}

// ─── Command ──────────────────────────────────────────────────────────────────

async function promptSettings(): Promise<ServerJarSettings | 'local' | undefined> {
    const choice = await vscode.window.showQuickPick(
        [
            { label: 'Bundled', description: 'JAR shipped with the extension', source: 'bundled' as const },
            { label: 'Release', description: 'Maven Central', source: 'release' as const },
            { label: 'Snapshot', description: 'bndtools Artifactory', source: 'snapshot' as const },
            { label: 'Custom URL...', description: 'Download a JAR from an https URL', source: 'url' as const },
            { label: 'Local file...', description: 'Use a locally built JAR (bnd.server.jar)', source: 'local' as const },
        ],
        { title: SELECT_TITLE, placeHolder: 'Select the source of the bnd Language Server JAR' },
    );
    if (!choice) { return undefined; }
    const empty: ServerJarSettings = { source: 'bundled', version: TRACK_LATEST, url: '', sha256: '' };

    switch (choice.source) {
        case 'local':
            return 'local';
        case 'bundled':
            return empty;
        case 'release':
        case 'snapshot': {
            const options = { artifact: BND_LSP_ARTIFACT, title: SELECT_TITLE, offerTrackLatest: true };
            const version = choice.source === 'release'
                ? await pickReleaseVersion(options)
                : await pickSnapshotVersion(options);
            return version ? { ...empty, source: choice.source, version: version.trim() } : undefined;
        }
        case 'url': {
            const url = await vscode.window.showInputBox({
                title: `${SELECT_TITLE} — custom URL`,
                prompt: `https URL of a ${BND_LSP_ARTIFACT.artifactId} JAR`,
                placeHolder: `https://example.org/${BND_LSP_ARTIFACT.artifactId}-7.5.0.jar`,
                validateInput: validateCustomJarUrl,
            });
            if (!url) { return undefined; }
            const sha256 = await vscode.window.showInputBox({
                title: `${SELECT_TITLE} — SHA-256`,
                prompt: 'Optional SHA-256 of the JAR. Leave empty to skip the integrity check.',
                validateInput: value => (!value.trim() || /^[0-9a-f]{64}$/i.test(value.trim())
                    ? undefined
                    : 'Enter 64 hexadecimal characters or leave empty.'),
            });
            if (sha256 === undefined) { return undefined; }
            return { ...empty, source: 'url', url: url.trim(), sha256: sha256.trim().toLowerCase() };
        }
    }
}

async function writeSettings(settings: ServerJarSettings): Promise<void> {
    const config = vscode.workspace.getConfiguration('bnd');
    const global = vscode.ConfigurationTarget.Global;
    await config.update('server.jar', undefined, global);
    await config.update('server.jarSource', settings.source === 'bundled' ? undefined : settings.source, global);
    await config.update('server.jarVersion', settings.version === TRACK_LATEST ? undefined : settings.version, global);
    await config.update('server.jarUrl', settings.url || undefined, global);
    await config.update('server.jarSha256', settings.sha256 || undefined, global);
}

function warnWorkspaceOverride(): void {
    const inspected = vscode.workspace.getConfiguration('bnd').inspect<string>('server.jar');
    const override = inspected?.workspaceFolderValue ?? inspected?.workspaceValue;
    if (override) {
        void vscode.window.showWarningMessage(
            `The workspace setting bnd.server.jar (${override}) takes precedence over this selection.`,
        );
    }
}

export async function cmdSelectServerJar(context: vscode.ExtensionContext): Promise<void> {
    try {
        const settings = await promptSettings();
        if (!settings) { return; }

        if (settings === 'local') {
            const picked = await vscode.window.showOpenDialog({
                title: SELECT_TITLE,
                canSelectMany: false,
                filters: { 'JAR files': ['jar'] },
            });
            if (!picked?.[0]) { return; }
            await vscode.workspace.getConfiguration('bnd')
                .update('server.jar', picked[0].fsPath, vscode.ConfigurationTarget.Global);
            warnWorkspaceOverride();
            return;
        }

        if (settings.source !== 'bundled') {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Downloading bnd Language Server (${settings.source})` },
                () => downloadServerJar(context, settings),
            );
        }
        await writeSettings(settings);
        warnWorkspaceOverride();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to select the bnd Language Server JAR: ${message}`);
    }
}
