#!/usr/bin/env node
// Release gates and pre-release version for the CI workflows.
//
//   node scripts/release.mjs check <tag> [--skip-marketplace]   validate a release tag before building and publishing
//   node scripts/release.mjs prerelease-version                 print the Marketplace pre-release version for this CI run
//   node scripts/release.mjs published <version>                exit 0 when the version is on the Marketplace, 1 when not
//                                                               (2 on query errors)
//
// `check` requires: tag vX.Y.Z (strict, no suffix), an annotated tag object, package.json and package-lock.json at
// X.Y.Z, a "## X.Y.Z" section in CHANGELOG.md, X.Y.Z above every other v* tag, the bundled JAR lock intact, and on
// the Marketplace: above the latest published release and not equal to any published version (pre-releases
// included, because the Marketplace rejects reused version numbers).
//
// `prerelease-version` prints major.(minor+1).GITHUB_RUN_NUMBER so that pre-releases built from the default branch
// always sort above the release they are based on.
//
// Environment:
//   GITHUB_RUN_NUMBER   patch number for `prerelease-version`
//   MARKETPLACE_ID      extension to query (default: <publisher>.<name> from package.json)

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const [command, ...rest] = process.argv.slice(2);

function fail(message) {
    console.error(`release: ${message}`);
    process.exit(1);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
}

function run(cmd, args) {
    const result = cp.spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8' });
    if (result.error) return { status: -1, stdout: '', stderr: result.error.message };
    return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

function parseVersion(text) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(text);
    return match ? match.slice(1, 4).map(Number) : undefined;
}

function compare(a, b) {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}

function format(version) {
    return version.join('.');
}

function check() {
    const tag = rest.find(arg => !arg.startsWith('--'));
    if (!tag) fail('usage: node scripts/release.mjs check <tag> [--skip-marketplace]');
    if (!releaseTag.test(tag)) fail(`tag ${tag} must be vX.Y.Z (digits only, no pre-release suffix)`);
    const version = parseVersion(tag.slice(1));
    const problems = [];

    const type = run('git', ['cat-file', '-t', `refs/tags/${tag}`]);
    if (type.status !== 0) problems.push(`tag ${tag} does not exist locally`);
    else if (type.stdout !== 'tag') problems.push(`tag ${tag} is a lightweight tag; create it with "git tag -a"`);

    const pkg = readJson('package.json');
    const lock = readJson('package-lock.json');
    for (const [name, actual] of [['package.json', pkg.version], ['package-lock.json', lock.version], ['package-lock.json packages[""]', lock.packages?.['']?.version]]) {
        if (actual !== format(version)) problems.push(`${name} version is ${actual}, tag says ${format(version)}`);
    }

    const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
    if (!new RegExp(`^## ${format(version).replaceAll('.', '\\.')}\\s*$`, 'm').test(changelog)) {
        problems.push(`CHANGELOG.md has no "## ${format(version)}" section`);
    }

    const tags = run('git', ['tag', '--list', 'v*']);
    if (tags.status !== 0) problems.push(`git tag --list failed: ${tags.stderr}`);
    const previous = tags.stdout.split(/\r?\n/)
        .filter(name => name && name !== tag && releaseTag.test(name))
        .map(name => parseVersion(name.slice(1)))
        .sort(compare)
        .pop();
    if (previous && compare(version, previous) <= 0) problems.push(`${tag} is not above the latest existing release tag v${format(previous)}`);

    const jars = run(process.execPath, [path.join(repoRoot, 'scripts', 'bundledJars.mjs'), 'verify']);
    if (jars.status !== 0) problems.push(jars.stderr || jars.stdout);

    if (!rest.includes('--skip-marketplace')) problems.push(...marketplaceProblems(pkg, version));

    if (problems.length) fail(`${tag} is not releasable\n  ${problems.join('\n  ')}`);
    console.log(`${tag} passes all release checks${previous ? ` (previous release tag v${format(previous)})` : ''}`);
}

function marketplaceProblems(pkg, version) {
    const { id, versions, error } = marketplaceVersions(pkg);
    if (error) return [error];
    const problems = [];
    let latestRelease;
    for (const entry of versions) {
        const current = parseVersion(entry.version);
        if (!current) continue;
        if (compare(current, version) === 0) problems.push(`${format(version)} is already published on the Marketplace (${id})`);
        if (!entry.preRelease && (!latestRelease || compare(current, latestRelease) > 0)) latestRelease = current;
    }
    if (latestRelease && compare(version, latestRelease) <= 0) {
        problems.push(`${format(version)} is not above the latest Marketplace release ${format(latestRelease)} (${id})`);
    }
    return problems;
}

/** Published versions of this extension; `versions` is empty when the extension is not on the Marketplace yet. */
function marketplaceVersions(pkg) {
    const id = process.env.MARKETPLACE_ID || `${pkg.publisher}.${pkg.name}`;
    const vsce = path.join(repoRoot, 'node_modules', '@vscode', 'vsce', 'vsce');
    if (!fs.existsSync(vsce)) return { id, error: '@vscode/vsce is not installed; run "npm ci"' };
    const show = run(process.execPath, [vsce, 'show', id, '--json']);
    if (show.status !== 0) {
        if (/not found|does not exist/i.test(show.stderr + show.stdout)) return { id, versions: [] };
        return { id, error: `vsce show ${id} failed: ${show.stderr || show.stdout}` };
    }
    try {
        const versions = (JSON.parse(show.stdout).versions ?? []).map(entry => ({
            version: entry.version,
            preRelease: (entry.properties ?? []).some(p => p.key === 'Microsoft.VisualStudio.Code.PreRelease' && String(p.value) === 'true'),
        }));
        return { id, versions };
    } catch (error) {
        return { id, error: `vsce show ${id} returned no JSON: ${error.message}` };
    }
}

function published() {
    const wanted = parseVersion(rest[0] ?? '');
    if (!wanted) fail('usage: node scripts/release.mjs published <X.Y.Z>');
    const { id, versions, error } = marketplaceVersions(readJson('package.json'));
    if (error) { console.error(`release: ${error}`); process.exit(2); }
    const hit = versions.find(entry => entry.version === format(wanted));
    console.log(hit ? `${format(wanted)} is published on the Marketplace (${id}${hit.preRelease ? ', pre-release' : ''})` : `${format(wanted)} is not on the Marketplace (${id})`);
    process.exit(hit ? 0 : 1);
}

function prereleaseVersion() {
    const run = process.env.GITHUB_RUN_NUMBER;
    if (!/^\d+$/.test(run ?? '')) fail('GITHUB_RUN_NUMBER must be set to a number');
    const version = parseVersion(readJson('package.json').version);
    if (!version) fail('package.json version must be X.Y.Z');
    console.log(format([version[0], version[1] + 1, Number(run)]));
}

switch (command) {
    case 'check': check(); break;
    case 'prerelease-version': prereleaseVersion(); break;
    case 'published': published(); break;
    default:
        console.error('usage: node scripts/release.mjs check <tag> [--skip-marketplace] | prerelease-version | published <version>');
        process.exit(2);
}
