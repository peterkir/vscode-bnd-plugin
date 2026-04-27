import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as vscode from 'vscode';

const OUTPUT_CHANNEL_NAME = 'Bnd Language Server';
const JAR_FILENAME = 'bnd-lsp.jar';

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    }
    return outputChannel;
}

function log(message: string): void {
    getOutputChannel().appendLine(`[bnd-lsp] ${message}`);
}

/**
 * Returns the path to the cached bnd-lsp JAR, downloading it if necessary.
 *
 * @param context - The VS Code extension context (used for cache directory).
 * @returns The absolute path to the JAR file, or undefined if download failed.
 */
export async function ensureJar(context: vscode.ExtensionContext): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('bnd.lsp');
    const version: string = config.get('serverVersion', 'latest');
    const downloadBaseUrl: string = config.get(
        'downloadBaseUrl',
        'https://github.com/peterkir/vscode-bnd-plugin/releases'
    );

    const storageDir = context.globalStorageUri.fsPath;
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    const jarPath = path.join(storageDir, JAR_FILENAME);

    // Build the download URL based on configured version
    const downloadUrl = buildDownloadUrl(downloadBaseUrl, version);

    // Check if already cached with a valid size
    if (fs.existsSync(jarPath) && fs.statSync(jarPath).size > 0 && version !== 'latest') {
        log(`Using cached JAR at ${jarPath}`);
        return jarPath;
    }

    log(`Downloading bnd-lsp JAR (${version}) from ${downloadUrl} ...`);
    getOutputChannel().show(true);

    try {
        await downloadFile(downloadUrl, jarPath);
        log(`Downloaded bnd-lsp JAR to ${jarPath} (${fs.statSync(jarPath).size} bytes)`);
        return jarPath;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Download failed: ${message}`);

        const choice = await vscode.window.showErrorMessage(
            `Failed to download bnd-lsp language server JAR: ${message}`,
            'Retry',
            'Show Output',
            'Disable Java LSP'
        );

        if (choice === 'Retry') {
            return ensureJar(context);
        }
        if (choice === 'Show Output') {
            getOutputChannel().show();
        }
        if (choice === 'Disable Java LSP') {
            await vscode.workspace.getConfiguration().update(
                'bnd.lsp.enable',
                false,
                vscode.ConfigurationTarget.Global
            );
        }

        return undefined;
    }
}

/**
 * Constructs the GitHub Releases download URL for the stable bnd-lsp.jar asset.
 *
 * Uses:
 *  - `<baseUrl>/latest/download/bnd-lsp.jar` when version is 'latest'
 *  - `<baseUrl>/download/<version>/bnd-lsp.jar` when a specific tag is given
 */
function buildDownloadUrl(baseUrl: string, version: string): string {
    const base = baseUrl.replace(/\/$/, '');
    if (version === 'latest') {
        return `${base}/latest/download/${JAR_FILENAME}`;
    }
    return `${base}/download/${version}/${JAR_FILENAME}`;
}

/**
 * Downloads a URL to a local file path, following HTTP redirects.
 */
function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const attempt = (currentUrl: string, redirectsLeft: number): void => {
            if (redirectsLeft <= 0) {
                reject(new Error(`Too many redirects from ${url}`));
                return;
            }

            const request = https.get(currentUrl, (response) => {
                // Follow redirects (GitHub release assets redirect to S3)
                if (
                    response.statusCode !== undefined &&
                    response.statusCode >= 300 &&
                    response.statusCode < 400 &&
                    response.headers.location
                ) {
                    response.destroy();
                    attempt(response.headers.location, redirectsLeft - 1);
                    return;
                }

                if (response.statusCode !== 200) {
                    response.destroy();
                    reject(
                        new Error(
                            `HTTP ${response.statusCode} when downloading ${currentUrl}`
                        )
                    );
                    return;
                }

                const tmpPath = destPath + '.download';
                const file = fs.createWriteStream(tmpPath);

                response.pipe(file);

                file.on('finish', () => {
                    file.close(() => {
                        try {
                            fs.renameSync(tmpPath, destPath);
                            resolve();
                        } catch (renameErr) {
                            reject(renameErr);
                        }
                    });
                });

                file.on('error', (fileErr) => {
                    fs.unlink(tmpPath, () => undefined);
                    reject(fileErr);
                });
            });

            request.on('error', reject);
            request.setTimeout(30_000, () => {
                request.destroy(new Error(`Request timed out for ${currentUrl}`));
            });
        };

        attempt(url, 10);
    });
}
