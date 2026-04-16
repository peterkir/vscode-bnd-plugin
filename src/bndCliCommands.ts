import * as vscode from 'vscode';
import { BND_COMMANDS } from './bndCommandData';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Returns the configured bnd executable (e.g. "bnd" or "java -jar /path/to/biz.aQute.bnd.jar"). */
function bndExec(): string {
    const cfg = vscode.workspace.getConfiguration('bnd');
    return cfg.get<string>('cli.executable', 'bnd');
}

/** Returns the current workspace folder path, or undefined. */
function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// ─── Terminal Helper ──────────────────────────────────────────────────────────

let _terminal: vscode.Terminal | undefined;

/** Reuse a named terminal so the user always sees output in the same pane. */
function getTerminal(): vscode.Terminal {
    if (!_terminal || _terminal.exitStatus !== undefined) {
        _terminal = vscode.window.createTerminal({ name: 'bnd' });
    }
    return _terminal;
}

function runInTerminal(args: string): void {
    const term = getTerminal();
    term.show(true);
    term.sendText(`${bndExec()} ${args}`);
}

// ─── Active-editor helper ─────────────────────────────────────────────────────

/**
 * If the currently active editor is a `.bnd` or `.bndrun` file, returns its
 * workspace-relative path so it can be passed directly to the CLI.
 * Returns `undefined` when no such file is active.
 */
function activeRunFile(): string | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') { return undefined; }
    if (!uri.fsPath.endsWith('.bndrun') && !uri.fsPath.endsWith('.bnd')) { return undefined; }
    return vscode.workspace.asRelativePath(uri);
}

interface RunFileItem extends vscode.QuickPickItem {
    /** Workspace-relative path, or '' to mean "current project default". */
    file: string;
}

/**
 * Shows a QuickPick of all `.bndrun` files in the workspace.
 * When the active editor is a `.bnd`/`.bndrun` file that file is floated to
 * the top of the list and pre-focused so the user can confirm with Enter.
 *
 * @param title         Title shown in the picker header.
 * @param allowDefault  When true, a "(current project)" entry is prepended.
 * @returns The chosen relative file path, `''` for the current-project entry,
 *          or `undefined` if the user cancelled.
 */
async function pickBndrunFile(title: string, allowDefault: boolean): Promise<string | undefined> {
    const found = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    const active = activeRunFile();

    const items: RunFileItem[] = [];

    if (allowDefault) {
        items.push({
            label: '$(folder) (current project)',
            description: 'Use the default bndrun of the current project',
            file: '',
        });
    }

    // Active file first, rest sorted alphabetically
    const sorted = [...found].sort((a, b) => {
        const ra = vscode.workspace.asRelativePath(a);
        const rb = vscode.workspace.asRelativePath(b);
        if (ra === active) { return -1; }
        if (rb === active) { return 1; }
        return ra.localeCompare(rb);
    });

    for (const f of sorted) {
        const rel = vscode.workspace.asRelativePath(f);
        items.push({
            label: rel,
            description: rel === active ? '$(edit) currently open' : undefined,
            file: rel,
        });
    }

    if (items.length === 0) {
        return undefined;
    }

    return new Promise(resolve => {
        const qp = vscode.window.createQuickPick<RunFileItem>();
        qp.title = title;
        qp.placeholder = 'Select a .bndrun file';
        qp.items = items;

        // Pre-focus the active file so Enter runs it immediately
        if (active) {
            const activeItem = items.find(i => i.file === active);
            if (activeItem) { qp.activeItems = [activeItem]; }
        }

        qp.onDidAccept(() => {
            const selected = qp.selectedItems[0];
            resolve(selected?.file);
            qp.dispose();
        });
        qp.onDidHide(() => {
            resolve(undefined);
            qp.dispose();
        });
        qp.show();
    });
}

// ─── Individual Command Handlers ──────────────────────────────────────────────

/** bnd build [-t] [-w] */
async function cmdBuild(): Promise<void> {
    const choice = await vscode.window.showQuickPick(
        [
            { label: 'Build', description: 'bnd build', cmd: '' },
            { label: 'Build for test', description: 'bnd build --test', cmd: '--test' },
            { label: 'Watch (continuous)', description: 'bnd build --watch', cmd: '--watch' },
        ],
        { title: 'Bnd: Build Project', placeHolder: 'Select build mode' },
    );
    if (!choice) { return; }
    runInTerminal(`build ${choice.cmd}`.trim());
}

/** bnd run [bndrun] */
async function cmdRun(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal('run');
        return;
    }
    const file = await pickBndrunFile('Bnd: Run', true);
    if (file === undefined) { return; }
    runInTerminal(file ? `run ${file}` : 'run');
}

/** bnd test */
async function cmdTest(): Promise<void> {
    runInTerminal('test');
}

/** bnd runtests [bndrun] */
async function cmdRunTests(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal('runtests');
        return;
    }
    const file = await pickBndrunFile('Bnd: Run OSGi Tests', true);
    if (file === undefined) { return; }
    runInTerminal(file ? `runtests ${file}` : 'runtests');
}

/** bnd resolve [bndrun...] */
async function cmdResolve(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        runInTerminal('resolve');
        return;
    }
    const items = files.map(f => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
        picked: false,
    }));
    const choices = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Resolve',
        placeHolder: 'Select .bndrun file(s) to resolve',
        canPickMany: true,
    });
    if (!choices) { return; }
    const paths = choices.map(c => c.label).join(' ');
    runInTerminal(paths ? `resolve ${paths}` : 'resolve');
}

/** bnd clean */
async function cmdClean(): Promise<void> {
    runInTerminal('clean');
}

/** bnd baseline */
async function cmdBaseline(): Promise<void> {
    runInTerminal('baseline');
}

/** bnd verify [jar...] */
async function cmdVerify(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/generated/*.jar', '**/node_modules/**');
    if (files.length === 0) {
        vscode.window.showInformationMessage('No JARs found. Run "bnd verify <path/to/jar>" manually.');
        return;
    }
    const items = files.map(f => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
        picked: false,
    }));
    const choices = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Verify JARs',
        placeHolder: 'Select JAR(s) to verify',
        canPickMany: true,
    });
    if (!choices) { return; }
    runInTerminal(`verify ${choices.map(c => c.label).join(' ')}`);
}

/** bnd print [jar] */
async function cmdPrint(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/generated/*.jar', '**/node_modules/**');
    const modeItems = [
        { label: 'Manifest', description: 'Show the bundle manifest (-m)', flag: '-m' },
        { label: 'Imports / Exports', description: 'Show imports and exports (-i)', flag: '-i' },
        { label: 'Resources', description: 'List all resources (-l)', flag: '-l' },
        { label: 'API usage', description: 'Show API usage (-a)', flag: '-a' },
        { label: 'Components', description: 'Show DS components (-C)', flag: '-C' },
        { label: 'Full', description: 'Print everything (-f)', flag: '-f' },
    ];

    const modeChoice = await vscode.window.showQuickPick(modeItems, {
        title: 'Bnd: Print Bundle — select view',
    });
    if (!modeChoice) { return; }

    if (files.length === 0) {
        const jarPath = await vscode.window.showInputBox({
            title: 'Bnd: Print Bundle',
            prompt: 'Path to JAR file',
            placeHolder: 'path/to/bundle.jar',
        });
        if (!jarPath) { return; }
        runInTerminal(`print ${modeChoice.flag} ${jarPath}`);
        return;
    }

    const jarItems = files.map(f => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
    }));
    const jarChoice = await vscode.window.showQuickPick(jarItems, {
        title: 'Bnd: Print Bundle — select JAR',
    });
    if (!jarChoice) { return; }
    runInTerminal(`print ${modeChoice.flag} ${jarChoice.label}`);
}

/** bnd diff [newer] [older] */
async function cmdDiff(): Promise<void> {
    const newerPath = await vscode.window.showInputBox({
        title: 'Bnd: Diff — newer JAR',
        prompt: 'Path to the NEWER JAR (leave blank for current project)',
        placeHolder: 'generated/bundle.jar',
    });
    if (newerPath === undefined) { return; }
    if (!newerPath) {
        runInTerminal('diff');
        return;
    }
    const olderPath = await vscode.window.showInputBox({
        title: 'Bnd: Diff — older / baseline JAR',
        prompt: 'Path to the OLDER baseline JAR',
        placeHolder: 'archive/bundle-1.0.0.jar',
    });
    if (!olderPath) { return; }
    runInTerminal(`diff ${newerPath} ${olderPath}`);
}

/** bnd wrap [jar] */
async function cmdWrap(): Promise<void> {
    const jarPath = await vscode.window.showInputBox({
        title: 'Bnd: Wrap JAR',
        prompt: 'Path to the plain JAR to wrap as an OSGi bundle',
        placeHolder: 'lib/library.jar',
    });
    if (!jarPath) { return; }
    runInTerminal(`wrap ${jarPath}`);
}

/** bnd export [bndrun] */
async function cmdExport(): Promise<void> {
    const files = await vscode.workspace.findFiles('**/*.bndrun', '**/node_modules/**');
    if (files.length === 0) {
        vscode.window.showInformationMessage('No .bndrun files found in workspace.');
        return;
    }
    const items = files.map(f => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
    }));
    const choice = await vscode.window.showQuickPick(items, {
        title: 'Bnd: Export',
        placeHolder: 'Select a .bndrun file to export',
    });
    if (!choice) { return; }
    runInTerminal(`export ${choice.label}`);
}

/** bnd release */
async function cmdRelease(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        'Release this project to its configured repository?',
        { modal: true },
        'Release',
    );
    if (confirm !== 'Release') { return; }
    runInTerminal('release');
}

/** bnd properties */
async function cmdProperties(): Promise<void> {
    runInTerminal('properties');
}

/** bnd info */
async function cmdInfo(): Promise<void> {
    runInTerminal('info');
}

/** bnd version */
async function cmdVersion(): Promise<void> {
    runInTerminal('version');
}

/** bnd macro <expr> */
async function cmdMacro(): Promise<void> {
    const expr = await vscode.window.showInputBox({
        title: 'Bnd: Evaluate Macro',
        prompt: 'Enter a bnd macro expression to evaluate',
        placeHolder: '${version;===;1.2.3.qualifier}',
    });
    if (!expr) { return; }
    runInTerminal(`macro '${expr}'`);
}

/** bnd repo ... — interactive sub-command selection */
async function cmdRepo(): Promise<void> {
    const subItems = [
        { label: 'list', description: 'List all bundles in repos', cmd: 'list' },
        { label: 'get', description: 'Get bundle from repo', cmd: 'get' },
        { label: 'put', description: 'Put bundle into repo', cmd: 'put' },
        { label: 'info', description: 'Show repo info', cmd: 'info' },
    ];
    const choice = await vscode.window.showQuickPick(subItems, {
        title: 'Bnd: Repo — select sub-command',
    });
    if (!choice) { return; }
    runInTerminal(`repo ${choice.cmd}`);
}

// ─── CLI Reference Webview ─────────────────────────────────────────────────

function buildWebviewHtml(panel: vscode.WebviewPanel): string {
    const nonce = Math.random().toString(36).substring(2);

    const rows = BND_COMMANDS.map(cmd => {
        const opts = cmd.options.length > 0
            ? `<ul class="opts">${cmd.options.map(o =>
                `<li><code>${o.short} --${o.long}${o.arg ? ` &lt;${o.arg}&gt;` : ''}</code>${o.description ? ` — ${escHtml(o.description)}` : ''}</li>`
              ).join('')}</ul>`
            : '';
        const exs = cmd.examples.length > 0
            ? `<div class="examples"><strong>Examples:</strong>${cmd.examples.map(e =>
                `<pre>${escHtml(e)}</pre>`).join('')}</div>`
            : '';
        return `<details id="cmd-${escHtml(cmd.name)}">
  <summary><span class="cmd-name">${escHtml(cmd.name)}</span> <span class="cmd-summary">${escHtml(cmd.summary)}</span></summary>
  <div class="cmd-body">
    <p class="synopsis"><code>bnd ${escHtml(cmd.synopsis)}</code></p>
    ${opts}
    ${exs}
  </div>
</details>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bnd CLI Reference</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 8px 16px; }
  h1 { font-size: 1.3em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
  #search { width: 100%; box-sizing: border-box; padding: 6px; margin-bottom: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-size: 1em; }
  details { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 4px 0; }
  details[open] { background: var(--vscode-editor-inactiveSelectionBackground); }
  summary { cursor: pointer; padding: 6px 8px; list-style: none; display: flex; align-items: baseline; gap: 10px; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '▶'; font-size: 0.7em; color: var(--vscode-descriptionForeground); }
  details[open] summary::before { content: '▼'; }
  .cmd-name { font-weight: bold; font-family: var(--vscode-editor-font-family); color: var(--vscode-textLink-foreground); }
  .cmd-summary { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .cmd-body { padding: 4px 16px 8px; }
  .synopsis { margin: 4px 0; }
  .opts { margin: 4px 0; padding-left: 20px; }
  .opts li { margin: 2px 0; font-size: 0.9em; }
  code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  pre { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; overflow-x: auto; margin: 4px 0; font-size: 0.88em; white-space: pre-wrap; }
  .hidden { display: none !important; }
  #count { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 6px; }
</style>
</head>
<body>
<h1>Bnd CLI Reference</h1>
<input id="search" type="text" placeholder="Filter commands…" autocomplete="off" />
<div id="count"></div>
<div id="list">
${rows}
</div>
<script nonce="${nonce}">
  const search = document.getElementById('search');
  const countEl = document.getElementById('count');
  const items = Array.from(document.querySelectorAll('#list > details'));
  function filter() {
    const q = search.value.toLowerCase().trim();
    let visible = 0;
    items.forEach(el => {
      const text = el.textContent.toLowerCase();
      const show = !q || text.includes(q);
      el.classList.toggle('hidden', !show);
      if (show) { visible++; }
    });
    countEl.textContent = q ? visible + ' of ' + items.length + ' commands' : items.length + ' commands';
  }
  search.addEventListener('input', filter);
  filter();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let referencePanel: vscode.WebviewPanel | undefined;

function cmdShowReference(): void {
    if (referencePanel) {
        referencePanel.reveal();
        return;
    }
    referencePanel = vscode.window.createWebviewPanel(
        'bndCliReference',
        'Bnd CLI Reference',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
    );
    referencePanel.webview.html = buildWebviewHtml(referencePanel);
    referencePanel.onDidDispose(() => { referencePanel = undefined; });
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** Register all bnd CLI VS Code commands. */
export function registerCliCommands(context: vscode.ExtensionContext): void {
    const register = (id: string, handler: () => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));

    register('bnd.cli.build',         cmdBuild);
    register('bnd.cli.run',           cmdRun);
    register('bnd.cli.test',          cmdTest);
    register('bnd.cli.runtests',      cmdRunTests);
    register('bnd.cli.resolve',       cmdResolve);
    register('bnd.cli.clean',         cmdClean);
    register('bnd.cli.baseline',      cmdBaseline);
    register('bnd.cli.verify',        cmdVerify);
    register('bnd.cli.print',         cmdPrint);
    register('bnd.cli.diff',          cmdDiff);
    register('bnd.cli.wrap',          cmdWrap);
    register('bnd.cli.export',        cmdExport);
    register('bnd.cli.release',       cmdRelease);
    register('bnd.cli.properties',    cmdProperties);
    register('bnd.cli.info',          cmdInfo);
    register('bnd.cli.version',       cmdVersion);
    register('bnd.cli.macro',         cmdMacro);
    register('bnd.cli.repo',          cmdRepo);
    register('bnd.cli.showReference', cmdShowReference);
}
