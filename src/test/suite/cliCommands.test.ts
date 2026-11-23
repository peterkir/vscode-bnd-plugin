import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Interaction } from './interaction';

type Answer<T> = (items: readonly T[]) => T | readonly T[] | undefined;
const first = <T>(items: readonly T[]) => items[0];
const pick = (label: string): Answer<{ label: string }> => items => items.find(item => item.label === label);

suite('bnd-cli: commands', function () {
    this.timeout(60000);
    const settings = vscode.workspace.getConfiguration('bnd');
    const keys = ['cli.javaExecutable', 'cli.executable'] as const;
    const saved = new Map(keys.map(key => [key, settings.inspect<string>(key)?.globalValue]));
    let ui: Interaction;
    let temporary: string;
    let javaHome: string;

    const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);
    const bndrun = (content = '') => {
        const file = path.join(temporary, 'app.bndrun');
        fs.writeFileSync(file, content);
        return vscode.Uri.file(file);
    };

    suiteSetup(async () => {
        await vscode.extensions.getExtension('klibio.bnd')!.activate();
    });
    setup(async () => {
        temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-cli-commands-'));
        javaHome = path.join(temporary, 'jdk');
        fs.mkdirSync(path.join(javaHome, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '');
        await settings.update('cli.javaExecutable', path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), vscode.ConfigurationTarget.Global);
        await settings.update('cli.executable', 'bnd', vscode.ConfigurationTarget.Global);
        ui = new Interaction();
        ui.install();
    });
    teardown(async () => {
        ui.restore();
        for (const key of keys) await settings.update(key, saved.get(key), vscode.ConfigurationTarget.Global);
        fs.rmSync(temporary, { recursive: true, force: true });
    });

    test('runs the argument-less commands in a terminal with the configured Java runtime', async () => {
        for (const [command, expected] of [
            ['bnd.cli.test', 'bnd test'], ['bnd.cli.clean', 'bnd clean'], ['bnd.cli.baseline', 'bnd baseline'],
            ['bnd.cli.properties', 'bnd properties'], ['bnd.cli.info', 'bnd info'], ['bnd.cli.version', 'bnd version'],
        ]) {
            ui.terminals.length = 0;
            await run(command);
            assert.strictEqual(await ui.command(), expected, command);
        }
        const environment = ui.terminals[0].options.env!;
        assert.strictEqual(environment.JAVA_HOME, javaHome);
        assert.ok(String(environment.PATH).startsWith(path.join(javaHome, 'bin')));
        assert.strictEqual(ui.terminals[0].options.name, 'bnd');
    });

    test('offers the build modes', async () => {
        ui.picks.push(pick('Build for test'));
        await run('bnd.cli.build');
        assert.strictEqual(await ui.command(), 'bnd build --test');

        ui.terminals.length = 0;
        ui.picks.push(() => undefined);
        await run('bnd.cli.build');
        await ui.noTerminal();
    });

    test('runs, tests, resolves and exports the given .bndrun file', async () => {
        const uri = bndrun();
        const relative = vscode.workspace.asRelativePath(uri);
        for (const [command, expected] of [
            ['bnd.cli.run', `bnd run ${relative}`], ['bnd.cli.runtests', `bnd runtests ${relative}`],
            ['bnd.cli.resolve', `bnd resolve resolve -W ${relative}`], ['bnd.cli.export', `bnd export ${relative}`],
        ]) {
            ui.terminals.length = 0;
            await run(command, uri);
            assert.strictEqual(await ui.command(), expected, command);
        }
    });

    test('falls back to the project default without .bndrun files and reports a missing export target', async () => {
        for (const [command, expected] of [
            ['bnd.cli.run', 'bnd run'], ['bnd.cli.runtests', 'bnd runtests'], ['bnd.cli.resolve', 'bnd resolve resolve -W'],
        ]) {
            ui.terminals.length = 0;
            await run(command);
            assert.strictEqual(await ui.command(), expected, command);
        }
        ui.terminals.length = 0;
        await run('bnd.cli.export');
        assert.ok(ui.messages.includes('No .bndrun files found in workspace.'));
        await ui.noTerminal();
    });

    test('picks one of the workspace .bndrun files, or the project default, for run and runtests', async () => {
        const [a, b] = ['a.bndrun', 'b.bndrun'].map(name => vscode.Uri.file(path.join(temporary, name)));
        ui.files.set('**/*.bndrun', [b, a]);
        ui.quickPicks.push(items => items.find((item: { label: string }) => item.label.endsWith('a.bndrun')));
        await run('bnd.cli.run');
        assert.strictEqual(await ui.command(), `bnd run ${vscode.workspace.asRelativePath(a)}`);

        ui.terminals.length = 0;
        ui.quickPicks.push(first);
        await run('bnd.cli.runtests');
        assert.strictEqual(await ui.command(), 'bnd runtests');

        ui.terminals.length = 0;
        ui.quickPicks.push(() => undefined);
        await run('bnd.cli.run');
        await ui.noTerminal();
    });

    test('resolves, exports and verifies the files chosen from lists', async () => {
        const [a, b] = ['a.bndrun', 'b.bndrun'].map(name => vscode.Uri.file(path.join(temporary, name)));
        ui.files.set('**/*.bndrun', [a, b]);
        ui.picks.push(items => items as any);
        await run('bnd.cli.resolve');
        assert.strictEqual(await ui.command(), `bnd resolve resolve -W ${vscode.workspace.asRelativePath(a)} ${vscode.workspace.asRelativePath(b)}`);

        ui.terminals.length = 0;
        ui.picks.push(items => items[1]);
        await run('bnd.cli.export');
        assert.strictEqual(await ui.command(), `bnd export ${vscode.workspace.asRelativePath(b)}`);

        ui.terminals.length = 0;
        const jar = vscode.Uri.file(path.join(temporary, 'generated', 'x.jar'));
        ui.files.set('**/generated/*.jar', [jar]);
        ui.picks.push(items => [items[0]] as any);
        await run('bnd.cli.verify');
        assert.strictEqual(await ui.command(), `bnd verify ${vscode.workspace.asRelativePath(jar)}`);

        ui.terminals.length = 0;
        ui.picks.push(pick('Manifest'), first);
        await run('bnd.cli.print');
        assert.strictEqual(await ui.command(), `bnd print -m ${vscode.workspace.asRelativePath(jar)}`);
    });

    test('warns when no runtime satisfies -runee and uses the default runtime', async () => {
        const uri = bndrun('-runee: JavaSE-99\n');
        await run('bnd.cli.run', uri);
        assert.strictEqual(await ui.command(), `bnd run ${vscode.workspace.asRelativePath(uri)}`);
        assert.ok(ui.messages.some(message => /requires JavaSE-99 \(Java 99\)/.test(message)), JSON.stringify(ui.messages));
    });

    test('prompts for print, diff, wrap, macro and repo arguments', async () => {
        ui.picks.push(pick('Imports / Exports'));
        ui.inputs.push('lib/x.jar');
        await run('bnd.cli.print');
        assert.strictEqual(await ui.command(), 'bnd print -i lib/x.jar');

        ui.terminals.length = 0;
        ui.inputs.push('');
        await run('bnd.cli.diff');
        assert.strictEqual(await ui.command(), 'bnd diff');
        ui.terminals.length = 0;
        ui.inputs.push('new.jar', 'old.jar');
        await run('bnd.cli.diff');
        assert.strictEqual(await ui.command(), 'bnd diff new.jar old.jar');

        ui.terminals.length = 0;
        ui.inputs.push('lib/plain.jar');
        await run('bnd.cli.wrap');
        assert.strictEqual(await ui.command(), 'bnd wrap lib/plain.jar');

        ui.terminals.length = 0;
        ui.inputs.push('${version;===;1.2.3}');
        await run('bnd.cli.macro');
        assert.strictEqual(await ui.command(), "bnd macro '${version;===;1.2.3}'");

        ui.terminals.length = 0;
        ui.picks.push(pick('repos'));
        await run('bnd.cli.repo');
        assert.strictEqual(await ui.command(), 'bnd repo repos');
    });

    test('does nothing when a prompt is dismissed', async () => {
        ui.picks.push(() => undefined);
        await run('bnd.cli.print');
        ui.inputs.push(undefined);
        await run('bnd.cli.diff');
        ui.inputs.push('');
        await run('bnd.cli.wrap');
        ui.inputs.push('');
        await run('bnd.cli.macro');
        ui.picks.push(() => undefined);
        await run('bnd.cli.repo');
        await ui.noTerminal();
    });

    test('asks before releasing and verifies only JARs it can find', async () => {
        await run('bnd.cli.release');
        await ui.noTerminal();
        ui.buttons.push('Release');
        await run('bnd.cli.release');
        assert.strictEqual(await ui.command(), 'bnd release');

        ui.messages.length = 0;
        await run('bnd.cli.verify');
        assert.ok(ui.messages.some(message => message.startsWith('No JARs found')));
    });

    test('refuses to run while the configured bnd JAR is missing', async () => {
        await settings.update('cli.executable', `java -jar ${path.join(temporary, 'missing.jar')}`, vscode.ConfigurationTarget.Global);
        ui.buttons.push('Open Settings');
        await run('bnd.cli.test');
        await ui.noTerminal();
        assert.ok(ui.messages.some(message => message.startsWith('bnd CLI JAR not found')), JSON.stringify(ui.messages));
    });

    test('asks for a Java runtime when none is configured and takes the selected folder', async () => {
        await settings.update('cli.javaExecutable', 'java', vscode.ConfigurationTarget.Global);
        ui.buttons.push('Select Java Runtime');
        ui.dialogs.push([vscode.Uri.file(javaHome)]);
        await run('bnd.cli.version');
        assert.strictEqual(await ui.command(), 'bnd version');
        assert.strictEqual(ui.terminals[0].options.env!.JAVA_HOME, javaHome);
        assert.ok(vscode.workspace.getConfiguration('bnd').get<string>('cli.javaExecutable', '').startsWith(javaHome));
    });

    test('stops without a runtime when the prompt is dismissed or the folder has no Java', async () => {
        await settings.update('cli.javaExecutable', 'java', vscode.ConfigurationTarget.Global);
        ui.buttons.push(undefined);
        await run('bnd.cli.version');
        await ui.noTerminal();

        ui.buttons.push('Select Java Runtime');
        ui.dialogs.push([vscode.Uri.file(temporary)]);
        await run('bnd.cli.version');
        await ui.noTerminal();
        assert.ok(ui.messages.some(message => message.startsWith('Selected folder does not contain a Java executable')));
    });

    test('selects a Java runtime from a folder and reports when discovery finds nothing', async () => {
        await settings.update('cli.javaExecutable', 'java', vscode.ConfigurationTarget.Global);
        ui.buttons.push('Select Java Runtime...');
        ui.dialogs.push([vscode.Uri.file(javaHome)]);
        await run('bnd.cli.selectJavaRuntime');
        assert.ok(vscode.workspace.getConfiguration('bnd').get<string>('cli.javaExecutable', '').startsWith(javaHome));

        ui.messages.length = 0;
        const empty = path.join(temporary, 'empty');
        fs.mkdirSync(empty);
        ui.dialogs.push([vscode.Uri.file(empty)]);
        await run('bnd.cli.discoverJavaRuntimes');
        assert.ok(ui.messages.includes('No Java runtimes found in the selected root folder.'), JSON.stringify(ui.messages));

        ui.dialogs.push(undefined);
        await run('bnd.cli.discoverJavaRuntimes');
    });

    test('opens the CLI reference', async () => {
        await run('bnd.cli.showReference');
        await new Promise(resolve => setTimeout(resolve, 200));
        await run('bnd.cli.showReference');
        await run('workbench.action.closeAllEditors');
    });
});
