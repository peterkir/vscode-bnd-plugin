import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { httpGet, httpGetText } from './bndHttp';
import { bndJavaExecutable, quoteForCommand } from './bndCliCommands';
import { outputChannel } from './extension';

const BND_GROUP_PATH = 'biz/aQute/bnd';
const JAR_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const MAX_JAR_BYTES = 200 * 1024 * 1024;

export interface BndArtifact {
    artifactId: string;
    /** Sub folder of `globalStorage/library` holding downloaded JARs. */
    storage: string;
}

export const BND_CLI_ARTIFACT: BndArtifact = { artifactId: 'biz.aQute.bnd', storage: 'tool' };
export const BND_LSP_ARTIFACT: BndArtifact = { artifactId: 'biz.aQute.bnd.lsp', storage: 'lsp' };

export type LibraryKind = 'release' | 'snapshot' | 'custom';

export interface LibrarySelection {
    kind: LibraryKind;
    /** Version for release/snapshot, or the file name for a custom URL. */
    version: string;
    url: string;
    fileName: string;
    artifact: BndArtifact;
    /** Expected SHA-256 (hex) of the JAR. */
    sha256?: string;
    /** URL of a Maven `.sha1` file the JAR must match. */
    sha1Url?: string;
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

function artifactBaseUrl(repository: string, artifact: BndArtifact): string {
    return `${repository}/${BND_GROUP_PATH}/${artifact.artifactId}`;
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
export function parseSnapshotJarName(
    metadataXml: string,
    version: string,
    artifactId = BND_CLI_ARTIFACT.artifactId,
): string | undefined {
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
            return `${artifactId}-${value}.jar`;
        }
    }

    const timestamp = metadataXml.match(/<timestamp>([^<]+)<\/timestamp>/)?.[1]?.trim();
    const buildNumber = metadataXml.match(/<buildNumber>([^<]+)<\/buildNumber>/)?.[1]?.trim();
    if (timestamp && buildNumber) {
        const base = version.replace(/-SNAPSHOT$/i, '');
        return `${artifactId}-${base}-${timestamp}-${buildNumber}.jar`;
    }

    return undefined;
}

/** Fallback when the repository serves only a directory listing. */
export function parseJarNamesFromListing(html: string, artifactId = BND_CLI_ARTIFACT.artifactId): string[] {
    // A version always follows the artifact id, so `biz.aQute.bnd-` never matches `biz.aQute.bnd.lsp-…`.
    const prefix = new RegExp(`^${artifactId.replace(/\./g, '\\.')}-\\d`);
    const names = [...html.matchAll(/href="([^"]+\.jar)"/gi)]
        .map(match => decodeURIComponent(match[1]).split('/').pop() as string)
        .filter(name => prefix.test(name) && !/-(sources|javadoc)\.jar$/i.test(name));
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

/** Throws unless `bytes` hash to `expected` (hex, case-insensitive; Maven checksum files may append a file name). */
export function assertChecksum(bytes: Uint8Array, algorithm: 'sha1' | 'sha256', expected: string, source: string): void {
    const wanted = expected.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const actual = crypto.createHash(algorithm).update(bytes).digest('hex');
    if (!wanted || actual !== wanted) {
        throw new Error(`${algorithm.toUpperCase()} mismatch for ${source}: expected ${wanted || '<empty>'}, got ${actual}.`);
    }
}

// ─── Remote lookups ───────────────────────────────────────────────────────────

export async function fetchReleaseMetadata(artifact = BND_CLI_ARTIFACT): Promise<BndVersionMetadata> {
    const url = `${artifactBaseUrl(releaseRepository(), artifact)}/maven-metadata.xml`;
    let xml: string;
    try {
        xml = await httpGetText(url, { log });
    } catch (error) {
        throw new Error(`No ${artifact.artifactId} releases available from ${url}: ${describe(error)}`);
    }
    const versions = parseVersions(xml).filter(version => !/-SNAPSHOT$/i.test(version));
    const latest = parseLatestVersion(xml, versions);
    if (!latest) {
        throw new Error(`No ${artifact.artifactId} releases found in ${url}`);
    }
    return { latest, versions };
}

export async function fetchSnapshotVersions(artifact = BND_CLI_ARTIFACT): Promise<string[]> {
    const base = artifactBaseUrl(snapshotRepository(), artifact);
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

async function resolveSnapshotJarName(version: string, artifact: BndArtifact): Promise<string> {
    const versionBase = `${artifactBaseUrl(snapshotRepository(), artifact)}/${version}`;
    try {
        const xml = await httpGetText(`${versionBase}/maven-metadata.xml`, { log });
        const name = parseSnapshotJarName(xml, version, artifact.artifactId);
        if (name) {
            return name;
        }
    } catch (error) {
        log(`Snapshot version metadata unavailable, falling back to directory listing: ${describe(error)}`);
    }

    const listing = await httpGetText(`${versionBase}/`, { log });
    const names = parseJarNamesFromListing(listing, artifact.artifactId);
    const newest = names[names.length - 1];
    if (!newest) {
        throw new Error(`No JAR found for snapshot version ${version}`);
    }
    return newest;
}

export function releaseSelection(version: string, artifact = BND_CLI_ARTIFACT): LibrarySelection {
    const fileName = `${artifact.artifactId}-${version}.jar`;
    return {
        kind: 'release',
        version,
        fileName,
        artifact,
        url: `${artifactBaseUrl(releaseRepository(), artifact)}/${version}/${fileName}`,
    };
}

export async function snapshotSelection(version: string, artifact = BND_CLI_ARTIFACT): Promise<LibrarySelection> {
    const fileName = await resolveSnapshotJarName(version, artifact);
    return {
        kind: 'snapshot',
        version,
        fileName,
        artifact,
        url: `${artifactBaseUrl(snapshotRepository(), artifact)}/${version}/${fileName}`,
    };
}

export function customSelection(url: string, artifact = BND_CLI_ARTIFACT): LibrarySelection {
    const fileName = decodeURIComponent(new URL(url).pathname).split('/').pop() || `${artifact.artifactId}.jar`;
    return { kind: 'custom', version: fileName.replace(/\.jar$/i, ''), fileName, artifact, url };
}

// ─── Download & configuration ─────────────────────────────────────────────────

export function libraryUri(context: vscode.ExtensionContext, selection: LibrarySelection): vscode.Uri {
    return vscode.Uri.joinPath(
        context.globalStorageUri,
        'library',
        selection.artifact.storage,
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
    if (selection.sha256) {
        assertChecksum(bytes, 'sha256', selection.sha256, selection.url);
    }
    if (selection.sha1Url) {
        assertChecksum(bytes, 'sha1', await httpGetText(selection.sha1Url, { log }), selection.url);
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    // Rename after writing so a partially written file is never picked up as a cache hit.
    const partial = vscode.Uri.joinPath(target, '..', `${selection.fileName}.part`);
    await vscode.workspace.fs.writeFile(partial, bytes);
    await vscode.workspace.fs.rename(partial, target, { overwrite: true });
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

export const TRACK_LATEST = 'latest';

export interface VersionPickOptions {
    artifact?: BndArtifact;
    title?: string;
    /** Offers a `latest` entry that follows the newest version on every start. */
    offerTrackLatest?: boolean;
}

const trackLatestItem: vscode.QuickPickItem = { label: TRACK_LATEST, description: 'Always use the newest version' };

export async function pickReleaseVersion(options: VersionPickOptions = {}): Promise<string | undefined> {
    const title = options.title ?? 'Bnd: Configure bnd Library';
    const { latest, versions } = await fetchReleaseMetadata(options.artifact);
    const items: vscode.QuickPickItem[] = [
        ...(options.offerTrackLatest ? [trackLatestItem] : []),
        ...[...versions].reverse().slice(0, 30).map(version => ({
            label: version,
            description: version === latest ? 'Latest release' : undefined,
        })),
        { label: 'Enter another version...', description: 'Type an explicit version' },
    ];

    const choice = await vscode.window.showQuickPick(items, {
        title: `${title} — release version`,
        placeHolder: 'Select a release version',
    });
    if (!choice) { return undefined; }
    if (choice.label === 'Enter another version...') {
        return vscode.window.showInputBox({
            title,
            prompt: 'Enter the release version',
            value: latest,
            validateInput: value => (value.trim() ? undefined : 'Version is required.'),
        });
    }
    return choice.label;
}

export async function pickSnapshotVersion(options: VersionPickOptions = {}): Promise<string | undefined> {
    const artifact = options.artifact ?? BND_CLI_ARTIFACT;
    const versions = await fetchSnapshotVersions(artifact);
    if (versions.length === 0) {
        throw new Error(`No ${artifact.artifactId} snapshot versions found in ${snapshotRepository()}`);
    }

    const ordered = [...versions].reverse();
    const items: vscode.QuickPickItem[] = [
        ...(options.offerTrackLatest ? [trackLatestItem] : []),
        ...ordered.map((version, index) => ({
            label: version,
            description: index === 0 ? 'Newest snapshot' : undefined,
        })),
    ];

    const choice = await vscode.window.showQuickPick(items, {
        title: `${options.title ?? 'Bnd: Configure bnd Library'} — snapshot version`,
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
