import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    BndDebugConfigurationProvider,
    BndLaunchCodeLensProvider,
    LaunchServer,
    hasRunSpec,
    hasTestpath,
    isLaunchTarget,
    launchDisposeCommand,
    launchPrepareCommand,
    parsePreparedLaunch,
    splitArguments,
    toJavaDebugConfiguration,
} from '../../bndLaunch';

const prepared = {
    launchId: 'id-1',
    mainClass: 'aQute.launcher.pre.EmbeddedLauncher',
    classPaths: ['/ws/p/pre.jar'],
    vmArgs: ['-Dlauncher.properties=/ws/p/generated/launch.properties'],
    args: ['--one'],
    env: { A: '1', B: '2' },
    cwd: '/ws/p',
    javaExecutable: null,
    runee: 'JavaSE-17',
    name: 'p',
    warnings: [],
};

function log(): vscode.LogOutputChannel {
    return vscode.window.createOutputChannel('bnd launch test', { log: true });
}

suite('bnd launch', () => {
    test('maps a prepared launch to a Java debug configuration', () => {
        const config = toJavaDebugConfiguration(prepared, {
            type: 'bnd', request: 'launch', name: 'my launch', vmArgs: '-Xmx1g "-Dx=a b"', args: ['--two'],
            env: { B: 'override' }, noDebug: true,
        }, '/jdk/bin/java');
        assert.strictEqual(config.type, 'java');
        assert.strictEqual(config.request, 'launch');
        assert.strictEqual(config.name, 'my launch');
        assert.strictEqual(config.mainClass, prepared.mainClass);
        assert.deepStrictEqual(config.classPaths, prepared.classPaths);
        assert.deepStrictEqual(config.vmArgs, [...prepared.vmArgs, '-Xmx1g', '-Dx=a b']);
        assert.deepStrictEqual(config.args, ['--one', '--two']);
        assert.deepStrictEqual(config.env, { A: '1', B: 'override' });
        assert.strictEqual(config.cwd, '/ws/p');
        assert.strictEqual(config.javaExec, '/jdk/bin/java');
        assert.strictEqual(config.noDebug, true);
        assert.strictEqual(config.console, 'integratedTerminal');
        assert.strictEqual(config.shortenCommandLine, 'auto');
        assert.strictEqual(config.__bndLaunchId, 'id-1');
    });

    test('prefers explicit and server Java executables over -runee lookup', () => {
        const base = { type: 'bnd', request: 'launch', name: 'x' };
        assert.strictEqual(toJavaDebugConfiguration({ ...prepared, javaExecutable: '/server/java' }, base, '/runee/java').javaExec, '/server/java');
        assert.strictEqual(toJavaDebugConfiguration(prepared, { ...base, javaExec: '/user/java' }, '/runee/java').javaExec, '/user/java');
        assert.strictEqual(toJavaDebugConfiguration(prepared, base).javaExec, undefined);
    });

    test('parses server responses and reports launch errors', () => {
        assert.strictEqual(parsePreparedLaunch(prepared).launchId, 'id-1');
        assert.throws(() => parsePreparedLaunch({ error: 'x', errors: ['No -runfw set'] }), /No -runfw set/);
        assert.throws(() => parsePreparedLaunch({ error: 'Launching requires a trusted workspace.' }), /trusted/);
        assert.throws(() => parsePreparedLaunch({ launchId: 'x' }), /incompatible/);
        assert.throws(() => parsePreparedLaunch(null), /incompatible/);
    });

    test('splits command line arguments', () => {
        assert.deepStrictEqual(splitArguments(undefined), []);
        assert.deepStrictEqual(splitArguments(['a b']), ['a b']);
        assert.deepStrictEqual(splitArguments(` -a  "b c" 'd' "" `), ['-a', 'b c', 'd', '']);
    });

    test('detects launch targets and run or test specifications', () => {
        assert.ok(isLaunchTarget('/ws/p/app.bndrun'));
        assert.ok(isLaunchTarget('/ws/p/bnd.bnd'));
        assert.ok(!isLaunchTarget('/ws/p/sub.bnd'));
        assert.ok(hasTestpath('x: y\n-testpath: \\\n  junit\n'));
        assert.ok(!hasTestpath('# -testpath: junit\n'));
        assert.ok(hasRunSpec('-runfw: org.apache.felix.framework\n'));
        assert.ok(hasRunSpec('-runbundles = a\n'));
        assert.ok(!hasRunSpec('-runvm: -Xmx1g\n'));
    });

    test('requires a Java language server with launch support', async () => {
        const calls: string[] = [];
        const server: LaunchServer = {
            supports: async () => false,
            execute: async command => { calls.push(command); return undefined; },
        };
        const channel = log();
        const original = vscode.window.showErrorMessage;
        const messages: string[] = [];
        (vscode.window as { showErrorMessage: unknown }).showErrorMessage = async (message: string) => {
            messages.push(message);
            return undefined;
        };
        try {
            const result = await new BndDebugConfigurationProvider(server, channel)
                .resolveDebugConfigurationWithSubstitutedVariables(undefined,
                    { type: 'bnd', request: 'launch', name: 'x', target: '/ws/p/app.bndrun' });
            assert.strictEqual(result, undefined);
            assert.deepStrictEqual(calls, []);
            assert.ok(messages.some(message => /Java bnd Language Server/.test(message)), messages.join('\n'));
        } finally {
            (vscode.window as { showErrorMessage: unknown }).showErrorMessage = original;
            channel.dispose();
        }
    });

    test('disposes the server launch when the Java session terminates', async () => {
        const calls: unknown[][] = [];
        const server: LaunchServer = {
            supports: async command => command === launchDisposeCommand || command === launchPrepareCommand,
            execute: async (command, args) => { calls.push([command, ...args]); return { disposed: true }; },
        };
        const channel = log();
        try {
            const provider = new BndDebugConfigurationProvider(server, channel);
            const session = (configuration: vscode.DebugConfiguration) => ({ configuration }) as unknown as vscode.DebugSession;
            provider.onSessionTerminated(session({ type: 'java', request: 'launch', name: 'x' }));
            provider.onSessionTerminated(session({ type: 'java', request: 'launch', name: 'x', __bndLaunchId: 'id-9' }));
            await new Promise(resolve => setTimeout(resolve, 10));
            assert.deepStrictEqual(calls, [[launchDisposeCommand, 'id-9']]);
        } finally {
            channel.dispose();
        }
    });

    test('offers run and test CodeLens actions', async () => {
        const provider = new BndLaunchCodeLensProvider();
        const bndrun = await vscode.workspace.openTextDocument({ language: 'bnd', content: '-runfw: x\n' });
        assert.deepStrictEqual(provider.provideCodeLenses(bndrun), [], 'untitled documents have no lenses');
        const titles = (text: string, file: string) => provider.provideCodeLenses({
            uri: vscode.Uri.file(file), getText: () => text,
        } as vscode.TextDocument).map(lens => lens.command?.title);
        assert.deepStrictEqual(titles('', '/ws/p/app.bndrun'), ['Run OSGi', 'Debug OSGi']);
        assert.deepStrictEqual(titles('-testpath: junit\n', '/ws/p/bnd.bnd'), ['Run OSGi tests', 'Debug OSGi tests']);
        assert.deepStrictEqual(titles('Bundle-Version: 1\n', '/ws/p/bnd.bnd'), []);
    });
});
