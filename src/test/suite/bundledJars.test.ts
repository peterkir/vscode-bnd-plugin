import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';

suite('Bundled JAR provenance', () => {
    test('bundled JARs match server/bundled-jars.json', () => {
        const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
        // process.execPath is the Electron host; run it as plain Node.
        const result = cp.spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'bundledJars.mjs'), 'verify'], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });
        assert.strictEqual(result.status, 0, `${result.stdout}${result.stderr}`);
    });
});
