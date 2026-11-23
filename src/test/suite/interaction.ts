import * as assert from 'assert';
import * as vscode from 'vscode';

export interface FakeTerminal {
    options: vscode.TerminalOptions;
    sent: string[];
}

export type Answer<T> = (items: readonly T[]) => T | readonly T[] | undefined;

/** Replaces the interactive parts of `vscode.window` so the bnd-cli: commands can run unattended. */
export class Interaction {
    readonly terminals: FakeTerminal[] = [];
    readonly messages: string[] = [];
    readonly picks: Answer<any>[] = [];
    readonly inputs: (string | undefined)[] = [];
    readonly dialogs: (vscode.Uri[] | undefined)[] = [];
    readonly buttons: (string | undefined)[] = [];
    /** Result of `workspace.findFiles` by glob; unlisted globs find nothing. */
    readonly files = new Map<string, vscode.Uri[]>();
    readonly quickPicks: Answer<any>[] = [];
    private readonly original: Record<string, unknown> = {};
    private originalFindFiles: unknown;

    install(): void {
        const window = vscode.window as unknown as Record<string, unknown>;
        const replace = (name: string, value: unknown) => {
            this.original[name] = window[name];
            window[name] = value;
        };
        replace('createTerminal', (options: vscode.TerminalOptions) => {
            const terminal: FakeTerminal = { options, sent: [] };
            this.terminals.push(terminal);
            return { show: () => undefined, sendText: (text: string) => terminal.sent.push(text), dispose: () => undefined };
        });
        replace('showQuickPick', async (items: readonly unknown[]) => this.picks.shift()?.(items));
        replace('showInputBox', async () => this.inputs.shift());
        replace('showOpenDialog', async () => this.dialogs.shift());
        for (const name of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
            replace(name, async (message: string) => {
                this.messages.push(message);
                return this.buttons.shift();
            });
        }
        replace('setStatusBarMessage', () => ({ dispose: () => undefined }));
        replace('createQuickPick', () => {
            const accepted: (() => void)[] = [];
            const quickPick = {
                items: [] as { label: string }[], selectedItems: [] as unknown[], activeItems: [] as unknown[],
                onDidAccept: (listener: () => void) => { accepted.push(listener); return { dispose: () => undefined }; },
                onDidHide: () => ({ dispose: () => undefined }),
                dispose: () => undefined,
                show: () => {
                    const choice = this.quickPicks.shift()?.(quickPick.items);
                    quickPick.selectedItems = Array.isArray(choice) ? choice : choice ? [choice] : [];
                    accepted.forEach(listener => listener());
                },
            };
            return quickPick;
        });
        const workspace = vscode.workspace as unknown as Record<string, unknown>;
        this.originalFindFiles = workspace.findFiles;
        workspace.findFiles = async (glob: string) => this.files.get(glob) ?? [];
    }

    restore(): void {
        const window = vscode.window as unknown as Record<string, unknown>;
        for (const [name, value] of Object.entries(this.original)) window[name] = value;
        (vscode.workspace as unknown as Record<string, unknown>).findFiles = this.originalFindFiles;
    }

    /** The terminal command of the most recent terminal, waiting for the asynchronous command to finish. */
    async command(): Promise<string> {
        for (let attempt = 0; attempt < 100 && !this.terminals.length; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(this.terminals.length, `no terminal was opened; messages: ${JSON.stringify(this.messages)}`);
        return this.terminals[this.terminals.length - 1].sent[0];
    }

    async noTerminal(): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.deepStrictEqual(this.terminals, [], 'no terminal expected');
    }
}
