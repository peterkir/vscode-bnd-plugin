#!/usr/bin/env node
// Maintains the bundled Java JARs in server/ and their provenance lock file server/bundled-jars.json.
//
//   node scripts/bundledJars.mjs update [--workspace <dir>]   copy freshly built JARs from the bnd source checkout
//                                                             and rewrite the lock file
//   node scripts/bundledJars.mjs lock   [--workspace <dir>]   rewrite the lock file for the JARs already in server/
//   node scripts/bundledJars.mjs verify                       fail when a JAR does not match the lock file
//   node scripts/bundledJars.mjs notes                        print the provenance as Markdown (release notes)
//
// The JARs are not published to a Maven repository; the lock file records the source repository, branch,
// the commit and Bundle-Version from the JAR manifest, and the SHA-256 of the committed file.
//
// Environment:
//   BND_LSP_WORKSPACE   bnd source checkout for `update` and `lock` (default: ../../bndtools/bnd.wt/fea-bnd-ls)

import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'server');
const lockName = 'server/bundled-jars.json';
const lockFile = path.join(repoRoot, lockName);

// Lock key (relative to server/) -> build output in the bnd workspace.
const jars = {
    'biz.aQute.bnd.lsp.jar': 'biz.aQute.bnd.lsp/generated/biz.aQute.bnd.lsp.jar',
    'jdtls/org.bndtools.jdtls.adapter.jar': 'org.bndtools.jdtls.adapter/generated/org.bndtools.jdtls.adapter.jar',
};
const manifestHeaders = ['Bundle-SymbolicName', 'Bundle-Version', 'Git-SHA', 'Git-Descriptor'];

const [command, ...rest] = process.argv.slice(2);
const option = name => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };

function fail(message) {
    console.error(`bundledJars: ${message}`);
    process.exit(1);
}

function git(cwd, ...args) {
    const result = cp.spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`);
    return result.stdout.trim();
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Reads META-INF/MANIFEST.MF from a JAR (deflate or stored entries, no ZIP64). */
function readManifest(file) {
    const buffer = fs.readFileSync(file);
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(`${file}: not a ZIP archive`);
    const count = buffer.readUInt16LE(eocd + 10);
    let p = buffer.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
        if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: corrupt central directory`);
        const method = buffer.readUInt16LE(p + 10);
        const compressedSize = buffer.readUInt32LE(p + 20);
        const nameLength = buffer.readUInt16LE(p + 28);
        const extraLength = buffer.readUInt16LE(p + 30);
        const commentLength = buffer.readUInt16LE(p + 32);
        const local = buffer.readUInt32LE(p + 42);
        const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
        if (name === 'META-INF/MANIFEST.MF') {
            const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
            const compressed = buffer.subarray(start, start + compressedSize);
            const text = (method === 0 ? compressed : zlib.inflateRawSync(compressed)).toString('utf8');
            return parseManifest(text);
        }
        p += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error(`${file}: META-INF/MANIFEST.MF not found`);
}

function parseManifest(text) {
    const headers = {};
    let current;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith(' ') && current) {
            headers[current] += line.slice(1);
        } else {
            const colon = line.indexOf(':');
            if (colon < 0) continue;
            current = line.slice(0, colon);
            headers[current] = line.slice(colon + 1).trim();
        }
    }
    return headers;
}

function describe(file) {
    const manifest = readManifest(file);
    const entry = { sha256: sha256(file), size: fs.statSync(file).size };
    for (const header of manifestHeaders) {
        if (manifest[header] !== undefined) entry[header] = manifest[header];
    }
    return entry;
}

function workspaceDir() {
    const dir = path.resolve(repoRoot, option('--workspace') ?? process.env.BND_LSP_WORKSPACE ?? '../../bndtools/bnd.wt/fea-bnd-ls');
    if (!fs.existsSync(path.join(dir, 'cnf'))) fail(`bnd workspace not found at ${dir} (use --workspace or BND_LSP_WORKSPACE)`);
    return dir;
}

function readLock() {
    if (!fs.existsSync(lockFile)) fail(`${lockName} is missing; run "npm run server:lock"`);
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
}

function writeLock(workspace) {
    const lock = {
        repository: git(workspace, 'remote', 'get-url', 'origin'),
        branch: git(workspace, 'branch', '--show-current'),
        updated: new Date().toISOString().slice(0, 10),
        jars: {},
    };
    for (const key of Object.keys(jars)) {
        lock.jars[key] = describe(path.join(serverDir, key));
    }
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
    console.log(`wrote ${lockName}`);
}

function update() {
    const workspace = workspaceDir();
    for (const [key, source] of Object.entries(jars)) {
        const from = path.join(workspace, source);
        if (!fs.existsSync(from)) fail(`${from} missing; build it first (./gradlew :${source.split('/')[0]}:jar)`);
        fs.copyFileSync(from, path.join(serverDir, key));
        console.log(`copied ${source}`);
    }
    writeLock(workspace);
}

function verify() {
    const lock = readLock();
    const problems = [];
    for (const key of Object.keys(jars)) {
        const expected = lock.jars?.[key];
        const file = path.join(serverDir, key);
        if (!expected) { problems.push(`${key}: not in lock file`); continue; }
        if (!fs.existsSync(file)) { problems.push(`${key}: file missing`); continue; }
        const actual = describe(file);
        for (const field of Object.keys(expected)) {
            if (actual[field] !== expected[field]) problems.push(`${key}: ${field} is ${actual[field]}, lock says ${expected[field]}`);
        }
    }
    if (problems.length) fail(`bundled JARs do not match ${lockName}; run "npm run server:lock" after an intentional update\n  ${problems.join('\n  ')}`);
    console.log(`bundled JARs match ${lockName}`);
}

function notes() {
    const lock = readLock();
    const web = lock.repository.replace(/\.git$/, '');
    const lines = ['## Bundled language server', '', `Built from ${web} (branch \`${lock.branch}\`):`, ''];
    for (const [key, entry] of Object.entries(lock.jars)) {
        const commit = entry['Git-SHA'] ? `[\`${entry['Git-SHA'].slice(0, 10)}\`](${web}/commit/${entry['Git-SHA']})` : 'unknown commit';
        const bsn = (entry['Bundle-SymbolicName'] ?? key).split(';')[0];
        lines.push(`- \`${key}\` — ${bsn} ${entry['Bundle-Version'] ?? ''}, commit ${commit}, SHA-256 \`${entry.sha256}\``);
    }
    console.log(lines.join('\n'));
}

try {
    switch (command) {
        case 'update': update(); break;
        case 'lock': writeLock(workspaceDir()); break;
        case 'verify': verify(); break;
        case 'notes': notes(); break;
        default:
            console.error('usage: node scripts/bundledJars.mjs update|lock [--workspace <dir>] | verify | notes');
            process.exit(2);
    }
} catch (error) {
    fail(error.message);
}
