import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Executable, LanguageClient } from 'vscode-languageclient/node';
import { executeServerCommand } from '../../extension';
import type { BndExtensionApi } from '../../extension';
import {
    configureTwin,
    detectEclipse,
    eclipseDetectedMessage,
    inspectTwinConfiguration,
    isTwinConfigured,
    parseLockInfo,
    presentEclipseStatus,
    removeStaleClasspathEntries,
    removeTwin,
    twinConfigurationContent,
    twinConfigurationPath,
} from '../../eclipseCoexistence';

suite('Parallel use with Eclipse', () => {
    const repositoryRoot = path.resolve(__dirname, '../../../../');
    const packageJsonPath = path.join(repositoryRoot, 'package.json');
    const temporaries: string[] = [];

    function temporaryDirectory(): string {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-eclipse-'));
        temporaries.push(directory);
        return directory;
    }

    function write(root: string, relative: string, text: string): string {
        const file = path.join(root, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        return file;
    }

    function lockedWorkspace(lockInfo: string): string {
        const root = temporaryDirectory();
        write(root, '.metadata/.lock_info', lockInfo);
        return root;
    }

    function bndWorkspace(): string {
        const root = temporaryDirectory();
        write(root, 'cnf/build.bnd', '-plugin: \\\n    aQute.bnd.repository.maven.provider.MavenBndRepository\n');
        return root;
    }

    function listFiles(root: string): string[] {
        return (fs.readdirSync(root, { recursive: true, withFileTypes: true }) as fs.Dirent[])
            .filter(entry => entry.isFile())
            .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
            .sort();
    }

    teardown(() => {
        for (const directory of temporaries.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    });

    test('contributes the detection setting and the commands', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const setting = pkg.contributes.configuration.properties['bnd.eclipse.detect'];
        assert.strictEqual(setting.type, 'boolean');
        assert.strictEqual(setting.default, true);
        const titles: Record<string, string> = {
            'bnd.eclipse.configureTwin': 'Configure Parallel Use with Eclipse...',
            'bnd.eclipse.menu': 'Eclipse Parallel Use...',
        };
        for (const [command, title] of Object.entries(titles)) {
            const contribution = pkg.contributes.commands.find((entry: { command: string }) => entry.command === command);
            assert.ok(contribution, command);
            assert.strictEqual(contribution.title, title);
            assert.strictEqual(contribution.category, 'bnd');
            assert.ok(pkg.contributes.menus.commandPalette.some((entry: { command: string }) => entry.command === command), command);
        }
    });

    test('packages the documentation opened by Details', () => {
        const ignore = fs.readFileSync(path.join(repositoryRoot, '.vscodeignore'), 'utf8').split(/\r?\n/);
        assert.ok(ignore.includes('!docs/shared-workspace-conflicts.md'));
        assert.ok(fs.existsSync(path.join(repositoryRoot, 'docs', 'shared-workspace-conflicts.md')));
    });

    test('registers the commands and reports no Eclipse for a folder without a bnd workspace', async () => {
        const api = await vscode.extensions.getExtension<BndExtensionApi>('klibio.bnd')!.activate();
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('bnd.eclipse.configureTwin'));
        assert.ok(commands.includes('bnd.eclipse.menu'));
        assert.deepStrictEqual(api.getParallelEclipse(), []);
    });

    test('parses .lock_info', () => {
        assert.deepStrictEqual(parseLockInfo('#Tue Nov 10 14:34:25 CET 2026\nhost=MYHOST\nprocess-id=10996\nuser=someone\n'),
            { pid: 10996, host: 'MYHOST', user: 'someone' });
        assert.deepStrictEqual(
            parseLockInfo('! comment\r\n\r\n  # indented comment\r\nhost : my.host.example \r\nprocess-id:42\r\nuser = DOMAIN\\\\some\\:one\\=x\r\n'),
            { pid: 42, host: 'my.host.example', user: 'DOMAIN\\some:one=x' });
        assert.deepStrictEqual(parseLockInfo('host=fe80\\:\\:1\nprocess-id=7'), { pid: 7, host: 'fe80::1' });
        for (const bad of ['abc', '0', '-5', '12x', '1.5', '']) {
            assert.deepStrictEqual(parseLockInfo(`host=MYHOST\nprocess-id=${bad}\n`), { host: 'MYHOST' }, bad);
        }
        assert.deepStrictEqual(parseLockInfo(''), {});
        assert.deepStrictEqual(parseLockInfo('#process-id=5\n!process-id=6\n'), {});
    });

    test('detects a running Eclipse with the default probes', () => {
        const root = lockedWorkspace(`#Tue Nov 10 14:34:25 CET 2026\nhost=${os.hostname()}\nprocess-id=${process.pid}\nuser=someone\n`);
        assert.deepStrictEqual(detectEclipse(root), { workspaceRoot: root, pid: process.pid, host: os.hostname(), user: 'someone' });
        const withoutHost = lockedWorkspace(`process-id=${process.pid}\n`);
        assert.deepStrictEqual(detectEclipse(withoutHost), { workspaceRoot: withoutHost, pid: process.pid });
    });

    test('ignores a stale lock file, another host, and a missing lock file', () => {
        const probes = { isAlive: () => true, hostname: 'myhost' };
        const root = lockedWorkspace('host=MYHOST\nprocess-id=4711\nuser=someone\n');
        assert.deepStrictEqual(detectEclipse(root, probes), { workspaceRoot: root, pid: 4711, host: 'MYHOST', user: 'someone' });
        const probed: number[] = [];
        assert.strictEqual(detectEclipse(root, { hostname: 'myhost', isAlive: pid => { probed.push(pid); return false; } }), undefined);
        assert.deepStrictEqual(probed, [4711]);
        assert.strictEqual(detectEclipse(root, { ...probes, hostname: 'otherhost' }), undefined);
        assert.strictEqual(detectEclipse(lockedWorkspace('host=MYHOST\nprocess-id=none\n'), probes), undefined);
        assert.strictEqual(detectEclipse(temporaryDirectory(), probes), undefined);
        assert.strictEqual(detectEclipse(path.join(temporaryDirectory(), 'missing'), probes), undefined);
    });

    test('compares host names without the domain suffix', () => {
        const withDomain = lockedWorkspace('host=myhost.corp.example.com\nprocess-id=4711\n');
        assert.strictEqual(detectEclipse(withDomain, { isAlive: () => true, hostname: 'MYHOST' })?.pid, 4711);
        const shortName = lockedWorkspace('host=MYHOST\nprocess-id=4711\n');
        assert.strictEqual(detectEclipse(shortName, { isAlive: () => true, hostname: 'myhost.corp.example.com' })?.pid, 4711);
        assert.strictEqual(detectEclipse(withDomain, { isAlive: () => true, hostname: 'myhost2' }), undefined);
    });

    test('presents the Eclipse status for a missing and an existing twin configuration', () => {
        const instance = { workspaceRoot: path.join('work', 'ws'), pid: 1234 };
        const hidden = presentEclipseStatus([]);
        assert.strictEqual(hidden.visible, false);
        assert.strictEqual(hidden.warning, false);

        const missing = presentEclipseStatus([{ instance, configured: false }]);
        assert.deepStrictEqual(missing, {
            visible: true,
            text: '$(warning) Eclipse',
            tooltip: `Eclipse (pid 1234) has this bnd workspace open: ${instance.workspaceRoot}. `
                + 'VS Code and Eclipse write the same build output. Click for options.',
            warning: true,
        });

        const configured = presentEclipseStatus([{ instance, configured: true }]);
        assert.strictEqual(configured.visible, true);
        assert.strictEqual(configured.text, '$(link) Eclipse');
        assert.strictEqual(configured.warning, false);
        assert.match(configured.tooltip, /pid 1234/);
        assert.match(configured.tooltip, /VS Code uses separate output directories \(bin\.vscode, bin_test\.vscode, generated\.vscode\)/);

        const mixed = presentEclipseStatus([
            { instance, configured: true },
            { instance: { workspaceRoot: path.join('work', 'other'), pid: 99 }, configured: false },
        ]);
        assert.strictEqual(mixed.text, '$(warning) Eclipse');
        assert.strictEqual(mixed.warning, true);
        assert.match(mixed.tooltip, /pid 1234/);
        assert.match(mixed.tooltip, /pid 99/);

        assert.strictEqual(eclipseDetectedMessage(instance),
            'Eclipse (pid 1234) has the bnd workspace ws open. VS Code and Eclipse write the same build output.');
    });

    test('writes and removes the twin configuration', () => {
        const root = bndWorkspace();
        assert.deepStrictEqual(inspectTwinConfiguration(root),
            { configured: false, workspaceOverrides: [], projectOverrides: [], sharedLaunchStorage: [], staleClasspaths: [] });

        const file = path.join(root, 'cnf', 'ext', 'vscode-outputs.bnd');
        assert.strictEqual(twinConfigurationPath, 'cnf/ext/vscode-outputs.bnd');
        assert.deepStrictEqual(configureTwin(root), { file, written: true, refused: false, workspaceOverrides: [] });
        assert.strictEqual(fs.readFileSync(file, 'utf8'), [
            '# Generated by the bnd VS Code extension (bnd: Configure Parallel Use with Eclipse).',
            '# Gives VS Code its own compiler and bundle output next to the Eclipse output.',
            "# The bnd language server and the Java project import report the driver 'vscode';",
            '# Eclipse Bndtools, the bnd CLI and Gradle keep bin, bin_test and generated.',
            'vscode.outputs: ${if;${driver;vscode};.vscode}',
            'bin: bin${vscode.outputs}',
            'testbin: bin_test${vscode.outputs}',
            'target-dir: generated${vscode.outputs}',
            '',
        ].join('\n'));
        assert.strictEqual(inspectTwinConfiguration(root).configured, true);
        assert.deepStrictEqual(inspectTwinConfiguration(root).workspaceOverrides, [], 'the generated file is not an override');

        const modified = fs.statSync(file).mtimeMs;
        assert.deepStrictEqual(configureTwin(root), { file, written: false, refused: false, workspaceOverrides: [] });
        assert.strictEqual(fs.statSync(file).mtimeMs, modified);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), twinConfigurationContent);

        fs.writeFileSync(file, 'bin: other\n');
        assert.strictEqual(configureTwin(root).written, true);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), twinConfigurationContent);

        assert.strictEqual(removeTwin(root), true);
        assert.strictEqual(fs.existsSync(file), false);
        assert.strictEqual(isTwinConfigured(root), false);
        assert.strictEqual(removeTwin(root), false);
    });

    test('refuses to configure a workspace that defines output directories', () => {
        const fromBuild = bndWorkspace();
        write(fromBuild, 'cnf/build.bnd', '# bin: commented\n-plugin: x\nbin = classes\n  testbin: continuation\nbinary: y\ntarget-dir\t: out\n');
        const buildOverrides = [
            { file: 'cnf/build.bnd', line: 3, key: 'bin' },
            { file: 'cnf/build.bnd', line: 6, key: 'target-dir' },
        ];
        assert.deepStrictEqual(inspectTwinConfiguration(fromBuild).workspaceOverrides, buildOverrides);
        const before = listFiles(fromBuild);
        assert.deepStrictEqual(configureTwin(fromBuild), {
            file: path.join(fromBuild, 'cnf', 'ext', 'vscode-outputs.bnd'), written: false, refused: true, workspaceOverrides: buildOverrides,
        });
        assert.deepStrictEqual(listFiles(fromBuild), before);
        assert.strictEqual(fs.existsSync(path.join(fromBuild, 'cnf', 'ext')), false);

        const fromExtension = bndWorkspace();
        write(fromExtension, 'cnf/ext/defaults.bnd', 'javac.source: 17\r\ntestbin: test-classes\r\n');
        write(fromExtension, 'cnf/ext/notes.txt', 'bin: ignored\n');
        const extensionOverrides = [{ file: 'cnf/ext/defaults.bnd', line: 2, key: 'testbin' }];
        const refused = configureTwin(fromExtension);
        assert.strictEqual(refused.refused, true);
        assert.strictEqual(refused.written, false);
        assert.deepStrictEqual(refused.workspaceOverrides, extensionOverrides);
        assert.deepStrictEqual(listFiles(fromExtension), ['cnf/build.bnd', 'cnf/ext/defaults.bnd', 'cnf/ext/notes.txt']);
        assert.strictEqual(inspectTwinConfiguration(fromExtension).configured, false);
    });

    test('reports project overrides and launches that share runtime storage', () => {
        const root = bndWorkspace();
        write(root, 'own.output/bnd.bnd', 'Bundle-Version: 1.0.0\ntarget-dir: target\nbin: target/classes\n');
        write(root, 'plain/bnd.bnd', '-buildpath: osgi.core\n');
        write(root, 'cnf/bnd.bnd', 'bin: ignored\n');
        write(root, 'launch/shared.bndrun', '-runfw: org.eclipse.osgi\n-runstorage: ${.}/rt\n');
        write(root, 'launch/properties.bndrun', '-runproperties: \\\n    launch.storage.dir=${.}/rt/app\n');
        write(root, 'launch/separated.bndrun', 'dir.rt: ${.}/rt/${driver}\n-runstorage: ${dir.rt}\n');
        write(root, 'launch/target.bndrun', '-runstorage: ${target-dir}/fw\n');
        write(root, 'launch/default.bndrun', '-runfw: org.eclipse.osgi\n#-runstorage: ${.}/rt\n');
        write(root, 'launch/nested/deep.bndrun', '-runstorage: ${.}/rt\n');
        write(root, 'cnf/central.bndrun', '-runstorage = ${.}/rt\n');
        write(root, 'root.bndrun', '-runstorage: ${.}/rt\n');

        const inspection = inspectTwinConfiguration(root);
        assert.strictEqual(inspection.configured, false);
        assert.deepStrictEqual(inspection.workspaceOverrides, []);
        assert.deepStrictEqual(inspection.projectOverrides, [
            { file: 'own.output/bnd.bnd', line: 2, key: 'target-dir' },
            { file: 'own.output/bnd.bnd', line: 3, key: 'bin' },
        ]);
        assert.deepStrictEqual(inspection.sharedLaunchStorage, ['cnf/central.bndrun', 'launch/properties.bndrun', 'launch/shared.bndrun']);

        assert.strictEqual(configureTwin(root).written, true, 'project overrides do not block the workspace configuration');
        assert.strictEqual(inspectTwinConfiguration(root).configured, true);
    });

    test('the bundled Java language server follows the generated configuration for the vscode driver', async function () {
        this.timeout(120000);
        const root = temporaryDirectory();
        write(root, 'cnf/build.bnd', '');
        const project = write(root, 'p/bnd.bnd', 'Bundle-Version: 1.0.0\n');
        const jar = path.join(repositoryRoot, 'server', 'biz.aQute.bnd.lsp.jar');
        const executable: Executable = { command: 'java', args: ['-jar', jar], options: { env: process.env } };
        const client = new LanguageClient('testBndTwin', 'Test bnd twin configuration', { run: executable, debug: executable }, {
            documentSelector: [{ scheme: 'file', language: 'bnd' }],
            // What the extension sends to its own server.
            initializationOptions: { workspaceTrusted: true, driver: 'vscode' },
            outputChannel: vscode.window.createOutputChannel('Test bnd twin configuration', { log: true }),
        });
        client.getFeature('workspace/executeCommand').initialize = () => {};
        // The server echoes the JSON quotes of the expression around the result.
        const directories = async () => ((await executeServerCommand(client, 'bnd.macro.expand',
            ['${driver}|${bin}|${testbin}|${target-dir}', vscode.Uri.file(project).toString()]) as { result?: string }).result ?? '')
            .replace(/^"|"$/g, '');
        try {
            await client.start();
            assert.strictEqual(await directories(), 'vscode|bin|bin_test|generated');

            const created = configureTwin(root);
            assert.strictEqual(created.written, true);
            await client.sendNotification('workspace/didChangeWatchedFiles',
                { changes: [{ uri: vscode.Uri.file(created.file).toString(), type: 1 }] });
            assert.strictEqual(await directories(), 'vscode|bin.vscode|bin_test.vscode|generated.vscode');

            assert.strictEqual(removeTwin(root), true);
            await client.sendNotification('workspace/didChangeWatchedFiles',
                { changes: [{ uri: vscode.Uri.file(created.file).toString(), type: 3 }] });
            assert.strictEqual(await directories(), 'vscode|bin|bin_test|generated');
        } finally {
            await client.stop();
        }
    });

    test('removes the Java import container only from the .classpath of Eclipse projects', () => {
        const root = bndWorkspace();
        const eclipseProject = '<projectDescription>\n\t<natures>\n\t\t<nature>org.eclipse.jdt.core.javanature</nature>\n'
            + '\t\t<nature>bndtools.core.bndnature</nature>\n\t</natures>\n</projectDescription>\n';
        const javaOnlyProject = eclipseProject.replace('\t\t<nature>bndtools.core.bndnature</nature>\n', '');
        const stale = '<classpath>\r\n\t<classpathentry kind="con" path="org.bndtools.jdtls.BND_CONTAINER"/>\r\n'
            + '\t<classpathentry kind="con" path="aQute.bnd.classpath.container"/>\r\n\t<classpathentry kind="src" path="src"/>\r\n</classpath>\r\n';
        const clean = stale.replace('\t<classpathentry kind="con" path="org.bndtools.jdtls.BND_CONTAINER"/>\r\n', '');
        write(root, 'shared/.project', eclipseProject);
        const shared = write(root, 'shared/.classpath', stale);
        write(root, 'untouched/.project', eclipseProject);
        const untouched = write(root, 'untouched/.classpath', clean);
        write(root, 'vscode.only/.project', javaOnlyProject);
        const vscodeOnly = write(root, 'vscode.only/.classpath', stale);

        assert.deepStrictEqual(inspectTwinConfiguration(root).staleClasspaths, ['shared/.classpath']);
        const modified = fs.statSync(untouched).mtimeMs;
        assert.deepStrictEqual(removeStaleClasspathEntries(root), ['shared/.classpath']);
        assert.strictEqual(fs.readFileSync(shared, 'utf8'), clean);
        assert.strictEqual(fs.statSync(untouched).mtimeMs, modified);
        assert.strictEqual(fs.readFileSync(vscodeOnly, 'utf8'), stale, 'the Java project import owns this .classpath');
        assert.deepStrictEqual(inspectTwinConfiguration(root).staleClasspaths, []);
        assert.deepStrictEqual(removeStaleClasspathEntries(root), []);
    });
});
