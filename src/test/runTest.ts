import * as path from 'path';
import { execSync } from 'child_process';
import { runTests } from '@vscode/test-electron';

function detectVsCodeExecutablePath(): string | undefined {
    const explicit = process.env.VSCODE_EXECUTABLE_PATH?.trim();
    if (explicit) {
        return explicit;
    }

    try {
        if (process.platform === 'win32') {
            const whereOutput = execSync('where code', { encoding: 'utf8' });
            const candidates = whereOutput
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean);

            for (const candidate of candidates) {
                if (candidate.toLowerCase().endsWith('code.exe')) {
                    return candidate;
                }
                if (candidate.toLowerCase().endsWith('code.cmd')) {
                    return candidate.replace(/code\.cmd$/i, 'Code.exe');
                }
            }
        }
    } catch {
        // Keep default downloader fallback when local discovery fails.
    }

    return undefined;
}

async function main(): Promise<void> {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../../..');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        const vscodeExecutablePath = detectVsCodeExecutablePath();

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            vscodeExecutablePath,
            launchArgs: [extensionDevelopmentPath, '--disable-extensions'],
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Failed to run extension tests:', message);
        process.exit(1);
    }
}

void main();
