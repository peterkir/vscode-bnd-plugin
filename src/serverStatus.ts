export type ServerKind = 'java' | 'node' | 'socket';

export type ServerStatus =
    | { state: 'disabled' }
    | { state: 'stopped' }
    | { state: 'starting' | 'running'; kind: ServerKind }
    | { state: 'failed'; message: string };

export interface ServerStatusPresentation {
    text: string;
    tooltip: string;
    error: boolean;
}

export interface BuildInfo {
    version: string;
    commit?: string;
    dirty?: boolean;
}

export interface ServerInfo {
    name: string;
    version?: string;
}

const shortSha = (text: string) => text.replace(/\b([0-9a-f]{10})[0-9a-f]{30}\b/g, '$1');

/** Markdown lines with the versions and Git commits of the extension and the running language server. */
export function presentVersions(extension: BuildInfo, status: ServerStatus, server: ServerInfo | undefined): string[] {
    const commit = extension.commit ? ` (\`${shortSha(extension.commit)}\`${extension.dirty ? ', modified' : ''})` : '';
    const lines = [`- Extension: **${extension.version}**${commit}`];
    if (status.state === 'running' && server) {
        const version = server.version
            ? shortSha(server.version).replace(/\(([0-9a-f]{7,40})\)/, '(`$1`)')
            : 'version unknown';
        lines.push(`- ${server.name} (${status.kind}): **${version}**`);
    } else {
        lines.push(`- Language Server: ${presentServerStatus(status).tooltip.replace(/^bnd Language Server: /, '')}`);
    }
    return lines;
}

export function presentServerStatus(status: ServerStatus): ServerStatusPresentation {
    switch (status.state) {
        case 'disabled':
            return { text: '$(extensions) $(circle-slash)', tooltip: 'bnd Language Server: disabled by bnd.server.enabled', error: false };
        case 'starting':
            return { text: '$(extensions) $(sync~spin)', tooltip: `bnd Language Server: starting (${status.kind})`, error: false };
        case 'running':
            return { text: '$(extensions) $(check)', tooltip: `bnd Language Server: running (${status.kind})`, error: false };
        case 'failed':
            return { text: '$(extensions) $(error)', tooltip: `bnd Language Server: failed to start: ${status.message}`, error: true };
        default:
            return { text: '$(extensions) $(debug-disconnect)', tooltip: 'bnd Language Server: stopped', error: false };
    }
}
