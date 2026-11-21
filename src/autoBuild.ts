// Client side of the bnd language server's automatic (incremental) build.
// Pure logic only: no vscode imports, so it can be unit tested without an extension host.

export const autoBuildCommand = 'bnd.build.auto';
export const buildStatusNotification = 'bnd/buildStatus';
export const autoBuildSetting = 'build.auto';

// Project.build() only packages compiled classes; the Java language server writes them below the output directories.
export const classOutputGlob = '**/{bin,bin.vscode}/**/*.class';

export type BuildPhase = 'idle' | 'building' | 'disabled';

export interface BuildSummary {
    built: string[];
    failed: string[];
    skipped: string[];
    errors: number;
    warnings: number;
}

export interface BuildMessage {
    project: string;
    severity: 'error' | 'warning';
    message: string;
}

export interface BuildStatus {
    state: BuildPhase;
    enabled: boolean;
    active: boolean;
    reason: 'untrusted' | null;
    workspace: string | null;
    projects: string[];
    current: string | null;
    summary: BuildSummary | null;
    messages: BuildMessage[];
}

export interface AutoBuildSwitch {
    enabled: boolean;
    active: boolean;
    reason: 'untrusted' | null;
}

export interface LastBuild {
    at: number;
    summary: BuildSummary;
}

export interface AutoBuildState extends AutoBuildSwitch {
    supported: boolean;
    phase: BuildPhase;
    current: string | null;
    projects: string[];
    last: LastBuild | null;
}

export interface AutoBuildView {
    visible: boolean;
    text: string;
    tooltip: string;
    error: boolean;
}

export function initialAutoBuildState(): AutoBuildState {
    return { supported: false, enabled: false, active: false, reason: null, phase: 'disabled', current: null, projects: [], last: null };
}

export function supportsAutoBuild(experimental: unknown): boolean {
    return (experimental as { bndAutoBuild?: unknown } | null | undefined)?.bndAutoBuild === true;
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function parseAutoBuildSwitch(raw: unknown): AutoBuildSwitch | undefined {
    const value = raw as Record<string, unknown> | null | undefined;
    if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') return undefined;
    const active = typeof value.active === 'boolean' ? value.active : value.enabled;
    return { enabled: value.enabled, active, reason: value.reason === 'untrusted' ? 'untrusted' : null };
}

export function parseBuildStatus(raw: unknown): BuildStatus | undefined {
    const value = raw as Record<string, unknown> | null | undefined;
    if (!value || typeof value !== 'object') return undefined;
    const state = value.state;
    if (state !== 'idle' && state !== 'building' && state !== 'disabled') return undefined;
    const switchState = parseAutoBuildSwitch({ enabled: value.enabled ?? state !== 'disabled', active: value.active, reason: value.reason });
    if (!switchState) return undefined;
    const summaryRaw = value.summary as Record<string, unknown> | null | undefined;
    const summary: BuildSummary | null = summaryRaw && typeof summaryRaw === 'object'
        ? {
            built: strings(summaryRaw.built),
            failed: strings(summaryRaw.failed),
            skipped: strings(summaryRaw.skipped),
            errors: count(summaryRaw.errors),
            warnings: count(summaryRaw.warnings),
        }
        : null;
    const messages: BuildMessage[] = Array.isArray(value.messages)
        ? value.messages.flatMap((entry: unknown): BuildMessage[] => {
            const message = entry as Record<string, unknown> | null;
            if (!message || typeof message.message !== 'string') return [];
            return [{
                project: typeof message.project === 'string' ? message.project : '',
                severity: message.severity === 'warning' ? 'warning' : 'error',
                message: message.message,
            }];
        })
        : [];
    return {
        ...switchState,
        state,
        workspace: typeof value.workspace === 'string' ? value.workspace : null,
        projects: strings(value.projects),
        current: typeof value.current === 'string' ? value.current : null,
        summary,
        messages,
    };
}

export function applyBuildStatus(previous: AutoBuildState, status: BuildStatus, now: number): AutoBuildState {
    return {
        ...previous,
        enabled: status.enabled,
        active: status.active,
        reason: status.reason,
        phase: status.state,
        current: status.state === 'building' ? status.current : null,
        projects: status.state === 'building' ? status.projects : [],
        last: status.summary ? { at: now, summary: status.summary } : previous.last,
    };
}

export function applyAutoBuildSwitch(previous: AutoBuildState, next: AutoBuildSwitch): AutoBuildState {
    const building = previous.phase === 'building' && next.active;
    return {
        ...previous,
        ...next,
        phase: building ? 'building' : next.active ? 'idle' : 'disabled',
        current: building ? previous.current : null,
        projects: building ? previous.projects : [],
    };
}

function clock(at: number): string {
    return new Date(at).toTimeString().slice(0, 8);
}

function plural(amount: number, noun: string): string {
    return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

export function describeSummary(summary: BuildSummary): string {
    const parts: string[] = [];
    if (summary.built.length) parts.push(`built ${summary.built.join(', ')}`);
    if (summary.failed.length) parts.push(`failed ${summary.failed.join(', ')}`);
    if (summary.skipped.length) parts.push(`skipped ${summary.skipped.join(', ')}`);
    if (!parts.length) parts.push('nothing to build');
    parts.push(`${plural(summary.errors, 'error')}, ${plural(summary.warnings, 'warning')}`);
    return parts.join('; ');
}

function failureCount(summary: BuildSummary): number {
    return summary.errors || summary.failed.length;
}

export function lastBuildFailed(last: LastBuild | null): boolean {
    return !!last && (last.summary.failed.length > 0 || last.summary.errors > 0);
}

export function presentAutoBuild(state: AutoBuildState): AutoBuildView {
    if (!state.supported) return { visible: false, text: '', tooltip: '', error: false };
    const links = '[Show output](command:bnd.build.auto.showOutput)';
    let text: string;
    let headline: string;
    let hint: string;
    let error = false;
    if (state.enabled && !state.active) {
        text = '$(extensions) $(shield)';
        headline = 'Automatic build is on but paused: the workspace is not trusted.';
        hint = 'Trust the workspace to build automatically. Click for build actions.';
    } else if (!state.enabled) {
        text = '$(extensions) $(circle-slash)';
        headline = 'Automatic build is off.';
        hint = 'Click for build actions.';
    } else if (state.phase === 'building') {
        text = `$(extensions) $(sync~spin)${state.current ? ` ${state.current}` : ''}`;
        headline = `Building${state.current ? ` **${escapeMarkdown(state.current)}**` : ''}`
            + (state.projects.length > 1 ? ` (${state.projects.length} projects queued: ${escapeMarkdown(state.projects.join(', '))})` : '');
        hint = 'Click for build actions.';
    } else if (lastBuildFailed(state.last)) {
        text = `$(extensions) $(error) ${failureCount(state.last!.summary)}`;
        headline = 'The last automatic build failed.';
        hint = 'Click for build actions.';
        error = true;
    } else {
        text = '$(extensions) $(check)';
        headline = 'Automatic build is on.';
        hint = 'Click for build actions.';
    }
    const lines = [`**bnd automatic build**`, '', headline];
    if (state.last) lines.push('', `Last build ${clock(state.last.at)}: ${escapeMarkdown(describeSummary(state.last.summary))}`);
    lines.push('', hint, '', links);
    return { visible: true, text, tooltip: lines.join('\n'), error };
}

export function formatBuildLog(status: BuildStatus, at: number): string[] {
    if (status.state !== 'idle' || !status.summary) return [];
    const stamp = `[${clock(at)}]`;
    const lines = [`${stamp} ${describeSummary(status.summary)}`];
    for (const message of status.messages) {
        lines.push(`${stamp}   ${message.severity} ${message.project ? `${message.project}: ` : ''}${message.message}`);
    }
    return lines;
}

export interface ConfigInspection {
    workspaceValue?: unknown;
}

export function chooseConfigurationTarget(inspection: ConfigInspection | undefined): 'workspace' | 'global' {
    return inspection?.workspaceValue !== undefined ? 'workspace' : 'global';
}

export interface AutoBuildHost {
    readSetting(): boolean;
    send(args: unknown[]): Promise<unknown>;
    log(line: string): void;
    changed(state: AutoBuildState): void;
    now(): number;
}

// Keeps the bnd.build.auto setting, the server switch and the status bar consistent.
// The setting is the source of truth: server notifications update the state but never write the setting back.
export class AutoBuildController {
    private current = initialAutoBuildState();
    private queue: Promise<void> = Promise.resolve();
    private generation = 0;

    constructor(private readonly host: AutoBuildHost) {}

    get state(): AutoBuildState {
        return this.current;
    }

    // Called once the client is ready; `supported` comes from the server capabilities.
    async start(supported: boolean): Promise<void> {
        const generation = ++this.generation;
        // Provisional until the server answers the query: assume the setting is in effect.
        const enabled = supported && this.host.readSetting();
        this.update({ ...initialAutoBuildState(), supported, enabled, active: enabled, phase: enabled ? 'idle' : 'disabled' });
        if (!supported) return;
        try {
            const result = parseAutoBuildSwitch(await this.host.send([]));
            if (generation !== this.generation) return;
            if (result) this.update(applyAutoBuildSwitch(this.current, result));
        } catch (error) {
            this.host.log(`Querying the automatic build state failed: ${error}`);
            return;
        }
        await this.syncSetting();
    }

    stop(): void {
        this.generation++;
        this.update(initialAutoBuildState());
    }

    handleStatus(raw: unknown): void {
        const status = parseBuildStatus(raw);
        if (!status || !this.current.supported) return;
        const now = this.host.now();
        for (const line of formatBuildLog(status, now)) this.host.log(line);
        this.update(applyBuildStatus(this.current, status, now));
    }

    // Pushes the setting to the server when it differs from the last known server state.
    syncSetting(): Promise<void> {
        const run = this.queue.then(() => this.pushSetting());
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async pushSetting(): Promise<void> {
        if (!this.current.supported) return;
        const desired = this.host.readSetting();
        if (this.current.enabled === desired) return;
        const generation = this.generation;
        try {
            const result = parseAutoBuildSwitch(await this.host.send([desired]));
            if (generation !== this.generation || !result) return;
            this.update(applyAutoBuildSwitch(this.current, result));
            this.host.log(`Automatic build ${result.enabled ? 'enabled' : 'disabled'}.`);
        } catch (error) {
            this.host.log(`Switching automatic build failed: ${error}`);
        }
    }

    private update(next: AutoBuildState): void {
        this.current = next;
        this.host.changed(next);
    }
}
