import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJsonCommand {
    command: string;
    title: string;
    category?: string;
}

suite('Extension manifest', () => {
    const workspaceRoot = path.resolve(__dirname, '../../../../');
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    const languageConfigPath = path.join(workspaceRoot, 'language-configuration.json');

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
            'bnd.launch.prepare',
            'bnd.launch.dispose',
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
});
