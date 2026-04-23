import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

function commandNamesFromBndJava(bndJavaContent: string): Set<string> {
    const names = new Set<string>();
    const regex = /public\s+void\s+_([A-Za-z0-9]+)\s*\(/g;
    for (const match of bndJavaContent.matchAll(regex)) {
        names.add(match[1]);
    }
    return names;
}

function findBndSourceRepoRoot(workspaceRoot: string): string | undefined {
    const fromEnv = process.env.BND_SOURCE_REPO || process.env.BND_JAVA_REPO;
    if (fromEnv) {
        return path.resolve(fromEnv);
    }

    const sibling = path.resolve(workspaceRoot, '../bnd');
    if (fs.existsSync(sibling)) {
        return sibling;
    }

    return undefined;
}

suite('Upstream bnd Java command parity', () => {
    const workspaceRoot = path.resolve(__dirname, '../../../../');

    test('includes extension CLI commands in biz.aQute.bnd command source', function () {
        const upstreamRoot = findBndSourceRepoRoot(workspaceRoot);
        if (!upstreamRoot) {
            this.skip();
            return;
        }

        const bndJavaPath = path.join(upstreamRoot, 'biz.aQute.bnd', 'src', 'aQute', 'bnd', 'main', 'bnd.java');
        if (!fs.existsSync(bndJavaPath)) {
            this.skip();
            return;
        }

        const bndJavaContent = fs.readFileSync(bndJavaPath, 'utf8');
        const upstreamCommands = commandNamesFromBndJava(bndJavaContent);

        const extensionCommands = [
            'build',
            'run',
            'test',
            'runtests',
            'resolve',
            'clean',
            'baseline',
            'verify',
            'print',
            'diff',
            'wrap',
            'export',
            'release',
            'properties',
            'info',
            'version',
            'macro',
            'repo',
        ];

        const missing = extensionCommands.filter(command => !upstreamCommands.has(command));
        assert.deepStrictEqual(
            missing,
            [],
            `Commands missing in upstream biz.aQute.bnd source: ${missing.join(', ')}`,
        );
    });
});
