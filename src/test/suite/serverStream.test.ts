import * as assert from 'assert';
import { ProtocolResyncStream } from '../../serverStream';

function frame(body: string): string {
    return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

async function collect(stream: ProtocolResyncStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

suite('Java server stdout resynchronization', () => {
    test('drops stray plugin output between frames and reports it', async () => {
        const stray: string[] = [];
        const stream = new ProtocolResyncStream(text => stray.push(text));
        const first = frame('{"id":1}');
        const second = frame('{"id":2,"text":"ü"}');
        const input = Buffer.from(`Activate test extension {x=y}\n${first}Deactivate test extension\n${second}trailing`);
        // Feed in odd-sized chunks so headers and bodies straddle boundaries.
        for (let offset = 0; offset < input.length; offset += 7) stream.write(input.subarray(offset, offset + 7));
        stream.end();
        assert.strictEqual(await collect(stream), first + second);
        assert.deepStrictEqual(stray.map(text => text.trim()), ['Activate test extension {x=y}', 'Deactivate test extension', 'trailing']);
    });

    test('passes clean frames through unchanged', async () => {
        const stream = new ProtocolResyncStream(() => assert.fail('no stray output expected'));
        const message = `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n${frame('{"jsonrpc":"2.0"}')}`;
        stream.end(Buffer.from(message));
        assert.strictEqual(await collect(stream), message);
    });
});
