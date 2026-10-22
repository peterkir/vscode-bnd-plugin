import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { addTemplateLocation, configuredTemplateIndexes, creationUI, createWorkspace, defaultWorkspaceTemplate, importWorkspace,
    ImportAction, resolveTemplateSelection, selectWizardTarget, templateIndexSettings, validateTemplateIndex, validateWorkspaceFolder,
    wizardCommands, WizardServer, WorkspaceCatalog, WorkspaceCreationUI, WorkspaceImportUI } from '../../bndWizards';

suite('bnd workspace import wizard', () => {
    let directory: string;
    let root: vscode.Uri;
    let action: ImportAction | undefined;
    let calls: unknown[];
    let ui: WorkspaceImportUI;

    setup(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-wizard-'));
        fs.mkdirSync(path.join(directory, 'cnf'));
        fs.writeFileSync(path.join(directory, 'cnf/build.bnd'), '${system;must-not-execute}\n');
        fs.writeFileSync(path.join(directory, '.project'), 'keep');
        root = vscode.Uri.file(directory);
        action = 'current';
        calls = [];
        ui = {
            pickFolder: async () => root,
            pickAction: async () => action,
            folders: () => [],
            open: async (folder, newWindow) => { calls.push([folder.fsPath, newWindow]); },
            add: folder => { calls.push(folder.fsPath); return true; },
        };
    });

    teardown(() => {
        const link = directory + '-alias';
        if (fs.existsSync(link)) fs.unlinkSync(link);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    test('opens existing workspace without evaluating or changing its files', async () => {
        await importWorkspace(ui);
        assert.deepStrictEqual(calls, [[vscode.Uri.file(fs.realpathSync(directory)).fsPath, false]]);
        assert.strictEqual(fs.readFileSync(path.join(directory, '.project'), 'utf8'), 'keep');
        assert.strictEqual(fs.readFileSync(path.join(directory, 'cnf/build.bnd'), 'utf8'), '${system;must-not-execute}\n');
        action = 'new';
        await importWorkspace(ui);
        assert.deepStrictEqual(calls[1], [vscode.Uri.file(fs.realpathSync(directory)).fsPath, true]);
    });

    test('adds root only and avoids duplicates', async () => {
        action = 'add';
        await importWorkspace(ui);
        assert.deepStrictEqual(calls, [vscode.Uri.file(fs.realpathSync(directory)).fsPath]);
        calls = [];
        ui.folders = () => [root];
        await importWorkspace(ui);
        assert.deepStrictEqual(calls, []);
    });

    test('resolves linked roots and avoids linked duplicates', async () => {
        const link = directory + '-alias';
        fs.symlinkSync(directory, link, process.platform === 'win32' ? 'junction' : 'dir');
        action = 'add';
        ui.folders = () => [vscode.Uri.file(link)];
        await importWorkspace(ui);
        assert.deepStrictEqual(calls, []);
        assert.strictEqual((await validateWorkspaceFolder(vscode.Uri.file(link))).fsPath, vscode.Uri.file(fs.realpathSync(directory)).fsPath);
    });

    test('cancellation makes no workspace changes', async () => {
        action = undefined;
        await importWorkspace(ui);
        ui.pickFolder = async () => undefined;
        ui.pickAction = async () => { throw new Error('must not ask after cancellation'); };
        await importWorkspace(ui);
        assert.deepStrictEqual(calls, []);
    });

    test('rejects invalid roots, configuration directories and virtual folders', async () => {
        await assert.rejects(validateWorkspaceFolder(vscode.Uri.file(path.join(directory, 'cnf'))), /cnf\/build.bnd/);
        fs.unlinkSync(path.join(directory, 'cnf/build.bnd'));
        fs.mkdirSync(path.join(directory, 'cnf/build.bnd'));
        await assert.rejects(importWorkspace(ui), /cnf\/build.bnd/);
        await assert.rejects(validateWorkspaceFolder(vscode.Uri.parse('untitled:workspace')), /file system/);
        assert.deepStrictEqual(calls, []);
    });

    test('reports refused workspace additions', async () => {
        action = 'add';
        ui.add = () => false;
        await assert.rejects(importWorkspace(ui), /could not add/);
    });

    test('contributes import in palette, Explorer and welcome content', async () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'));
        assert.ok(manifest.contributes.commands.some((entry: { command: string }) => entry.command === 'bnd.wizard.importWorkspace'));
        assert.ok(manifest.contributes.viewsWelcome.some((entry: { contents: string }) => entry.contents.includes('command:bnd.wizard.importWorkspace')));
        assert.ok(manifest.contributes.menus['view/title'].some((entry: { command: string }) => entry.command === 'bnd.wizard.importWorkspace'));
        await vscode.extensions.getExtension('klibio.bnd')!.activate();
        assert.ok((await vscode.commands.getCommands(true)).includes('bnd.wizard.importWorkspace'));
    });
});

suite('bnd workspace creation wizard', () => {
    const catalog: WorkspaceCatalog = { catalogId: 'catalog', templates: [
        { id: 'https://github.com/bndtools/templates/tree/master/base', name: 'Base', description: '', archived: false,
            official: true, requires: [], tags: [] },
        { id: 'https://github.com/example/templates/tree/master/app', name: 'App', description: '', archived: false,
            official: false, requires: ['https://github.com/bndtools/templates/tree/master/base'], tags: [] },
    ] };
    const targetUri = vscode.Uri.file(path.join(os.tmpdir(), 'generated-workspace')).toString();
    let commands: { command: string; request: Record<string, unknown> }[];
    let server: WizardServer;
    let ui: WorkspaceCreationUI;
    let opened: boolean;

    setup(() => {
        commands = [];
        opened = false;
        server = {
            supports: async () => true,
            execute: async (command, args) => {
                commands.push({ command, request: args[0] as Record<string, unknown> });
                if (command === wizardCommands.list) return catalog;
                if (command === wizardCommands.create) return { targetUri };
                return { disposed: true };
            },
        };
        ui = {
            target: async () => vscode.Uri.parse(targetUri), indexes: async () => ['https://example.org/index.bnd'],
            templates: async () => [catalog.templates[1]], confirmSources: async templates => {
                assert.deepStrictEqual(templates, catalog.templates);
                return true;
            },
            progress: async (_title, task) => { const token = new vscode.CancellationTokenSource();
                try { return await task(token.token); } finally { token.dispose(); } },
            created: async () => { opened = true; },
        };
    });

    test('resolves dependencies in deterministic order without duplicating cycles', () => {
        assert.deepStrictEqual(resolveTemplateSelection(catalog, [catalog.templates[1]]), catalog.templates);
        const cyclic = { ...catalog, templates: catalog.templates.map(template => ({ ...template, requires: [template.id] })) };
        assert.deepStrictEqual(resolveTemplateSelection(cyclic, [cyclic.templates[0]]), [cyclic.templates[0]]);
        assert.throws(() => resolveTemplateSelection({ ...catalog, templates: [catalog.templates[1]] }, [catalog.templates[1]]), /Missing required/);
    });

    test('confirms warning then creates directly without preview or staging requests', async () => {
        await createWorkspace(server, ui);
        assert.deepStrictEqual(commands.map(item => item.command), Object.values(wizardCommands));
        assert.strictEqual(commands[0].request.mode, 'workspace');
        assert.strictEqual(commands[1].request.trustedSources, true);
        assert.strictEqual(commands[1].request.confirmed, true);
        assert.strictEqual(commands[2].request.catalogId, 'catalog');
        assert.ok(opened);
    });

    test('warning cancellation disposes catalog without creating', async () => {
        ui.confirmSources = async () => false;
        await createWorkspace(server, ui);
        assert.deepStrictEqual(commands.map(item => item.command), [wizardCommands.list, wizardCommands.dispose]);
        assert.ok(!opened);
    });

    test('template selection cancellation makes no creation request', async () => {
        ui.templates = async () => undefined;
        await createWorkspace(server, ui);
        assert.deepStrictEqual(commands.map(item => item.command), [wizardCommands.list, wizardCommands.dispose]);
        assert.ok(!opened);
    });

    test('sends fragment mode separately and disposes before opening folder', async () => {
        ui.created = async () => {
            assert.strictEqual(commands[commands.length - 1].command, wizardCommands.dispose);
            opened = true;
        };
        await createWorkspace(server, ui, 'fragment');
        assert.strictEqual(commands[0].request.mode, 'fragment');
        assert.strictEqual(commands[1].request.mode, 'fragment');
        assert.ok(opened);
    });

    test('unsupported servers make no template requests', async () => {
        server.supports = async () => false;
        await assert.rejects(createWorkspace(server, ui), /updated Java/);
        assert.deepStrictEqual(commands, []);
    });

    test('backend failure still disposes catalog', async () => {
        const execute = server.execute;
        server.execute = async (command, args, token) => command === wizardCommands.create
            ? { error: 'Destination changed since preview.' } : execute(command, args, token);
        await assert.rejects(createWorkspace(server, ui), /Destination changed/);
        assert.strictEqual(commands[commands.length - 1]?.command, wizardCommands.dispose);
        assert.ok(!opened);
    });

    test('creates a workspace through the real Java JSON-RPC server', async function () {
        this.timeout(30000);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-wizard-rpc-'));
        const source = path.join(directory, 'source');
        fs.mkdirSync(path.join(source, 'prefix/cnf'), { recursive: true });
        fs.mkdirSync(path.join(source, 'prefix/sample/src/sample'), { recursive: true });
        fs.writeFileSync(path.join(source, 'prefix/cnf/build.bnd'), '# wizard test\njavac.source: 21\njavac.target: 21\n');
        fs.writeFileSync(path.join(source, 'prefix/sample/bnd.bnd'), 'Bundle-SymbolicName: sample\n');
        fs.writeFileSync(path.join(source, 'prefix/sample/src/sample/App.java'), 'package sample; public class App {}\n');
        const archive = path.join(directory, 'template.zip');
        const packaged = cp.spawnSync('jar', ['cf', archive, '-C', source, 'prefix'], { encoding: 'utf8' });
        assert.strictEqual(packaged.status, 0, packaged.stderr);
        const index = path.join(directory, 'index.bnd');
        fs.writeFileSync(index, `-workspace-templates: ${vscode.Uri.file(archive).toString()};name=Smoke\n`);
        const target = path.join(directory, 'workspace');
        const executable = path.resolve(__dirname, '../../../../server/biz.aQute.bnd.lsp.jar');
        const processHandle = cp.spawn('java', ['-jar', executable], { stdio: ['pipe', 'pipe', 'pipe'] });
        processHandle.stderr.on('data', () => {});
        const connection = createMessageConnection(new StreamMessageReader(processHandle.stdout), new StreamMessageWriter(processHandle.stdin));
        connection.onNotification('window/logMessage', () => {});
        connection.listen();
        try {
            const initialized = await connection.sendRequest<{ capabilities: { executeCommandProvider: { commands: string[] } } }>('initialize', {
                processId: process.pid, rootUri: null, capabilities: {}, initializationOptions: { workspaceTrusted: true },
            });
            await connection.sendNotification('initialized', {});
            const backend: WizardServer = {
                supports: async command => initialized.capabilities.executeCommandProvider.commands.includes(command),
                execute: (command, args) => connection.sendRequest('workspace/executeCommand', { command, arguments: args }),
            };
            const nativeCommands = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'))
                .contributes.commands.map((entry: { command: string }) => entry.command);
            for (const command of Object.values(wizardCommands)) assert.ok(!nativeCommands.includes(command), 'Client/server command IDs must not collide');
            await createWorkspace(backend, {
                ...ui,
                target: async () => vscode.Uri.file(target), indexes: async () => [vscode.Uri.file(index).toString()],
                templates: async value => value.templates,
                confirmSources: async templates => {
                    assert.strictEqual(templates[0].name, 'Smoke');
                    assert.ok(!fs.existsSync(target), 'Warning must appear before destination is created');
                    return true;
                },
                created: async root => {
                    // The server reports the canonical path (macOS: /private/var vs /var).
                    assert.strictEqual(path.resolve(root.fsPath), fs.realpathSync(path.resolve(vscode.Uri.file(target).fsPath)));
                    opened = true;
                },
            });
            assert.ok(opened);
            assert.strictEqual(fs.readFileSync(path.join(target, 'sample/bnd.bnd'), 'utf8'), 'Bundle-SymbolicName: sample\n');
            fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
            await createWorkspace(backend, {
                ...ui, target: async () => vscode.Uri.file(target), indexes: async () => [vscode.Uri.file(index).toString()],
                templates: async value => value.templates, confirmSources: async () => true,
            }, 'fragment');
            assert.strictEqual(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
            assert.ok(!fs.readdirSync(directory).some(name => name.startsWith('.bnd-wizard-')));
            await connection.sendRequest('shutdown');
        } finally {
            connection.dispose();
            processHandle.kill();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});

suite('native workspace wizard routing and catalogs', () => {
    const window = vscode.window as unknown as Record<string, unknown>;
    const workspace = vscode.workspace as unknown as Record<string, unknown>;
    const commands = vscode.commands as unknown as Record<string, unknown>;
    const env = vscode.env as unknown as Record<string, unknown>;
    let originals: Record<string, unknown>;
    let originalConfig: unknown;
    let originalExecute: unknown;
    let originalOpenExternal: unknown;
    const root = vscode.Uri.file(path.join(os.tmpdir(), 'selected-workspace'));
    const folder = { uri: root, name: 'Display Name', index: 0 };

    setup(() => {
        originals = { showOpenDialog: window.showOpenDialog, showInputBox: window.showInputBox,
            showWorkspaceFolderPick: window.showWorkspaceFolderPick, showQuickPick: window.showQuickPick,
            showWarningMessage: window.showWarningMessage };
        originalConfig = workspace.getConfiguration;
        originalExecute = commands.executeCommand;
        originalOpenExternal = env.openExternal;
        window.showOpenDialog = async () => { throw new Error('Unexpected directory prompt'); };
        window.showInputBox = async () => { throw new Error('Unexpected name/URL prompt'); };
    });

    teardown(() => {
        Object.assign(window, originals);
        workspace.getConfiguration = originalConfig;
        commands.executeCommand = originalExecute;
        env.openExternal = originalOpenExternal;
    });

    test('uses current root unchanged and never asks for a workspace name', async () => {
        assert.strictEqual((await selectWizardTarget([folder]))?.toString(), root.toString());
        assert.strictEqual((await creationUI('workspace', [folder]).target())?.toString(), root.toString());
    });

    test('asks for exact directory only with no folder and opens it after creation', async () => {
        let prompts = 0;
        window.showOpenDialog = async () => { prompts++; return [root]; };
        const ui = creationUI('fragment', []);
        assert.strictEqual((await ui.target())?.toString(), root.toString());
        assert.strictEqual(prompts, 1);
        const calls: unknown[][] = [];
        commands.executeCommand = async (...args: unknown[]) => { calls.push(args); };
        await ui.created(root);
        assert.deepStrictEqual(calls, [['vscode.openFolder', root, false]]);
        calls.length = 0;
        await creationUI('workspace', [folder]).created(root);
        assert.deepStrictEqual(calls, [['bnd.explorer.refresh']]);
    });

    test('multi-root selects an existing folder and cancellation stops', async () => {
        window.showWorkspaceFolderPick = async () => folder;
        assert.strictEqual((await selectWizardTarget([folder, { ...folder, index: 1 }]))?.toString(), root.toString());
        window.showWorkspaceFolderPick = async () => undefined;
        assert.strictEqual(await selectWizardTarget([folder, { ...folder, index: 1 }]), undefined);
        window.showOpenDialog = async () => undefined;
        assert.strictEqual(await selectWizardTarget([]), undefined);
    });

    test('opens current templates directly with single selection and fragments with multiple selection', async () => {
        const template = { id: 'file:///template.zip', name: 'Current', description: '', official: false, archived: false, requires: [], tags: [] };
        const catalog = { catalogId: 'catalog', templates: [template, { ...template, name: 'Archived', archived: true }] };
        let prompts = 0;
        window.showQuickPick = async (items: { template: unknown }[], options: { canPickMany: boolean }) => {
            prompts++;
            assert.strictEqual(items.length, 1);
            return options.canPickMany ? [items[0]] : items[0];
        };
        assert.deepStrictEqual(await creationUI('workspace', [folder]).templates(catalog), [template]);
        assert.deepStrictEqual(await creationUI('fragment', [folder]).templates(catalog), [template]);
        assert.strictEqual(prompts, 2);
    });

    test('catalog settings are independent and custom URLs persist without duplicates', async () => {
        const values = new Map<string, string[]>();
        const defaultValue = ['https://example.org/default.bnd'];
        workspace.getConfiguration = () => ({
            inspect: (key: string) => ({ defaultValue, globalValue: values.get(key) }),
            get: (key: string) => values.get(key) ?? defaultValue,
            update: async (key: string, value: string[], target: vscode.ConfigurationTarget) => {
                assert.strictEqual(target, vscode.ConfigurationTarget.Global);
                values.set(key, value);
            },
        });
        values.set('wizard.templateIndexes', ['https://example.org/legacy.bnd']);
        assert.deepStrictEqual(configuredTemplateIndexes('workspace'), defaultValue);
        window.showInputBox = async () => 'https://example.org/workspaces.bnd';
        await addTemplateLocation('workspace');
        await addTemplateLocation('workspace');
        assert.deepStrictEqual(configuredTemplateIndexes('workspace'), [...defaultValue, 'https://example.org/workspaces.bnd']);
        assert.deepStrictEqual(configuredTemplateIndexes('fragment'), ['https://example.org/legacy.bnd']);
        window.showInputBox = async () => 'file:///fragments.bnd';
        await addTemplateLocation('fragment');
        assert.deepStrictEqual(values.get(templateIndexSettings.fragment), [...defaultValue, 'file:///fragments.bnd']);
        window.showInputBox = async () => undefined;
        await addTemplateLocation('fragment');
        assert.deepStrictEqual(values.get(templateIndexSettings.fragment), [...defaultValue, 'file:///fragments.bnd']);
        assert.ok(validateTemplateIndex('javascript:bad'));
        assert.ok(validateTemplateIndex('not a URL'));
        assert.strictEqual(validateTemplateIndex('https://example.org/index.bnd'), undefined);
    });

    test('shows one trust and overwrite warning without a preview picker', async () => {
        const template = { id: 'file:///workspace.zip', name: 'Workspace', description: '', official: false,
            archived: false, requires: [], tags: [] };
        const ui = creationUI('workspace', [folder]);
        await ui.target();
        let warnings = 0;
        window.showQuickPick = async () => { throw new Error('Preview picker must not be shown'); };
        window.showWarningMessage = async (message: string, options: { modal: boolean; detail: string }, command: string) => {
            warnings++;
            assert.strictEqual(options.modal, true);
            assert.ok(message.includes('Create workspace'));
            assert.ok(options.detail.includes(root.fsPath));
            assert.ok(options.detail.includes('third-party'));
            assert.ok(options.detail.includes('overwritten'));
            assert.strictEqual(command, 'Create Workspace');
            return command;
        };
        assert.strictEqual(await ui.confirmSources([template]), true);
        assert.strictEqual(warnings, 1);
        window.showWarningMessage = async () => undefined;
        assert.strictEqual(await ui.confirmSources([template]), false);
    });

    test('opens the template source then requires explicit creation confirmation', async () => {
        const template = { id: 'https://github.com/bndtools/bndtools.workspace.min/tree/master/', name: 'Workspace',
            description: '', official: true, archived: false, requires: [], tags: [] };
        const opened: string[] = [];
        env.openExternal = async (uri: vscode.Uri) => { opened.push(uri.toString()); return true; };
        window.showQuickPick = async () => { throw new Error('A single source must not show a picker'); };
        for (const confirmed of [true, false]) {
            let warnings = 0;
            window.showWarningMessage = async (_message: string, _options: unknown, command: string, open: string) => {
                assert.strictEqual(command, 'Create Workspace');
                assert.strictEqual(open, 'Open Template');
                return warnings++ === 0 ? open : confirmed ? command : undefined;
            };
            assert.strictEqual(await creationUI('workspace', [folder]).confirmSources([template]), confirmed);
            assert.strictEqual(warnings, 2);
        }
        assert.deepStrictEqual(opened, [template.id, template.id]);
    });

    test('chooses among fragment sources and returns to confirmation when the picker is canceled', async () => {
        const templates = ['first', 'second'].map(name => ({ id: `https://example.org/${name}`, name,
            description: '', official: false, archived: false, requires: [], tags: [] }));
        const opened: string[] = [];
        env.openExternal = async (uri: vscode.Uri) => { opened.push(uri.toString()); return true; };
        let warnings = 0;
        window.showWarningMessage = async (_message: string, _options: unknown, command: string, open: string) => {
            assert.strictEqual(command, 'Add Fragments');
            return warnings++ < 2 ? open : command;
        };
        let picks = 0;
        window.showQuickPick = async (items: { detail: string }[]) => {
            assert.deepStrictEqual(items.map(item => item.detail), templates.map(template => template.id));
            return picks++ === 0 ? undefined : items[1];
        };
        assert.strictEqual(await creationUI('fragment', [folder]).confirmSources(templates), true);
        assert.strictEqual(warnings, 3);
        assert.deepStrictEqual(opened, [templates[1].id]);
    });

    test('does not offer external opening for invalid or executable source schemes', async () => {
        for (const id of ['not a URL', 'javascript:alert(1)', 'command:workbench.action.closeWindow']) {
            window.showWarningMessage = async (_message: string, _options: unknown, ...buttons: string[]) => {
                assert.deepStrictEqual(buttons, ['Create Workspace']);
                return undefined;
            };
            env.openExternal = async () => { throw new Error('Unsafe sources must not be opened'); };
            assert.strictEqual(await creationUI('workspace', [folder]).confirmSources([
                { id, name: 'Unsafe', description: '', official: false, archived: false, requires: [], tags: [] },
            ]), false);
        }
    });

    test('workspace default is minimal repository and never inherits fragment catalog', () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'));
        const properties = manifest.contributes.configuration.properties;
        assert.deepStrictEqual(properties['bnd.wizard.workspaceTemplateIndexes'].default, [defaultWorkspaceTemplate]);
        assert.deepStrictEqual(properties['bnd.wizard.fragmentTemplateIndexes'].default,
            ['https://raw.githubusercontent.com/bndtools/workspace-templates/master/index.bnd']);
        const oldFragmentIndex = 'https://raw.githubusercontent.com/bndtools/workspace-templates/master/index.bnd';
        workspace.getConfiguration = () => ({
            inspect: (key: string) => ({ globalValue: key === 'wizard.workspaceTemplateIndexes' ? [oldFragmentIndex] : undefined }),
            get: () => [oldFragmentIndex],
        });
        assert.deepStrictEqual(configuredTemplateIndexes('workspace'), [defaultWorkspaceTemplate]);
    });

    test('offers exactly three empty-folder wizards and registers URL commands', async () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'));
        const welcome = manifest.contributes.viewsWelcome.find((entry: { view: string }) => entry.view === 'bnd.explorer');
        assert.strictEqual(welcome.when,
            'workspaceFolderCount == 0 || (workspaceFolderCount > 0 && bnd.explorer.hasBndWorkspace == false)');
        assert.strictEqual((welcome.contents.match(/command:bnd\.wizard\./g) ?? []).length, 3);
        for (const command of ['createWorkspace', 'addFragment', 'importWorkspace']) assert.ok(welcome.contents.includes(`command:bnd.wizard.${command}`));
        await vscode.extensions.getExtension('klibio.bnd')!.activate();
        const registered = await vscode.commands.getCommands(true);
        for (const command of ['createWorkspace', 'addFragment', 'addWorkspaceTemplateUrl', 'addFragmentTemplateUrl']) {
            assert.ok(registered.includes(`bnd.wizard.${command}`));
        }
    });
});