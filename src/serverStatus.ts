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
