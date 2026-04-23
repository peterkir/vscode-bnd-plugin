import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJsonCommand {
    command: string;
    title: string;
    category?: string;
}

suite('Extension manifest', () => {
    const workspaceRoot = path.resolve(__dirname, '../../../../');
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    const languageConfigPath = path.join(workspaceRoot, 'language-configuration.json');

    test('contains expected bnd command contributions', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            contributes?: { commands?: PackageJsonCommand[] };
        };

        const commands = new Set(
            (pkg.contributes?.commands ?? []).map(entry => entry.command)
        );

        const expected = [
            'bnd.cli.build',
            'bnd.cli.run',
            'bnd.cli.test',
            'bnd.cli.runtests',
            'bnd.cli.resolve',
            'bnd.cli.clean',
            'bnd.cli.baseline',
            'bnd.cli.verify',
            'bnd.cli.print',
            'bnd.cli.diff',
            'bnd.cli.wrap',
            'bnd.cli.export',
            'bnd.cli.release',
            'bnd.cli.properties',
            'bnd.cli.info',
            'bnd.cli.version',
            'bnd.cli.macro',
            'bnd.cli.repo',
        ];

        const missing = expected.filter(name => !commands.has(name));
        assert.deepStrictEqual(
            missing,
            [],
            `Missing command contributions: ${missing.join(', ')}`,
        );
    });

    test('uses expected bnd language comment syntax', () => {
        const config = JSON.parse(fs.readFileSync(languageConfigPath, 'utf8')) as {
            comments?: { lineComment?: string };
            brackets?: [string, string][];
        };

        assert.strictEqual(config.comments?.lineComment, '#');
        assert.ok(
            (config.brackets ?? []).some(pair => pair[0] === '{' && pair[1] === '}'),
            'Expected {} bracket pair in language configuration',
        );
    });
});
