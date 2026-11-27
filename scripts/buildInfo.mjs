#!/usr/bin/env node
// Records the extension version and the Git commit it is built from in out/build-info.json.
// The extension shows both in the bnd status bar item. Runs as part of `npm run compile`.
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => {
    const result = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : undefined;
};

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const commit = git('rev-parse', 'HEAD');
const status = commit === undefined ? undefined : git('status', '--porcelain', '--untracked-files=no');
const info = { version, commit, dirty: status === undefined ? undefined : status.length > 0 };

const output = path.join(root, 'out', 'build-info.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(info, null, 2) + '\n');
console.log(`build info: ${version} ${commit ?? 'unknown commit'}${info.dirty ? ' (modified)' : ''}`);
