import * as path from 'path';
import * as vscode from 'vscode';
import { httpGet, httpGetText } from './bndHttp';
import { bndJavaExecutable, quoteForCommand } from './bndCliCommands';
import { outputChannel } from './extension';

const BND_GROUP_PATH = 'biz/aQute/bnd';
const BND_ARTIFACT_ID = 'biz.aQute.bnd';
const JAR_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const MAX_JAR_BYTES = 200 * 1024 * 1024;

export type LibraryKind = 'release' | 'snapshot' | 'custom';

export interface LibrarySelection {
    kind: LibraryKind;
    /** Version for release/snapshot, or the file name for a custom URL. */
    version: string;
    url: string;
    fileName: string;
}

export interface BndVersionMetadata {
    latest: string;
    versions: string[];
}

function log(message: string): void {
    outputChannel?.appendLine(`[bnd library] ${message}`);
}

function trimTrailingSlashes(url: string): string {
    return url.replace(/\/+$/, '');
}

function releaseRepository(): string {
    const cfg = vscode.workspace.getConfiguration('bnd');
    return trimTrailingSlashes(cfg.get<string>('cli.mavenRepository', 'https://repo.maven.apache.org/maven2'));
}

function snapshotRepository(): string {
    const cfg = vscode.workspace.getConfiguration('bnd');
    return trimTrailingSlashes(
        cfg.get<string>('cli.snapshotRepository', 'https://bndtools.jfrog.io/artifactory/libs-snapshot-local'),
    );
}

function artifactBaseUrl(repository: string): string {
    return `${repository}/${BND_GROUP_PATH}/${BND_ARTIFACT_ID}`;
}

// ─── Metadata parsing ─────────────────────────────────────────────────────────

export function parseVersions(metadataXml: string): string[] {
    const versions = [...metadataXml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map(match => match[1].trim())
        .filter(Boolean);
    return [...new Set(versions)];
}

export function parseLatestVersion(metadataXml: string, versions: string[]): string | undefined {
    const release = metadataXml.match(/<release>([^<]+)<\/release>/)?.[1]?.trim();
    const latest = metadataXml.match(/<latest>([^<]+)<\/latest>/)?.[1]?.trim();
    return release || latest || versions[versions.length - 1];
}

/** Picks the timestamped JAR name from a snapshot `maven-metadata.xml`. */
export function parseSnapshotJarName(metadataXml: string, version: string): string | undefined {
    for (const block of metadataXml.matchAll(/<snapshotVersion>([\s\S]*?)<\/snapshotVersion>/g)) {
        const body = block[1];
        if (/<classifier>/.test(body)) {
            continue;
        }
        if (!/<extension>\s*jar\s*<\/extension>/.test(body)) {
            continue;
        }
        const value = body.match(/<value>([^<]+)<\/value>/)?.[1]?.trim();
        if (value) {
            return `${BND_ARTIFACT_ID}-${value}.jar`;
        }
    }

    const timestamp = metadataXml.match(/<timestamp>([^<]+)<\/timestamp>/)?.[1]?.trim();
    const buildNumber = metadataXml.match(/<buildNumber>([^<]+)<\/buildNumber>/)?.[1]?.trim();
    if (timestamp && buildNumber) {
        const base = version.replace(/-SNAPSHOT$/i, '');
        return `${BND_ARTIFACT_ID}-${base}-${timestamp}-${buildNumber}.jar`;
    }

    return undefined;
}

/** Fallback when the repository serves only a directory listing. */
export function parseJarNamesFromListing(html: string): string[] {
    const names = [...html.matchAll(/href="([^"]+\.jar)"/gi)]
        .map(match => decodeURIComponent(match[1]).split('/').pop() as string)
        .filter(name => name.startsWith(`${BND_ARTIFACT_ID}-`) && !/-(sources|javadoc)\.jar$/i.test(name));
    return [...new Set(names)].sort();
}

/** Directory names of a listing, used to discover snapshot versions. */
export function parseVersionsFromListing(html: string): string[] {
    const names = [...html.matchAll(/href="([^"?]+)\/"/gi)]
        .map(match => decodeURIComponent(match[1]).replace(/\/+$/, '').split('/').pop() as string)
        .filter(name => /^\d+\.\d+/.test(name));
    return [...new Set(names)];
}

export function validateCustomJarUrl(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
        return 'URL is required.';
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return 'Not a valid URL.';
    }

    if (parsed.protocol !== 'https:') {
        return 'Only https URLs are accepted.';
    }
    if (!/\.jar$/i.test(parsed.pathname)) {
        return 'URL must point to a .jar file.';
    }
    return undefined;
}

function assertJarBytes(bytes: Uint8Array, source: string): void {
    if (bytes.length > MAX_JAR_BYTES) {
        throw new Error(`Downloaded file from ${source} exceeds ${MAX_JAR_BYTES} bytes.`);
    }
    const isJar = JAR_MAGIC.every((byte, index) => bytes[index] === byte);
    if (!isJar) {
        throw new Error(`Downloaded file from ${source} is not a JAR archive.`);
    }
}

// ─── Remote lookups ───────────────────────────────────────────────────────────

export async function fetchReleaseMetadata(): Promise<BndVersionMetadata> {
    const url = `${artifactBaseUrl(releaseRepository())}/maven-metadata.xml`;
    const xml = await httpGetText(url, { log });
    const versions = parseVersions(xml).filter(version => !/-SNAPSHOT$/i.test(version));
    const latest = parseLatestVersion(xml, versions);
    if (!latest) {
        throw new Error(`No bnd releases found in ${url}`);
    }
    return { latest, versions };
}

export async function fetchSnapshotVersions(): Promise<string[]> {
    const base = artifactBaseUrl(snapshotRepository());
    try {
        const xml = await httpGetText(`${base}/maven-metadata.xml`, { log });
        const versions = parseVersions(xml).filter(version => /-SNAPSHOT$/i.test(version));
        if (versions.length > 0) {
            return versions;
        }
    } catch (error) {
        log(`Snapshot maven-metadata.xml unavailable, falling back to directory listing: ${describe(error)}`);
    }

    const listing = await httpGetText(`${base}/`, { log });
    return parseVersionsFromListing(listing).filter(version => /-SNAPSHOT$/i.test(version));
}

async function resolveSnapshotJarName(version: string): Promise<string> {
    const versionBase = `${artifactBaseUrl(snapshotRepository())}/${version}`;
    try {
        const xml = await httpGetText(`${versionBase}/maven-metadata.xml`, { log });
        const name = parseSnapshotJarName(xml, version);
        if (name) {
            return name;
        }
    } catch (error) {
        log(`Snapshot version metadata unavailable, falling back to directory listing: ${describe(error)}`);
    }

    const listing = await httpGetText(`${versionBase}/`, { log });
    const names = parseJarNamesFromListing(listing);
    const newest = names[names.length - 1];
    if (!newest) {
        throw new Error(`No JAR found for snapshot version ${version}`);
    }
    return newest;
}

export function releaseSelection(version: string): LibrarySelection {
    const fileName = `${BND_ARTIFACT_ID}-${version}.jar`;
    return {
        kind: 'release',
        version,
        fileName,
        url: `${artifactBaseUrl(releaseRepository())}/${version}/${fileName}`,
    };
}

export async function snapshotSelection(version: string): Promise<LibrarySelection> {
    const fileName = await resolveSnapshotJarName(version);
    return {
        kind: 'snapshot',
        version,
        fileName,
        url: `${artifactBaseUrl(snapshotRepository())}/${version}/${fileName}`,
    };
}

export function customSelection(url: string): LibrarySelection {
    const fileName = decodeURIComponent(new URL(url).pathname).split('/').pop() || `${BND_ARTIFACT_ID}.jar`;
    return { kind: 'custom', version: fileName.replace(/\.jar$/i, ''), fileName, url };
}

// ─── Download & configuration ─────────────────────────────────────────────────

function libraryUri(context: vscode.ExtensionContext, selection: LibrarySelection): vscode.Uri {
    return vscode.Uri.joinPath(
        context.globalStorageUri,
        'library',
        'tool',
        selection.kind,
        selection.version,
        selection.fileName,
    );
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

export async function downloadLibrary(
    context: vscode.ExtensionContext,
    selection: LibrarySelection,
): Promise<vscode.Uri> {
    const target = libraryUri(context, selection);
    if (await exists(target)) {
        log(`Cache hit for ${selection.fileName} at ${target.fsPath}`);
        return target;
    }

    const bytes = await httpGet(selection.url, { log });
    assertJarBytes(bytes, selection.url);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await vscode.workspace.fs.writeFile(target, bytes);
    log(`Stored ${selection.fileName} at ${target.fsPath}`);
    return target;
}

/** Writes `bnd.cli.executable` for the current workspace, falling back to user settings. */
export async function configureBndLibrary(jarUri: vscode.Uri): Promise<void> {
    const jarPath = jarUri.fsPath.replace(/\\/g, '/');
    const executable = `${quoteForCommand(bndJavaExecutable())} -jar "${jarPath}"`;
    const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('bnd').update('cli.executable', executable, target);
    log(`Configured bnd.cli.executable (${vscode.ConfigurationTarget[target]}): ${executable}`);
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ─── Auto provisioning ────────────────────────────────────────────────────────

function isManagedByExtension(context: vscode.ExtensionContext, executable: string): boolean {
    const managedRoot = vscode.Uri.joinPath(context.globalStorageUri, 'library', 'tool').fsPath
        .replace(/\\/g, '/')
        .toLowerCase();
    return executable.replace(/\\/g, '/').toLowerCase().includes(managedRoot);
}

/**
 * Downloads and configures the newest release when no usable bnd CLI is configured.
 * A user-provided configuration is never overwritten.
 */
export async function ensureBndLibrary(context: vscode.ExtensionContext): Promise<void> {
    const inspected = vscode.workspace.getConfiguration('bnd').inspect<string>('cli.executable');
    const configured = (
        inspected?.workspaceFolderValue
        ?? inspected?.workspaceValue
        ?? inspected?.globalValue
        ?? ''
    ).trim();

    if (configured && !isManagedByExtension(context, configured)) {
        return;
    }

    try {
        const { latest } = await fetchReleaseMetadata();
        const selection = releaseSelection(latest);
        const existing = configured && (await exists(libraryUri(context, selection)));
        const jarUri = await downloadLibrary(context, selection);
        if (!existing || !configured) {
            await configureBndLibrary(jarUri);
            vscode.window.setStatusBarMessage(`bnd: using CLI ${latest}`, 4000);
        }
    } catch (error) {
        log(`Automatic bnd CLI provisioning failed: ${describe(error)}`);
    }
}

// ─── Command ──────────────────────────────────────────────────────────────────

async function pickReleaseVersion(): Promise<string | undefined> {
    const { latest, versions } = await fetchReleaseMetadata();
    const items: vscode.QuickPickItem[] = [
        ...[...versions].reverse().slice(0, 30).map(version => ({
            label: version,
            description: version === latest ? 'Latest release' : undefined,
        })),
        { label: 'Enter another version...', description: 'Type an explicit version' },
    ];

    const choice = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Configure bnd Library — release version',
        placeHolder: 'Select a release version',
    });
    if (!choice) { return undefined; }
    if (choice.label === 'Enter another version...') {
        return vscode.window.showInputBox({
            title: 'Bnd: Configure bnd Library',
            prompt: 'Enter the bnd release version',
            value: latest,
            validateInput: value => (value.trim() ? undefined : 'Version is required.'),
        });
    }
    return choice.label;
}

async function pickSnapshotVersion(): Promise<string | undefined> {
    const versions = await fetchSnapshotVersions();
    if (versions.length === 0) {
        throw new Error(`No snapshot versions found in ${snapshotRepository()}`);
    }

    const ordered = [...versions].reverse();
    const items = ordered.map((version, index) => ({
        label: version,
        description: index === 0 ? 'Newest snapshot' : undefined,
    }));

    const choice = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Configure bnd Library — snapshot version',
        placeHolder: 'Select a snapshot version',
    });
    return choice?.label;
}

async function selectLibrary(): Promise<LibrarySelection | undefined> {
    const kindChoice = await vscode.window.showQuickPick(
        [
            { label: 'Release', description: 'Versions from Maven Central', source: 'release' as const },
            { label: 'Snapshot', description: 'Builds from the bndtools Artifactory', source: 'snapshot' as const },
            { label: 'Custom URL...', description: 'Download a JAR from an explicit https URL', source: 'custom' as const },
        ],
        { title: 'Bnd: Configure bnd Library', placeHolder: 'Select the source of the bnd CLI JAR' },
    );
    if (!kindChoice) { return undefined; }

    if (kindChoice.source === 'release') {
        const version = await pickReleaseVersion();
        return version ? releaseSelection(version) : undefined;
    }

    if (kindChoice.source === 'snapshot') {
        const version = await pickSnapshotVersion();
        return version ? snapshotSelection(version) : undefined;
    }

    const url = await vscode.window.showInputBox({
        title: 'Bnd: Configure bnd Library — custom URL',
        prompt: 'https URL of a biz.aQute.bnd JAR',
        placeHolder: 'https://example.org/biz.aQute.bnd-7.4.0.jar',
        validateInput: validateCustomJarUrl,
    });
    return url ? customSelection(url.trim()) : undefined;
}

export async function cmdConfigureLibrary(context: vscode.ExtensionContext): Promise<void> {
    try {
        const selection = await selectLibrary();
        if (!selection) { return; }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Configuring bnd ${selection.version}`,
                cancellable: false,
            },
            async progress => {
                progress.report({ message: `Downloading ${selection.fileName}...` });
                const jarUri = await downloadLibrary(context, selection);
                progress.report({ message: 'Updating bnd.cli.executable...' });
                await configureBndLibrary(jarUri);
                vscode.window.showInformationMessage(
                    `Configured bnd CLI ${selection.version} (${selection.kind}) from ${path.dirname(jarUri.fsPath)}.`,
                );
            },
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to configure bnd library: ${describe(error)}`);
    }
}
