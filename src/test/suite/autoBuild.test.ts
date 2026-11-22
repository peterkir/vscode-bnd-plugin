import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    applyBuildStatus,
    AutoBuildController,
    AutoBuildHost,
    AutoBuildState,
    chooseConfigurationTarget,
    formatBuildLog,
    initialAutoBuildState,
    parseAutoBuildSwitch,
    parseBuildStatus,
    presentAutoBuild,
    supportsAutoBuild,
    targetFolderDeletionChange,
    workspaceRefreshChange,
} from '../../autoBuild';

const failedSummary = { built: ['a'], failed: ['b'], skipped: [], errors: 2, warnings: 1 };

function status(overrides: Record<string, unknown> = {}): unknown {
    return {
        state: 'idle', enabled: true, active: true, reason: null, workspace: 'file:///ws', projects: [], current: null,
        summary: null, messages: [], ...overrides,
    };
}

function state(overrides: Partial<AutoBuildState> = {}): AutoBuildState {
    return { ...initialAutoBuildState(), supported: true, enabled: true, active: true, phase: 'idle', ...overrides };
}

suite('Automatic build', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8'));

    test('contributes the setting and commands', () => {
        const setting = pkg.contributes.configuration.properties['bnd.build.auto'];
        assert.strictEqual(setting.type, 'boolean');
        assert.strictEqual(setting.default, true);
        assert.strictEqual(setting.scope, 'window');
        assert.ok(setting.markdownDescription);
        for (const command of ['toggle', 'enable', 'disable', 'showOutput', 'menu'].map(name => `bnd.build.auto.${name}`)) {
            assert.ok(pkg.contributes.commands.some((entry: { command: string }) => entry.command === command), command);
            assert.ok(pkg.contributes.menus.commandPalette.some((entry: { command: string }) => entry.command === command), command);
        }
    });

    test('registers the setting with VS Code and changes it through build commands', async () => {
        await vscode.extensions.getExtension('klibio.bnd')!.activate();
        const config = vscode.workspace.getConfiguration('bnd');
        const before = config.inspect<boolean>('build.auto');
        assert.strictEqual(before?.defaultValue, true, 'the setting must be registered with VS Code');
        assert.strictEqual(before?.workspaceValue, undefined, 'this test requires no workspace override');
        try {
            await vscode.commands.executeCommand('bnd.build.auto.disable');
            assert.strictEqual(config.inspect<boolean>('build.auto')?.globalValue, false);
            await vscode.commands.executeCommand('bnd.build.auto.toggle');
            assert.strictEqual(config.inspect<boolean>('build.auto')?.globalValue, true);
        } finally {
            await config.update('build.auto', before?.globalValue, vscode.ConfigurationTarget.Global);
        }
    });

    test('reports a workspace refresh as a change of the workspace configuration', () => {
        assert.deepStrictEqual(workspaceRefreshChange('file:///ws'), { uri: 'file:///ws/cnf/build.bnd', type: 2 });
        assert.deepStrictEqual(workspaceRefreshChange('file:///ws/'), { uri: 'file:///ws/cnf/build.bnd', type: 2 });
    });

    test('maps the deletion of a target folder to a change of the project', () => {
        assert.deepStrictEqual(targetFolderDeletionChange('file:///ws/p/generated'), { uri: 'file:///ws/p/bnd.bnd', type: 2 });
        assert.deepStrictEqual(targetFolderDeletionChange('file:///ws/p/generated/'), { uri: 'file:///ws/p/bnd.bnd', type: 2 });
        assert.strictEqual(targetFolderDeletionChange('file:///ws/p/generated/x.jar'), undefined);
        assert.strictEqual(targetFolderDeletionChange('file:///ws/p/my-generated'), undefined);
    });

    test('detects the server capability', () => {
        assert.strictEqual(supportsAutoBuild({ bndAutoBuild: true }), true);
        assert.strictEqual(supportsAutoBuild({ bndAutoBuild: 'yes' }), false);
        assert.strictEqual(supportsAutoBuild({}), false);
        assert.strictEqual(supportsAutoBuild(undefined), false);
    });

    test('parses switch results and build notifications defensively', () => {
        assert.deepStrictEqual(parseAutoBuildSwitch({ enabled: true, active: false, reason: 'untrusted' }),
            { enabled: true, active: false, reason: 'untrusted' });
        assert.deepStrictEqual(parseAutoBuildSwitch({ enabled: false }), { enabled: false, active: false, reason: null });
        assert.strictEqual(parseAutoBuildSwitch({ active: true }), undefined);
        assert.strictEqual(parseAutoBuildSwitch(null), undefined);
        assert.strictEqual(parseBuildStatus({ state: 'unknown' }), undefined);
        const parsed = parseBuildStatus(status({
            state: 'idle', summary: failedSummary,
            messages: [{ project: 'b', severity: 'error', message: 'boom' }, { severity: 'warning' }, { project: 'a', message: 'w', severity: 'warning' }],
        }))!;
        assert.deepStrictEqual(parsed.summary, failedSummary);
        assert.deepStrictEqual(parsed.messages.map(message => message.message), ['boom', 'w']);
    });

    test('presents every state in the status bar', () => {
        const views = {
            unsupported: presentAutoBuild(initialAutoBuildState()),
            on: presentAutoBuild(state()),
            off: presentAutoBuild(state({ enabled: false, active: false, phase: 'disabled' })),
            untrusted: presentAutoBuild(state({ active: false, reason: 'untrusted', phase: 'disabled' })),
            building: presentAutoBuild(state({ phase: 'building', current: 'p1', projects: ['p1', 'p2'] })),
            failed: presentAutoBuild(state({ last: { at: 0, summary: failedSummary } })),
        };
        assert.strictEqual(views.unsupported.visible, false);
        assert.deepStrictEqual(
            [views.on.text, views.off.text, views.untrusted.text, views.building.text, views.failed.text],
            ['$(extensions) $(check)', '$(extensions) $(circle-slash)', '$(extensions) $(shield)',
                '$(extensions) $(sync~spin) p1', '$(extensions) $(error) 2']);
        assert.strictEqual(views.failed.error, true);
        assert.strictEqual(views.on.error, false);
        assert.match(views.building.tooltip, /2 projects queued/);
        assert.match(views.failed.tooltip, /built a; failed b; 2 errors, 1 warning/);
        assert.match(views.on.tooltip, /command:bnd\.build\.auto\.showOutput/);
    });

    test('keeps the last result until the next completed run', () => {
        let current = applyBuildStatus(state(), parseBuildStatus(status({ summary: failedSummary }))!, 1000);
        assert.strictEqual(current.last?.at, 1000);
        current = applyBuildStatus(current, parseBuildStatus(status({ state: 'building', projects: ['b'], current: 'b' }))!, 2000);
        assert.strictEqual(current.phase, 'building');
        assert.strictEqual(current.current, 'b');
        assert.deepStrictEqual(current.last?.summary, failedSummary);
        current = applyBuildStatus(current, parseBuildStatus(status({ summary: { built: ['b'], failed: [], skipped: [], errors: 0, warnings: 0 } }))!, 3000);
        assert.strictEqual(current.phase, 'idle');
        assert.strictEqual(current.current, null);
        assert.strictEqual(presentAutoBuild(current).error, false);
    });

    test('formats completion messages and ignores intermediate notifications', () => {
        const done = parseBuildStatus(status({
            summary: failedSummary, messages: [{ project: 'b', severity: 'error', message: 'cannot resolve' }],
        }))!;
        const lines = formatBuildLog(done, 0);
        assert.strictEqual(lines.length, 2);
        assert.match(lines[0], /^\[\d\d:\d\d:\d\d\] built a; failed b; 2 errors, 1 warning$/);
        assert.match(lines[1], /error b: cannot resolve$/);
        assert.deepStrictEqual(formatBuildLog(parseBuildStatus(status({ state: 'building' }))!, 0), []);
        assert.deepStrictEqual(formatBuildLog(parseBuildStatus(status())!, 0), []);
    });

    test('writes the setting to the workspace only when it already has a workspace value', () => {
        assert.strictEqual(chooseConfigurationTarget({ workspaceValue: false }), 'workspace');
        assert.strictEqual(chooseConfigurationTarget({ workspaceValue: undefined }), 'global');
        assert.strictEqual(chooseConfigurationTarget(undefined), 'global');
    });

    suite('controller', () => {
        function create(options: { setting?: boolean; serverEnabled?: boolean; active?: boolean; failQuery?: boolean } = {}) {
            const calls: unknown[][] = [];
            const log: string[] = [];
            const states: AutoBuildState[] = [];
            let setting = options.setting ?? true;
            let serverEnabled = options.serverEnabled ?? true;
            const host: AutoBuildHost = {
                readSetting: () => setting,
                send: async args => {
                    calls.push(args);
                    if (options.failQuery) throw new Error('unreachable');
                    if (args.length) serverEnabled = args[0] as boolean;
                    const active = serverEnabled && (options.active ?? true);
                    return { enabled: serverEnabled, active, ...(serverEnabled && !active ? { reason: 'untrusted' } : {}) };
                },
                log: line => log.push(line),
                changed: next => states.push(next),
                now: () => 0,
            };
            return { controller: new AutoBuildController(host), calls, log, states, setSetting: (value: boolean) => { setting = value; } };
        }

        test('stays hidden when the server lacks the capability', async () => {
            const { controller, calls } = create();
            await controller.start(false);
            assert.strictEqual(presentAutoBuild(controller.state).visible, false);
            await controller.syncSetting();
            controller.handleStatus(status());
            assert.deepStrictEqual(calls, []);
            assert.strictEqual(presentAutoBuild(controller.state).visible, false);
        });

        test('queries once on start and does not push a matching setting', async () => {
            const { controller, calls } = create({ setting: true, serverEnabled: true });
            await controller.start(true);
            assert.deepStrictEqual(calls, [[]]);
            assert.strictEqual(controller.state.enabled, true);
        });

        test('re-applies the setting when the restarted server disagrees', async () => {
            const { controller, calls, setSetting } = create({ serverEnabled: true });
            setSetting(false);
            await controller.start(true);
            assert.deepStrictEqual(calls, [[], [false]]);
            assert.strictEqual(controller.state.enabled, false);
            assert.strictEqual(presentAutoBuild(controller.state).text, '$(extensions) $(circle-slash)');
        });

        test('pushes setting changes once and never echoes server notifications', async () => {
            const { controller, calls, setSetting } = create();
            await controller.start(true);
            calls.length = 0;
            setSetting(false);
            await Promise.all([controller.syncSetting(), controller.syncSetting()]);
            assert.deepStrictEqual(calls, [[false]]);
            controller.handleStatus(status({ state: 'disabled', enabled: false, active: false }));
            await controller.syncSetting();
            assert.deepStrictEqual(calls, [[false]]);
        });

        test('shows the untrusted state reported by the server', async () => {
            const { controller } = create({ active: false });
            await controller.start(true);
            assert.strictEqual(controller.state.reason, 'untrusted');
            assert.strictEqual(presentAutoBuild(controller.state).text, '$(extensions) $(shield)');
        });

        test('logs completed builds and ignores malformed notifications', async () => {
            const { controller, log, states } = create();
            await controller.start(true);
            const before = states.length;
            controller.handleStatus({ nonsense: true });
            assert.strictEqual(states.length, before);
            controller.handleStatus(status({ state: 'building', projects: ['b'], current: 'b' }));
            assert.deepStrictEqual(log, []);
            controller.handleStatus(status({ summary: failedSummary, messages: [{ project: 'b', severity: 'error', message: 'x' }] }));
            assert.strictEqual(log.length, 2);
            assert.strictEqual(presentAutoBuild(controller.state).text, '$(extensions) $(error) 2');
        });

        test('hides the item again when the client stops', async () => {
            const { controller } = create();
            await controller.start(true);
            controller.stop();
            assert.strictEqual(presentAutoBuild(controller.state).visible, false);
        });

        test('survives a failing query', async () => {
            const { controller, log } = create({ failQuery: true });
            await controller.start(true);
            assert.match(log[0], /Querying the automatic build state failed/);
            assert.strictEqual(controller.state.supported, true);
        });
    });
});
