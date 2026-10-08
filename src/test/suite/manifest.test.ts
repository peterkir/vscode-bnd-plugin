import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveBndrunUri } from '../../extension';
import { registerCliPaletteVisibility } from '../../bndCliCommands';

interface PackageJsonCommand {
    command: string;
    title: string;
    category?: string;
}

suite('Extension manifest', () => {
    const workspaceRoot = path.resolve(__dirname, '../../../../');
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    const languageConfigPath = path.join(workspaceRoot, 'language-configuration.json');

    test('offers run and debug on launch files in the bnd Explorer', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const commands = pkg.contributes.menus['view/item/context']
            .filter((item: { when: string }) => item.when === 'view == bnd.explorer && viewItem =~ /\\blaunch\\b/')
            .map((item: { command: string }) => item.command);
        assert.deepStrictEqual(commands, ['bnd.launch.run', 'bnd.launch.debug', 'bnd.launch.runTests', 'bnd.launch.debugTests']);
    });

    test('separates CLI palette commands and keeps the visibility toggle available', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const commands = pkg.contributes.commands.filter((entry: PackageJsonCommand) => entry.command.startsWith('bnd.cli.'));
        assert.ok(commands.some((entry: PackageJsonCommand) => entry.command === 'bnd.cli.toggleCommands'));
        for (const command of commands) {
            assert.strictEqual(command.category, 'bnd-cli', command.command);
            const menu = pkg.contributes.menus.commandPalette.find((entry: { command: string }) => entry.command === command.command);
            assert.ok(menu, command.command);
            assert.strictEqual(menu.when, command.command === 'bnd.cli.toggleCommands' ? undefined : 'bnd.cli.commandsVisible');
        }
        for (const command of pkg.contributes.commands.filter((entry: PackageJsonCommand) =>
            entry.command.startsWith('bnd.lsp.') || entry.command.startsWith('bnd.server.'))) {
            assert.strictEqual(command.category, 'bnd', command.command);
        }
        const setting = pkg.contributes.configuration.properties['bnd.cli.showCommands'];
        assert.strictEqual(setting.type, 'boolean');
        assert.strictEqual(setting.default, false);
        assert.strictEqual(setting.scope, 'application');
    });

    test('persists CLI palette visibility without writing User settings and restores it on activation', async () => {
        const preferences = new Map<string, unknown>();
        const globalState: vscode.ExtensionContext['globalState'] = {
            setKeysForSync: () => {},
            keys: () => [...preferences.keys()],
            get: <T>(key: string, fallback?: T) => (preferences.get(key) ?? fallback) as T,
            update: async (key: string, value: unknown) => { preferences.set(key, value); },
        };
        const subscriptions: vscode.Disposable[] = [];
        const commands = vscode.commands as unknown as Record<string, unknown>;
        const workspace = vscode.workspace as unknown as Record<string, unknown>;
        const originals = {
            registerCommand: commands.registerCommand, executeCommand: commands.executeCommand,
            getConfiguration: workspace.getConfiguration,
        };
        let toggle: (() => Promise<void>) | undefined;
        let visible: unknown;
        let configuredDefault: boolean | undefined;
        commands.registerCommand = (command: string, handler: () => Promise<void>) => {
            assert.strictEqual(command, 'bnd.cli.toggleCommands');
            toggle = handler;
            return new vscode.Disposable(() => { toggle = undefined; });
        };
        commands.executeCommand = async (command: string, key: string, value: unknown) => {
            assert.strictEqual(command, 'setContext');
            assert.strictEqual(key, 'bnd.cli.commandsVisible');
            visible = value;
        };
        workspace.getConfiguration = () => ({
            get: (_key: string, fallback: boolean) => configuredDefault ?? fallback,
            update: () => { throw new Error('Unable to write into user settings.'); },
        });
        try {
            registerCliPaletteVisibility({ globalState, subscriptions });
            assert.strictEqual(visible, false);
            await toggle!();
            assert.strictEqual(preferences.get('bnd.cli.showCommands'), true);
            assert.strictEqual(visible, true);
            subscriptions.splice(0).forEach(subscription => subscription.dispose());
            registerCliPaletteVisibility({ globalState, subscriptions });
            assert.strictEqual(visible, true);
            await toggle!();
            assert.strictEqual(preferences.get('bnd.cli.showCommands'), false);
            assert.strictEqual(visible, false);
            subscriptions.splice(0).forEach(subscription => subscription.dispose());
            preferences.clear();
            configuredDefault = true;
            registerCliPaletteVisibility({ globalState, subscriptions });
            assert.strictEqual(visible, true);
            await toggle!();
            assert.strictEqual(preferences.get('bnd.cli.showCommands'), false);
            assert.strictEqual(visible, false);
        } finally {
            subscriptions.forEach(subscription => subscription.dispose());
            Object.assign(commands, { registerCommand: originals.registerCommand, executeCommand: originals.executeCommand });
            workspace.getConfiguration = originals.getConfiguration;
        }
    });

    test('uses the dedicated bnd Activity Bar icon', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const container = pkg.contributes.viewsContainers.activitybar.find((item: { id: string }) => item.id === 'bnd');
        assert.strictEqual(container.icon, 'media/bndtools.svg');
        assert.ok(fs.existsSync(path.join(workspaceRoot, container.icon)));
    });

    test('passes Windows bndrun URIs with a literal drive colon to Java resolve', () => {
        const uri = vscode.Uri.parse('file:///c%3A/workspace/my%20app/launch.bndrun');
        assert.strictEqual(resolveBndrunUri(uri), 'file:///c:/workspace/my%20app/launch.bndrun');
        assert.strictEqual(resolveBndrunUri(vscode.Uri.parse('file:///workspace/launch.bndrun')),
            'file:///workspace/launch.bndrun');
    });

    test('contains expected bnd command contributions', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            contributes?: { commands?: PackageJsonCommand[] };
        };

        const commands = new Set(
            (pkg.contributes?.commands ?? []).map(entry => entry.command)
        );

        const expected = [
            'bnd.showEffective',
            'bnd.showEffectiveToSide',
            'bnd.openSource',
            'bnd.showEffectiveSource',
            'bnd.cli.build',
            'bnd.cli.run',
            'bnd.cli.test',
            'bnd.cli.runtests',
            'bnd.cli.resolve',
            'bnd.cli.clean',
            'bnd.cli.baseline',
            'bnd.cli.verify',
            'bnd.cli.print',
            'bnd.cli.diff',
            'bnd.cli.wrap',
            'bnd.cli.export',
            'bnd.cli.release',
            'bnd.cli.properties',
            'bnd.cli.info',
            'bnd.cli.version',
            'bnd.cli.macro',
            'bnd.cli.repo',
            'bnd.lsp.resolve',
            'bnd.lsp.buildProject',
            'bnd.lsp.expandMacro',
            'bnd.launch.run',
            'bnd.launch.debug',
            'bnd.launch.runTests',
            'bnd.launch.debugTests',
        ];

        const missing = expected.filter(name => !commands.has(name));
        assert.deepStrictEqual(
            missing,
            [],
            `Missing command contributions: ${missing.join(', ')}`,
        );
    });

    test('keeps client wrapper commands distinct from server commands', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            contributes?: { commands?: PackageJsonCommand[] };
        };
        const commands = new Set(
            (pkg.contributes?.commands ?? []).map(entry => entry.command)
        );
        const serverCommands = [
            'bnd.resolve',
            'bnd.build.project',
            'bnd.macro.expand',
            'bnd.properties.effective',
            'bnd.resolution.analyze',
            'bnd.jar.print',
            'bnd.jar.printText',
            'bnd.launch.prepare',
            'bnd.launch.dispose',
            'bnd.repositories.list',
            'bnd.repositories.bundles',
            'bnd.repositories.versions',
            'bnd.repositories.feature',
            'bnd.repositories.get',
            'bnd.repositories.search',
            'bnd.repositories.listActions',
            'bnd.repositories.runAction',
            'bnd.repositories.reload',
            'bnd.repositories.put',
            'bnd.repositories.fetch',
            'bnd.workspace.offline',
        ];

        const collisions = serverCommands.filter(command => commands.has(command));
        assert.deepStrictEqual(
            collisions,
            [],
            `Client commands collide with language-server commands: ${collisions.join(', ')}`,
        );
    });

    test('uses expected bnd language comment syntax', () => {
        const config = JSON.parse(fs.readFileSync(languageConfigPath, 'utf8')) as {
            comments?: { lineComment?: string };
            brackets?: [string, string][];
        };

        assert.strictEqual(config.comments?.lineComment, '#');
        assert.ok(
            (config.brackets ?? []).some(pair => pair[0] === '{' && pair[1] === '}'),
            'Expected {} bracket pair in language configuration',
        );
    });

    test('contributes the bnd debugger for bnd files', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const debuggerEntry = pkg.contributes.debuggers.find((item: { type: string }) => item.type === 'bnd');
        assert.ok(debuggerEntry, 'Expected bnd debugger contribution');
        assert.deepStrictEqual(debuggerEntry.languages, ['bnd']);
        const attributes = debuggerEntry.configurationAttributes.launch;
        assert.deepStrictEqual(attributes.required, ['target']);
        assert.deepStrictEqual(attributes.properties.kind.enum, ['run', 'test']);
        assert.strictEqual(pkg.contributes.configuration.properties['bnd.launch.codeLens'].default, true);
        const runMenu = pkg.contributes.menus['editor/title/run'].map((item: { command: string }) => item.command);
        assert.deepStrictEqual(runMenu, ['bnd.launch.run', 'bnd.launch.debug', 'bnd.launch.runTests', 'bnd.launch.debugTests']);
    });

    test('ships the native bnd JDT LS adapter', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        assert.deepStrictEqual(pkg.contributes.javaExtensions, ['./server/jdtls/org.bndtools.jdtls.adapter.jar']);
        for (const jar of pkg.contributes.javaExtensions) {
            assert.ok(fs.existsSync(path.join(workspaceRoot, jar)), `Missing Java extension ${jar}`);
        }
    });

    test('Effective is optional and does not replace the default source editor', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const editor = pkg.contributes.customEditors.find((item: { viewType: string }) => item.viewType === 'bnd.effective');
        assert.strictEqual(editor.priority, 'option');
        assert.deepStrictEqual(editor.selector.map((item: { filenamePattern: string }) => item.filenamePattern), ['*.bnd', '*.bndrun']);
        assert.ok(pkg.contributes.menus['editor/title'].some((item: { command: string }) => item.command === 'bnd.showEffective'));
    });

    test('JAR viewer is the default editor for JAR files with context menus', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const editor = pkg.contributes.customEditors.find((item: { viewType: string }) => item.viewType === 'bnd.jarViewer');
        assert.strictEqual(editor.priority, 'default');
        assert.deepStrictEqual(editor.selector, [{ filenamePattern: '*.jar' }]);
        assert.ok(pkg.activationEvents.includes('onFileSystem:bnd-jar'));
        for (const menu of ['explorer/context', 'view/item/context']) {
            assert.ok(pkg.contributes.menus[menu].some((item: { command: string }) => item.command === 'bnd.jar.open'), menu);
        }
    });
});
