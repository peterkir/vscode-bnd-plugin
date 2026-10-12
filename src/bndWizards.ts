import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export type ImportAction = 'current' | 'new' | 'add';
export type WorkspaceWizardMode = 'workspace' | 'fragment';

export const templateIndexSettings = {
    workspace: 'wizard.workspaceTemplateIndexes', fragment: 'wizard.fragmentTemplateIndexes',
} as const;

export const defaultWorkspaceTemplate = 'https://github.com/bndtools/bndtools.workspace.min';
const defaultFragmentIndex = 'https://raw.githubusercontent.com/bndtools/workspace-templates/master/index.bnd';

export const wizardCommands = {
    list: 'bnd.wizard.templates.list', create: 'bnd.wizard.create', dispose: 'bnd.wizard.plan.dispose',
} as const;

export interface WizardServer {
    supports(command: string): Promise<boolean>;
    execute(command: string, args: unknown[], token?: vscode.CancellationToken): Promise<unknown>;
}

export interface WorkspaceTemplate {
    id: string; name: string; description: string; archived: boolean; official: boolean;
    requires: string[]; tags: string[];
}

export interface WorkspaceCatalog { catalogId: string; templates: WorkspaceTemplate[] }

export interface WorkspaceCreationUI {
    target(): Promise<vscode.Uri | undefined>;
    indexes(): Promise<string[] | undefined>;
    templates(catalog: WorkspaceCatalog): Promise<WorkspaceTemplate[] | undefined>;
    confirmSources(templates: WorkspaceTemplate[]): Promise<boolean>;
    progress<T>(title: string, task: (token: vscode.CancellationToken) => Promise<T>): Promise<T>;
    created(root: vscode.Uri): Promise<void>;
}

async function wizardRequest<T>(server: WizardServer, command: string, request: unknown,
    token?: vscode.CancellationToken): Promise<T> {
    const result = await server.execute(command, [request], token);
    if (!result || typeof result !== 'object') throw new Error('Incompatible workspace wizard response.');
    if ('error' in result) throw new Error(String(result.error));
    return result as T;
}

export function resolveTemplateSelection(catalog: WorkspaceCatalog, selected: WorkspaceTemplate[]): WorkspaceTemplate[] {
    const result: WorkspaceTemplate[] = [];
    const seen = new Set<string>();
    const visit = (template: WorkspaceTemplate) => {
        if (seen.has(template.id)) return;
        seen.add(template.id);
        for (const required of template.requires) {
            const dependency = catalog.templates.find(candidate => candidate.id === required);
            if (!dependency) throw new Error(`Missing required fragment: ${required}`);
            visit(dependency);
        }
        result.push(template);
    };
    selected.forEach(visit);
    return result;
}

export async function createWorkspace(server: WizardServer, ui: WorkspaceCreationUI, mode: WorkspaceWizardMode = 'workspace'): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('Workspace creation requires a trusted window.');
    for (const command of Object.values(wizardCommands)) {
        if (!(await server.supports(command))) throw new Error('Workspace creation requires an updated Java bnd Language Server. Node and older servers do not support it.');
    }
    const target = await ui.target();
    if (!target) return;
    const indexes = await ui.indexes();
    if (!indexes) return;
    let catalog: WorkspaceCatalog | undefined;
    let createdRoot: vscode.Uri | undefined;
    try {
        catalog = await ui.progress(mode === 'workspace' ? 'Load workspace templates' : 'Load workspace fragments',
            token => wizardRequest<WorkspaceCatalog>(server, wizardCommands.list, { indexes, mode }, token));
        const selected = await ui.templates(catalog);
        if (!selected?.length) return;
        const resolved = resolveTemplateSelection(catalog, selected);
        if (!(await ui.confirmSources(resolved))) return;
        const result = await ui.progress(mode === 'workspace' ? 'Create bnd workspace' : 'Add workspace fragments',
            token => wizardRequest<{ targetUri: string }>(server, wizardCommands.create, {
                catalogId: catalog!.catalogId, targetUri: target.toString(), templates: selected.map(template => template.id),
                trustedSources: true, compose: true, confirmed: true, mode,
                dirtyUris: vscode.workspace.textDocuments.filter(document => document.isDirty && document.uri.scheme === 'file')
                    .map(document => document.uri.toString()),
            }, token));
        createdRoot = vscode.Uri.parse(result.targetUri);
    } finally {
        if (catalog) await wizardRequest(server, wizardCommands.dispose, { catalogId: catalog.catalogId });
    }
    if (createdRoot) await ui.created(createdRoot);
}

export interface WorkspaceImportUI {
    pickFolder(): Promise<vscode.Uri | undefined>;
    pickAction(root: vscode.Uri): Promise<ImportAction | undefined>;
    folders(): readonly vscode.Uri[];
    open(root: vscode.Uri, newWindow: boolean): Promise<void>;
    add(root: vscode.Uri): boolean;
}

export async function validateWorkspaceFolder(folder: vscode.Uri): Promise<vscode.Uri> {
    if (folder.scheme !== 'file') throw new Error('Import requires a folder on the extension host file system.');
    const root = await fs.realpath(folder.fsPath);
    const configuration = await fs.stat(path.join(root, 'cnf', 'build.bnd')).catch(() => undefined);
    if (!configuration?.isFile()) throw new Error('Select a bnd workspace root containing cnf/build.bnd.');
    return vscode.Uri.file(root);
}

async function sameFolder(left: vscode.Uri, right: vscode.Uri): Promise<boolean> {
    if (left.scheme !== 'file' || right.scheme !== 'file') return false;
    const canonical = await fs.realpath(left.fsPath).catch(() => left.fsPath);
    return process.platform === 'win32'
        ? canonical.toLowerCase() === right.fsPath.toLowerCase()
        : canonical === right.fsPath;
}

export async function importWorkspace(ui: WorkspaceImportUI): Promise<void> {
    const folder = await ui.pickFolder();
    if (!folder) return;
    const root = await validateWorkspaceFolder(folder);
    const action = await ui.pickAction(root);
    if (!action) return;
    if (action === 'add') {
        for (const existing of ui.folders()) {
            if (await sameFolder(existing, root)) return;
        }
        if (!ui.add(root)) throw new Error('VS Code could not add the bnd workspace folder.');
    } else {
        await ui.open(root, action === 'new');
    }
}

const importUI: WorkspaceImportUI = {
    pickFolder: async () => (await vscode.window.showOpenDialog({
        title: 'Import bnd Workspace', openLabel: 'Select Workspace',
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
    }))?.[0],
    pickAction: async root => (await vscode.window.showQuickPick([
        { label: 'Open in Current Window', action: 'current' as const },
        { label: 'Open in New Window', action: 'new' as const },
        { label: 'Add to Current Workspace', action: 'add' as const },
    ], { title: 'Import bnd Workspace', placeHolder: root.fsPath }))?.action,
    folders: () => vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? [],
    open: async (root, newWindow) => { await vscode.commands.executeCommand('vscode.openFolder', root, newWindow); },
    add: root => vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri: root }),
};

export async function selectWizardTarget(folders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? []): Promise<vscode.Uri | undefined> {
    const folder = folders.length === 1 ? folders[0].uri : folders.length > 1
        ? (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Select the workspace folder to use' }))?.uri
        : (await vscode.window.showOpenDialog({ title: 'Workspace Directory', openLabel: 'Use This Directory',
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false }))?.[0];
    if (folder && folder.scheme !== 'file') throw new Error('Creation requires a folder on the extension host file system.');
    return folder;
}

export function configuredTemplateIndexes(mode: WorkspaceWizardMode, resource?: vscode.Uri): string[] {
    const config = vscode.workspace.getConfiguration('bnd', resource);
    const setting = config.inspect<string[]>(templateIndexSettings[mode]);
    if (setting?.workspaceFolderValue !== undefined || setting?.workspaceValue !== undefined || setting?.globalValue !== undefined) {
        const locations = config.get<string[]>(templateIndexSettings[mode], []);
        return mode === 'workspace' ? [...new Set(locations.map(location => location === defaultFragmentIndex ? defaultWorkspaceTemplate : location))] : locations;
    }
    const legacy = config.inspect<string[]>('wizard.templateIndexes');
    if (mode === 'fragment' && (legacy?.workspaceFolderValue !== undefined || legacy?.workspaceValue !== undefined || legacy?.globalValue !== undefined)) {
        return config.get<string[]>('wizard.templateIndexes', []);
    }
    return config.get<string[]>(templateIndexSettings[mode], []);
}

export function validateTemplateIndex(value: string): string | undefined {
    try { return ['https:', 'http:', 'file:'].includes(new URL(value).protocol) ? undefined : 'Use an HTTP(S) or file URI.'; }
    catch { return 'Enter a valid template index URL.'; }
}

export async function addTemplateLocation(mode: WorkspaceWizardMode): Promise<void> {
    const index = await vscode.window.showInputBox({ title: mode === 'workspace' ? 'Add Workspace Template URL' : 'Add Fragment Template URL',
        prompt: mode === 'workspace' ? 'GitHub workspace-template repository, ZIP archive, or .bnd workspace catalog URL'
            : 'HTTP(S) or file URI of a fragment index.bnd', validateInput: value => validateTemplateIndex(value.trim()) });
    if (index === undefined) return;
    const value = index.trim();
    const error = validateTemplateIndex(value);
    if (error) throw new Error(error);
    const config = vscode.workspace.getConfiguration('bnd');
    const values = config.inspect<string[]>(templateIndexSettings[mode])?.globalValue
        ?? config.inspect<string[]>(templateIndexSettings[mode])?.defaultValue ?? [];
    if (!values.includes(value)) await config.update(templateIndexSettings[mode], [...values, value], vscode.ConfigurationTarget.Global);
}

export function creationUI(mode: WorkspaceWizardMode = 'workspace',
    folders: readonly vscode.WorkspaceFolder[] = vscode.workspace.workspaceFolders ?? []): WorkspaceCreationUI {
    let target: vscode.Uri | undefined;
    const openAfterCreation = !folders.length;
    return {
        target: async () => {
            target = await selectWizardTarget(folders);
            return target;
        },
        indexes: async () => configuredTemplateIndexes(mode, target),
        templates: async catalog => {
            const items = catalog.templates
                .filter(template => !template.archived)
                .map(template => ({ label: template.name, description: template.tags.join(', '),
                    detail: `${template.description}\n${template.id}`, template }));
            if (!items.length) throw new Error('No current templates found. Add a template index URL or update the catalog settings.');
            if (mode === 'workspace') {
                const chosen = await vscode.window.showQuickPick(items, { title: 'Create New Workspace From Template', canPickMany: false });
                return chosen ? [chosen.template] : undefined;
            }
            const chosen = await vscode.window.showQuickPick(items, { title: 'Add Fragment to (New) Workspace', canPickMany: true });
            return chosen?.map(item => item.template);
        },
        confirmSources: async templates => {
            const thirdParty = templates.filter(template => !template.official);
            const command = mode === 'workspace' ? 'Create Workspace' : 'Add Fragments';
            const sources = templates.flatMap(template => {
                try {
                    const url = new URL(template.id);
                    return ['https:', 'http:', 'file:'].includes(url.protocol)
                        ? [{ label: template.name, detail: template.id, uri: vscode.Uri.parse(url.toString()) }] : [];
                } catch { return []; }
            });
            const options = {
                modal: true, detail: `${target?.fsPath ?? ''}\n\n` + templates.map(template => `${template.name}: ${template.id}`).join('\n')
                    + '\n\nTemplates can evaluate bnd macros and add executable build instructions. Only continue with trusted sources.'
                    + (thirdParty.length ? `\n${thirdParty.length} third-party fragment(s) included.` : '')
                    + '\nExisting files supplied by the templates may be overwritten. Append actions preserve existing content.'
                    + '\nMultiple fragments are composed in dependency order, not automatically merged. No build will be started.',
            };
            while (true) {
                const choice = await vscode.window.showWarningMessage(
                    mode === 'workspace' ? 'Create workspace from this template?' : 'Add these workspace fragments?',
                    options, command, ...(sources.length ? ['Open Template'] : []));
                if (choice !== 'Open Template') return choice === command;
                const source = sources.length === 1 ? sources[0]
                    : await vscode.window.showQuickPick(sources, { title: 'Open Template Source' });
                if (source) await vscode.env.openExternal(source.uri);
            }
        },
        progress: (title, task) => Promise.resolve(vscode.window.withProgress({ title, location: vscode.ProgressLocation.Notification },
            (_progress, token) => task(token))),
        created: async root => {
            if (openAfterCreation) await vscode.commands.executeCommand('vscode.openFolder', root, false);
            else await vscode.commands.executeCommand('bnd.explorer.refresh');
        },
    };
}

export function registerWorkspaceWizards(context: vscode.ExtensionContext, server: WizardServer): void {
    for (const [command, mode] of [['bnd.wizard.createWorkspace', 'workspace'], ['bnd.wizard.addFragment', 'fragment']] as const) {
        context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
            try { await createWorkspace(server, creationUI(mode), mode); }
            catch (error) { await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
        }));
    }
    for (const [command, mode] of [['bnd.wizard.addWorkspaceTemplateUrl', 'workspace'], ['bnd.wizard.addFragmentTemplateUrl', 'fragment']] as const) {
        context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
            try { await addTemplateLocation(mode); }
            catch (error) { await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
        }));
    }
    context.subscriptions.push(vscode.commands.registerCommand('bnd.wizard.importWorkspace', async () => {
        try {
            await importWorkspace(importUI);
        } catch (error) {
            await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }));
}