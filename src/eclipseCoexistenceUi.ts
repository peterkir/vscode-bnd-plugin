import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findBndWorkspaces } from './bndRepositories';
import {
    configureTwin,
    detectEclipse,
    eclipseDetectedMessage,
    EclipseInstance,
    EclipseWorkspaceState,
    formatOverride,
    inspectTwinConfiguration,
    isTwinConfigured,
    presentEclipseStatus,
    removeStaleClasspathEntries,
    removeTwin,
    twinConfigurationPath,
    twinOutputDirectories,
} from './eclipseCoexistence';

const dismissedKey = 'bnd.eclipse.dismissed';
const documentation = path.join('docs', 'shared-workspace-conflicts.md');
const documentationUrl = 'https://github.com/peterkir/vscode-bnd-plugin/blob/main/docs/shared-workspace-conflicts.md';
const checkInterval = 30000;

export interface EclipseCoexistence {
    getDetected(): EclipseInstance[];
}

function isBndWorkspaceRoot(root: string): boolean {
    return fs.existsSync(path.join(root, 'cnf', 'build.bnd'));
}

/** Workspace folders that are bnd workspace roots. Checked on a timer, so no file search. */
function openBndWorkspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? [])
        .filter(folder => folder.uri.scheme === 'file' && isBndWorkspaceRoot(folder.uri.fsPath))
        .map(folder => folder.uri.fsPath);
}

function isDetectionEnabled(): boolean {
    return vscode.workspace.getConfiguration('bnd').get<boolean>('eclipse.detect', true);
}

/** The filters the Java language server writes into `.project` files; undefined without Language Support for Java. */
function javaResourceFilters(): string[] | undefined {
    if (!vscode.extensions.getExtension('redhat.java')) return undefined;
    return vscode.workspace.getConfiguration('java').get<string[]>('project.resourceFilters');
}

export function registerEclipseCoexistence(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): EclipseCoexistence {
    // Priority just below the bnd LS item (100), which places it directly to its right.
    const item = vscode.window.createStatusBarItem('bnd.eclipse.status', vscode.StatusBarAlignment.Right, 99);
    item.name = 'Eclipse on bnd workspace';
    item.command = 'bnd.eclipse.menu';
    let states: EclipseWorkspaceState[] = [];
    const notified = new Set<string>();

    const dismissed = () => context.workspaceState.get<string[]>(dismissedKey, []);

    const showDocumentation = async () => {
        const file = context.asAbsolutePath(documentation);
        if (fs.existsSync(file)) await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(file));
        else await vscode.env.openExternal(vscode.Uri.parse(documentationUrl));
    };

    const notify = async (instance: EclipseInstance) => {
        const root = instance.workspaceRoot;
        if (notified.has(root) || dismissed().includes(root)) return;
        notified.add(root);
        const useSeparateOutput = 'Use Separate Output';
        const details = 'Details';
        const dontShowAgain = "Don't Show Again";
        const choice = await vscode.window.showWarningMessage(eclipseDetectedMessage(instance), useSeparateOutput, details, dontShowAgain);
        if (choice === useSeparateOutput) await vscode.commands.executeCommand('bnd.eclipse.configureTwin', root);
        else if (choice === details) await showDocumentation();
        else if (choice === dontShowAgain) await context.workspaceState.update(dismissedKey, [...new Set([...dismissed(), root])]);
    };

    const refresh = () => {
        states = [];
        if (isDetectionEnabled()) {
            for (const root of openBndWorkspaceRoots()) {
                const instance = detectEclipse(root);
                if (instance) states.push({ instance, configured: isTwinConfigured(root) });
            }
        }
        const view = presentEclipseStatus(states);
        item.text = view.text;
        item.tooltip = view.tooltip;
        item.backgroundColor = view.warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
        if (view.visible) item.show();
        else item.hide();
        for (const state of states) if (!state.configured) void notify(state.instance);
    };

    const pickRoot = async (target?: string | vscode.Uri): Promise<string | undefined> => {
        if (target) {
            const root = typeof target === 'string' ? target : target.fsPath;
            if (isBndWorkspaceRoot(root)) return root;
            void vscode.window.showWarningMessage(`${root} is not a bnd workspace: cnf/build.bnd is missing.`);
            return undefined;
        }
        let roots = openBndWorkspaceRoots();
        if (!roots.length) roots = (await findBndWorkspaces()).filter(uri => uri.scheme === 'file').map(uri => uri.fsPath);
        if (!roots.length) {
            void vscode.window.showWarningMessage('No bnd workspace found. Open a folder that contains cnf/build.bnd.');
            return undefined;
        }
        if (roots.length === 1) return roots[0];
        const picked = await vscode.window.showQuickPick(
            roots.map(root => ({ label: path.basename(root), description: root, root })),
            { title: 'Configure Parallel Use with Eclipse', placeHolder: 'Select the bnd workspace' });
        return picked?.root;
    };

    const logFollowUp = (root: string, file: string, cleaned: string[], javaFiltersCleared: boolean) => {
        const inspection = inspectTwinConfiguration(root);
        const lines = [
            `Parallel use with Eclipse: created ${file}`,
            `  VS Code now writes ${twinOutputDirectories.join(', ')}. Eclipse Bndtools, the bnd CLI and Gradle keep bin, bin_test and generated.`,
            `  Add ${twinOutputDirectories.map(directory => `${directory}/`).join(', ')} to .gitignore.`,
            '  If Java output still goes to bin, run "Java: Clean Java Language Server Workspace" once.',
        ];
        if (javaFiltersCleared) {
            lines.push('  Set java.project.resourceFilters to [] in the workspace settings: the Java language server no longer adds a resource filter to .project files.');
        }
        if (cleaned.length) {
            lines.push('  Removed the classpath container org.bndtools.jdtls.BND_CONTAINER from:', ...cleaned.map(entry => `    ${entry}`));
        }
        if (inspection.projectOverrides.length) {
            lines.push('  These projects define their own output directories and keep them in both IDEs:',
                ...inspection.projectOverrides.map(override => `    ${formatOverride(override)}`));
        }
        if (inspection.sharedLaunchStorage.length) {
            lines.push('  These launches still share runtime storage between the IDEs. Use ${driver} or ${target-dir} in their storage directories:',
                ...inspection.sharedLaunchStorage.map(launch => `    ${launch}`));
        }
        lines.forEach(line => outputChannel.appendLine(line));
    };

    const configure = async (target?: string | vscode.Uri) => {
        const root = await pickRoot(target);
        if (!root) return;
        const name = path.basename(root);
        try {
            const inspection = inspectTwinConfiguration(root);
            if (inspection.configured) {
                const remove = 'Remove';
                const choice = await vscode.window.showWarningMessage(
                    `VS Code already uses separate output directories in ${name}. Remove ${twinConfigurationPath}?`,
                    {
                        modal: true,
                        detail: 'VS Code then writes bin, bin_test and generated again, the same directories as Eclipse. '
                            + `The directories ${twinOutputDirectories.join(', ')} are not deleted.`,
                    }, remove);
                if (choice !== remove) return;
                removeTwin(root);
                // The user just chose the shared output; do not ask again in this session.
                notified.add(root);
                outputChannel.appendLine(`Parallel use with Eclipse: removed ${path.join(root, ...twinConfigurationPath.split('/'))}`);
                void vscode.window.showInformationMessage(`Removed ${twinConfigurationPath} from ${name}. VS Code and Eclipse write the same build output again.`);
                return;
            }
            const refuse = (overrides = inspection.workspaceOverrides) => vscode.window.showErrorMessage(
                `Cannot configure separate output for ${name}: the workspace already defines output directories in `
                + `${overrides.map(formatOverride).join(', ')}. Nothing was written. Remove these definitions or route them by \${driver} there.`);
            if (inspection.workspaceOverrides.length) {
                void refuse();
                return;
            }
            const create = 'Create';
            const javaFilters = javaResourceFilters();
            const choice = await vscode.window.showInformationMessage(
                `Create ${twinConfigurationPath} in ${name}?`,
                {
                    modal: true,
                    detail: `${path.join(root, ...twinConfigurationPath.split('/'))}\n\n`
                        + `VS Code (bnd Language Server and Java project import) then uses ${twinOutputDirectories.join(', ')}. `
                        + 'Eclipse Bndtools, the bnd CLI and Gradle are unchanged and keep bin, bin_test and generated.'
                        + (javaFilters?.length
                            ? '\n\nAlso sets java.project.resourceFilters to [] in the workspace settings, so the Java language server stops adding a resource filter to the Eclipse .project files.'
                            : '')
                        + (inspection.staleClasspaths.length
                            ? `\n\nAlso removes the classpath container of earlier extension versions, which Eclipse cannot resolve, from: ${inspection.staleClasspaths.join(', ')}.`
                            : ''),
                }, create);
            if (choice !== create) return;
            const result = configureTwin(root);
            if (result.refused) {
                void refuse(result.workspaceOverrides);
                return;
            }
            const cleaned = removeStaleClasspathEntries(root);
            if (javaFilters?.length) {
                await vscode.workspace.getConfiguration('java').update('project.resourceFilters', [], vscode.ConfigurationTarget.Workspace);
            }
            logFollowUp(root, result.file, cleaned, !!javaFilters?.length);
            const showOutput = 'Show Output';
            void vscode.window.showInformationMessage(
                `VS Code now uses separate output directories in ${name}. See the bnd Language Server output for follow-up steps.`, showOutput)
                .then(action => { if (action === showOutput) outputChannel.show(); });
        } catch (error) {
            void vscode.window.showErrorMessage(`Parallel use with Eclipse failed: ${error instanceof Error ? error.message : error}`);
        } finally {
            refresh();
        }
    };

    const menu = async () => {
        const roots = openBndWorkspaceRoots();
        const configured = roots.length > 0 && roots.every(isTwinConfigured);
        const serverEnabled = vscode.workspace.getConfiguration('bnd').get<boolean>('server.enabled', true);
        const actions = [
            {
                label: configured ? '$(discard) Remove Separate Output...' : '$(split-horizontal) Use Separate Output...',
                run: () => vscode.commands.executeCommand('bnd.eclipse.configureTwin'),
            },
            {
                label: serverEnabled ? '$(circle-slash) Disable bnd Language Server' : '$(play) Enable bnd Language Server',
                run: () => vscode.commands.executeCommand('bnd.server.toggle'),
            },
            { label: '$(book) Open Documentation', run: showDocumentation },
            { label: '$(output) Show Output', run: () => outputChannel.show() },
        ];
        const choice = await vscode.window.showQuickPick(actions, { title: presentEclipseStatus(states).tooltip });
        await choice?.run();
    };

    const lockWatcher = vscode.workspace.createFileSystemWatcher('**/.metadata/.lock_info');
    const twinWatcher = vscode.workspace.createFileSystemWatcher(`**/${twinConfigurationPath}`);
    // The Eclipse process can exit without touching .lock_info.
    const timer = setInterval(refresh, checkInterval);
    context.subscriptions.push(
        item,
        lockWatcher,
        twinWatcher,
        ...[lockWatcher, twinWatcher].flatMap(watcher =>
            [watcher.onDidCreate(refresh), watcher.onDidChange(refresh), watcher.onDidDelete(refresh)]),
        { dispose: () => clearInterval(timer) },
        vscode.workspace.onDidChangeWorkspaceFolders(refresh),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('bnd.eclipse.detect')) refresh();
        }),
        vscode.commands.registerCommand('bnd.eclipse.configureTwin', configure),
        vscode.commands.registerCommand('bnd.eclipse.menu', menu),
    );
    refresh();
    return { getDetected: () => states.map(state => state.instance) };
}
