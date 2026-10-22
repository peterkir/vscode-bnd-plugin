#!/usr/bin/env node
// Maintains the Eclipse RCP example workspace in examples/com.example.rcp.
//
//   node scripts/exampleWorkspace.mjs generate [--target <dir>]   regenerate the fixture from the upstream
//                                                                 templates with the bundled Java language server
//   node scripts/exampleWorkspace.mjs import   <dir>              copy an existing generated workspace (for example
//                                                                 one created with the VS Code wizards) into the fixture
//   node scripts/exampleWorkspace.mjs prepare  [<dir>] [--open]   copy the fixture to a scratch directory
//                                                                 (default /tmp/bnd-demo/com.example.rcp)
//   node scripts/exampleWorkspace.mjs test     [<dir>]            build and run the SWTBot tests with the bnd CLI
//
// Environment:
//   BND_CLI        bnd command for `test` (default: `bnd`, e.g. "java -jar /path/biz.aQute.bnd.jar")
//   BND_LSP_JAR    language server JAR for `generate` (default: server/biz.aQute.bnd.lsp.jar)
//   VSCODE_CLI     `code` executable for `prepare --open` (default: code)

import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(repoRoot, 'examples', 'com.example.rcp');
const defaultScratch = path.join(os.tmpdir() === '/tmp' ? '/tmp' : os.tmpdir(), 'bnd-demo', 'com.example.rcp');

const workspaceTemplate = 'https://github.com/bndtools/bndtools.workspace.min';
const fragmentIndex = 'https://raw.githubusercontent.com/bndtools/workspace-templates/master/index.bnd';
const fragments = ['Eclipse RCP E4 Application', 'Eclipse RCP SWTBot Tests'];

// Build output and caches that the workspace recreates on demand.
const transient = ['cnf/cache', '${build}', '.gradle', 'reports'];
const transientNames = new Set(['generated', 'bin', 'bin_test', '_rt', '.DS_Store']);
const transientPattern = /\.index\.xml\.gz$/;

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter(arg => arg.startsWith('--')));
const positional = rest.filter(arg => !arg.startsWith('--'));
const option = name => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };

function run(cmd, args, cwd) {
    console.log(`$ ${[cmd, ...args].join(' ')}`);
    const result = cp.spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error(`${cmd} exited with ${result.status ?? result.signal}`);
}

function isTransient(root, file) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    return transient.some(prefix => relative === prefix || relative.startsWith(`${prefix}/`))
        || relative.split('/').some(segment => transientNames.has(segment))
        || transientPattern.test(relative);
}

function copyWorkspace(source, target) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true, filter: file => !isTransient(source, file) });
    for (const script of ['gradlew']) {
        const file = path.join(target, script);
        if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
    }
}

// The upstream swtbot-tests fragment (2026-10) writes `url.` and `cache.` with a stray dot,
// which P2Repository rejects ("you must set the url parameter").
function repairSwtbotFragment(root) {
    const ext = path.join(root, 'cnf', 'ext');
    if (!fs.existsSync(ext)) return;
    for (const name of fs.readdirSync(ext).filter(name => /^swtbot_.*\.bnd$/.test(name))) {
        const file = path.join(ext, name);
        const text = fs.readFileSync(file, 'utf8');
        const fixed = text.replace(/^(\s*)url\.(\s*=)/m, '$1url$2').replace(/^(\s*)cache\.(\s*=)/m, '$1cache$2');
        if (fixed !== text) { fs.writeFileSync(file, fixed); console.log(`repaired cnf/ext/${name}`); }
    }
}

function platformSuffix() {
    const key = `${process.platform}-${process.arch}`;
    const map = {
        'darwin-arm64': 'macosx.cocoa.aarch64', 'darwin-x64': 'macosx.cocoa.x86-64',
        'linux-x64': 'linux.gtk.x86-64', 'win32-x64': 'win32.win32.x86-64',
    };
    if (!map[key]) throw new Error(`No SWTBot bndrun for ${key}; available: ${Object.values(map).join(', ')}`);
    return map[key];
}

async function generate() {
    const target = path.resolve(option('--target') ?? fixture);
    const jar = process.env.BND_LSP_JAR ?? path.join(repoRoot, 'server', 'biz.aQute.bnd.lsp.jar');
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-example-'));
    const workspace = path.join(staging, 'com.example.rcp');
    fs.mkdirSync(workspace);

    const require = createRequire(import.meta.url);
    const rpc = require('vscode-jsonrpc/node');
    const server = cp.spawn('java', ['-jar', jar], { stdio: ['pipe', 'pipe', 'pipe'] });
    server.stderr.on('data', () => {});
    const connection = rpc.createMessageConnection(new rpc.StreamMessageReader(server.stdout), new rpc.StreamMessageWriter(server.stdin));
    connection.onNotification(() => {});
    connection.listen();
    const execute = async (cmd, request) => {
        const result = await connection.sendRequest('workspace/executeCommand', { command: cmd, arguments: [request] });
        if (!result || typeof result !== 'object') throw new Error(`Unexpected response from ${cmd}`);
        if (result.error) throw new Error(String(result.error));
        return result;
    };
    const apply = async (mode, indexes, select) => {
        const catalog = await execute('bnd.wizard.templates.list', { indexes, mode });
        try {
            const templates = catalog.templates.filter(template => !template.archived);
            const chosen = select(templates);
            if (!chosen.length) throw new Error(`No templates matched in ${indexes.join(', ')}`);
            console.log(`${mode}: ${chosen.map(template => template.name).join(', ')}`);
            await execute('bnd.wizard.create', {
                catalogId: catalog.catalogId, targetUri: pathToFileURL(workspace).toString(), templates: chosen.map(template => template.id),
                trustedSources: true, compose: true, confirmed: true, mode, dirtyUris: [],
            });
        } finally {
            await execute('bnd.wizard.plan.dispose', { catalogId: catalog.catalogId });
        }
    };
    try {
        await connection.sendRequest('initialize', { processId: process.pid, rootUri: null, capabilities: {}, initializationOptions: { workspaceTrusted: true } });
        await connection.sendNotification('initialized', {});
        await apply('workspace', [workspaceTemplate], templates => templates.slice(0, 1));
        await apply('fragment', [fragmentIndex], templates => templates.filter(template => fragments.includes(template.name)));
        await connection.sendRequest('shutdown');
    } finally {
        connection.dispose();
        server.kill();
    }
    repairSwtbotFragment(workspace);
    copyWorkspace(workspace, target);
    fs.rmSync(staging, { recursive: true, force: true });
    console.log(`Example workspace written to ${target}`);
}

function importWorkspace() {
    const source = path.resolve(positional[0] ?? '');
    if (!positional[0] || !fs.existsSync(path.join(source, 'cnf', 'build.bnd'))) throw new Error('Pass the root of a generated bnd workspace.');
    repairSwtbotFragment(source);
    copyWorkspace(source, fixture);
    console.log(`Example workspace written to ${fixture}`);
}

function prepare() {
    const target = path.resolve(positional[0] ?? defaultScratch);
    if (!fs.existsSync(path.join(fixture, 'cnf', 'build.bnd'))) throw new Error(`Fixture missing: ${fixture}. Run "generate" first.`);
    copyWorkspace(fixture, target);
    console.log(`Example workspace copied to ${target}`);
    if (flags.has('--open')) {
        run(process.env.VSCODE_CLI ?? 'code', ['--new-window', `--extensionDevelopmentPath=${repoRoot}`, target]);
    } else {
        console.log(`Open it in an Extension Development Host with:\n  code --new-window --extensionDevelopmentPath=${repoRoot} ${target}`);
    }
}

function test() {
    const root = path.resolve(positional[0] ?? defaultScratch);
    if (!fs.existsSync(path.join(root, 'cnf', 'build.bnd'))) throw new Error(`${root} is not a bnd workspace. Run "prepare" first.`);
    const [bnd, ...bndArgs] = (process.env.BND_CLI ?? 'bnd').split(' ').filter(Boolean);
    const bndrun = `example.rcp.app.ui.swtbot.tests/swtbot_${platformSuffix()}.bndrun`;
    run(bnd, [...bndArgs, 'build'], root);
    run(bnd, [...bndArgs, 'runtests', '--workspace', '.', '--reportdir', 'reports', bndrun], root);
    console.log(`Reports: ${path.join(root, 'reports')}`);
}

const commands = { generate, import: importWorkspace, prepare, test };
if (!commands[command]) {
    console.error('Usage: node scripts/exampleWorkspace.mjs <generate|import|prepare|test> [options]');
    process.exit(2);
}
(async () => commands[command]())().catch(error => { console.error(error.message ?? error); process.exit(1); });
