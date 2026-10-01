import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { cliArgs } from '../../bndCliCommands';

const DEFAULT_TEST_WORKSPACE = path.join('biz.aQute.bnd', 'testdata', 'workspace');
const PROJECT_DIR = 'p';
const BNDRUN = 'workspace.bndrun';
const SAMPLE_JAR = path.posix.join('..', 'cnf', 'repo', 'printAndExit-1.0.0.jar');

/** Palette commands that never shell out to the bnd JAR. */
const NON_CLI_COMMANDS = new Set([
    'bnd.cli.configureLib',
    'bnd.cli.selectJavaRuntime',
    'bnd.cli.discoverJavaRuntimes',
    'bnd.cli.showReference',
]);

/**
 * `execute` runs the arguments verbatim, `help` only verifies the sub-command exists —
 * used for commands that would block (run/runtests/watch) or publish artifacts (release).
 */
type SpecMode = 'execute' | 'help';

interface InvocationSpec {
    command: string;
    args: string;
    mode: SpecMode;
}

const SPECS: InvocationSpec[] = [
    { command: 'bnd.cli.build', args: cliArgs.build(), mode: 'execute' },
    { command: 'bnd.cli.build', args: cliArgs.build('--test'), mode: 'execute' },
    { command: 'bnd.cli.build', args: cliArgs.build('--watch'), mode: 'help' },
    { command: 'bnd.cli.run', args: cliArgs.run(BNDRUN), mode: 'help' },
    { command: 'bnd.cli.test', args: cliArgs.test(), mode: 'execute' },
    { command: 'bnd.cli.runtests', args: cliArgs.runtests(BNDRUN), mode: 'help' },
    { command: 'bnd.cli.resolve', args: cliArgs.resolve(BNDRUN), mode: 'execute' },
    { command: 'bnd.cli.clean', args: cliArgs.clean(), mode: 'execute' },
    { command: 'bnd.cli.baseline', args: cliArgs.baseline(), mode: 'execute' },
    { command: 'bnd.cli.verify', args: cliArgs.verify(SAMPLE_JAR), mode: 'execute' },
    { command: 'bnd.cli.print', args: cliArgs.print('-m', SAMPLE_JAR), mode: 'execute' },
    { command: 'bnd.cli.diff', args: cliArgs.diff(SAMPLE_JAR, SAMPLE_JAR), mode: 'execute' },
    { command: 'bnd.cli.wrap', args: cliArgs.wrap(SAMPLE_JAR), mode: 'execute' },
    { command: 'bnd.cli.export', args: cliArgs.export(BNDRUN), mode: 'execute' },
    { command: 'bnd.cli.release', args: cliArgs.release(), mode: 'help' },
    { command: 'bnd.cli.properties', args: cliArgs.properties(), mode: 'execute' },
    { command: 'bnd.cli.info', args: cliArgs.info(), mode: 'execute' },
    { command: 'bnd.cli.version', args: cliArgs.version(), mode: 'execute' },
    { command: 'bnd.cli.macro', args: cliArgs.macro('${version;===;1.2.3.qualifier}'), mode: 'execute' },
    { command: 'bnd.cli.repo', args: cliArgs.repo('list'), mode: 'execute' },
    { command: 'bnd.cli.repo', args: cliArgs.repo('repos'), mode: 'execute' },
    { command: 'bnd.cli.repo', args: cliArgs.repo('get'), mode: 'execute' },
    { command: 'bnd.cli.repo', args: cliArgs.repo('put'), mode: 'execute' },
];

function requireEnvPath(names: string[], description: string, fallback?: string): string {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) {
            const resolved = path.resolve(value);
            assert.ok(fs.existsSync(resolved), `${name} points to a missing ${description}: ${resolved}`);
            return resolved;
        }
    }

    assert.ok(
        fallback && fs.existsSync(fallback),
        `No ${description} configured. Set ${names.join(' or ')} to run bnd CLI invocation tests.`,
    );
    return fallback as string;
}

function splitArgs(args: string): string[] {
    const tokens = args.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
    return tokens.map(token => token.replace(/^(['"])([\s\S]*)\1$/, '$2'));
}

suite('bnd CLI invocation (palette commands against the bnd JAR)', function () {
    this.timeout(300_000);

    const workspaceRoot = path.resolve(__dirname, '../../../../');
    let javaExecutable = 'java';
    let bndJar = '';
    let projectDir = '';
    let tempRoot = '';

    suiteSetup(() => {
        javaExecutable = process.env.BND_CLI_TEST_JAVA?.trim() || 'java';

        bndJar = requireEnvPath(
            ['BND_CLI_JAR'],
            'bnd CLI JAR',
            path.join(os.homedir(), 'biz.aQute.bnd.jar'),
        );

        const repoRoot = requireEnvPath(['BND_SOURCE_REPO', 'BND_JAVA_REPO'], 'bnd source repository');

        const configuredWorkspace = process.env.BND_CLI_TEST_WORKSPACE?.trim() || DEFAULT_TEST_WORKSPACE;
        const sourceWorkspace = path.isAbsolute(configuredWorkspace)
            ? configuredWorkspace
            : path.join(repoRoot, configuredWorkspace);
        assert.ok(
            fs.existsSync(path.join(sourceWorkspace, 'cnf')),
            `BND_CLI_TEST_WORKSPACE is not a bnd workspace (no cnf folder): ${sourceWorkspace}`,
        );

        // Copy so that mutating commands (clean/build/resolve -W) never touch the bnd repository.
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-cli-invocation-'));
        fs.cpSync(sourceWorkspace, tempRoot, { recursive: true });

        projectDir = path.join(tempRoot, PROJECT_DIR);
        assert.ok(fs.existsSync(projectDir), `Test workspace has no project folder "${PROJECT_DIR}"`);
    });

    suiteTeardown(() => {
        if (tempRoot) {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    test('every palette CLI command is covered by an invocation spec', () => {
        const packageJson = JSON.parse(
            fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'),
        ) as { contributes: { commands: { command: string }[] } };

        const paletteCliCommands = packageJson.contributes.commands
            .map(entry => entry.command)
            .filter(command => command.startsWith('bnd.cli.') && !NON_CLI_COMMANDS.has(command));

        const covered = new Set(SPECS.map(spec => spec.command));
        const missing = paletteCliCommands.filter(command => !covered.has(command));
        assert.deepStrictEqual(missing, [], `Palette commands without an invocation spec: ${missing.join(', ')}`);
    });

    for (const spec of SPECS) {
        test(`${spec.command}: bnd ${spec.args} (${spec.mode})`, () => {
            const tokens = splitArgs(spec.args);
            // `bnd help` only accepts a top-level command name.
            const invocation = spec.mode === 'help' ? ['help', tokens[0]] : tokens;

            const result = spawnSync(javaExecutable, ['-jar', bndJar, ...invocation], {
                cwd: projectDir,
                encoding: 'utf8',
            });

            assert.strictEqual(result.error, undefined, `Failed to start ${javaExecutable}: ${result.error?.message}`);
            const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

            assert.ok(
                !/No such command/i.test(output),
                `bnd rejected "${spec.args}" as unknown:\n${output}`,
            );
            if (spec.mode === 'execute') {
                assert.ok(
                    !/Available sub-commands/i.test(output),
                    `bnd treated "${spec.args}" as an incomplete command group:\n${output}`,
                );
            }
        });
    }
});
