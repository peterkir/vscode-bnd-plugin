import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

function collectTests(dir: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTests(entryPath));
            continue;
        }
        if (entry.name.endsWith('.test.js')) {
            files.push(entryPath);
        }
    }
    return files;
}

export async function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 15000,
    });

    const testsRoot = __dirname;
    const testFiles = collectTests(testsRoot);
    for (const file of testFiles) {
        mocha.addFile(file);
    }

    await new Promise<void>((resolve, reject) => {
        mocha.run(failures => {
            if (failures > 0) {
                reject(new Error(`${failures} test(s) failed.`));
                return;
            }
            resolve();
        });
    });
}
