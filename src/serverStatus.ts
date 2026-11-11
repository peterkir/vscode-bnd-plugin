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

const label = 'bnd LS';

export function presentServerStatus(status: ServerStatus): ServerStatusPresentation {
    switch (status.state) {
        case 'disabled':
            return { text: `$(circle-slash) ${label}`, tooltip: 'bnd Language Server: disabled by bnd.server.enabled', error: false };
        case 'starting':
            return { text: `$(sync~spin) ${label}`, tooltip: `bnd Language Server: starting (${status.kind})`, error: false };
        case 'running':
            return { text: `$(check) ${label}`, tooltip: `bnd Language Server: running (${status.kind})`, error: false };
        case 'failed':
            return { text: `$(error) ${label}`, tooltip: `bnd Language Server: failed to start: ${status.message}`, error: true };
        default:
            return { text: `$(debug-disconnect) ${label}`, tooltip: 'bnd Language Server: stopped', error: false };
    }
}
