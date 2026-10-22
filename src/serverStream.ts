import { Transform, TransformCallback } from 'stream';

const headerStart = Buffer.from('Content-Length:');
const headerEnd = Buffer.from('\r\n\r\n');
const maxHeaderBytes = 64 * 1024;

/**
 * Re-synchronizes an LSP stdio stream whose server shares stdout with workspace code
 * (bnd plugins printing to System.out). Bytes outside `Content-Length: ...\r\n\r\n{body}`
 * frames are dropped and reported instead of breaking the protocol reader.
 */
export class ProtocolResyncStream extends Transform {
    private pending: Buffer = Buffer.alloc(0);
    private stray = '';

    constructor(private readonly onStray: (text: string) => void) {
        super();
    }

    override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
        this.drain();
        callback();
    }

    override _flush(callback: TransformCallback): void {
        if (this.pending.length) this.discard(this.pending.length);
        this.reportStray();
        callback();
    }

    private drain(): void {
        while (this.pending.length) {
            const start = this.pending.indexOf(headerStart);
            if (start < 0) {
                this.discard(this.pending.length - partialPrefixLength(this.pending));
                return;
            }
            if (start > 0) this.discard(start - precedingHeaderBytes(this.pending.subarray(0, start)));
            const end = this.pending.indexOf(headerEnd);
            if (end < 0) {
                if (this.pending.length > maxHeaderBytes) this.discard(headerStart.length);
                return;
            }
            const length = contentLength(this.pending.subarray(0, end).toString('ascii'));
            if (length === undefined) {
                this.discard(headerStart.length);
                continue;
            }
            const frame = end + headerEnd.length + length;
            if (this.pending.length < frame) return;
            this.reportStray();
            this.push(this.pending.subarray(0, frame));
            this.pending = this.pending.subarray(frame);
        }
    }

    // Stray text arrives in arbitrary chunks; report it per line, or when a frame follows.
    private discard(count: number): void {
        if (count <= 0) return;
        this.stray += this.pending.subarray(0, count).toString('utf8');
        this.pending = this.pending.subarray(count);
        const lastBreak = this.stray.lastIndexOf('\n');
        if (lastBreak >= 0) {
            const complete = this.stray.slice(0, lastBreak);
            this.stray = this.stray.slice(lastBreak + 1);
            if (complete.trim()) this.onStray(complete);
        }
    }

    private reportStray(): void {
        if (this.stray.trim()) this.onStray(this.stray);
        this.stray = '';
    }
}

// Other header lines (e.g. Content-Type) directly before Content-Length belong to the frame.
function precedingHeaderBytes(buffer: Buffer): number {
    const match = /(?:[A-Za-z-]+:[^\r\n]*\r\n)+$/.exec(buffer.toString('latin1'));
    return match ? match[0].length : 0;
}

function partialPrefixLength(buffer: Buffer): number {
    const max = Math.min(headerStart.length - 1, buffer.length);
    for (let size = max; size > 0; size--) {
        if (buffer.subarray(buffer.length - size).equals(headerStart.subarray(0, size))) return size;
    }
    return 0;
}

function contentLength(headers: string): number | undefined {
    for (const line of headers.split('\r\n')) {
        const separator = line.indexOf(':');
        if (separator < 0) return undefined;
        if (line.slice(0, separator).trim().toLowerCase() === 'content-length') {
            const value = Number(line.slice(separator + 1).trim());
            return Number.isInteger(value) && value >= 0 ? value : undefined;
        }
    }
    return undefined;
}
