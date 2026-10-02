import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveBndrunUri } from '../../extension';

interface PackageJsonCommand {
    command: string;
    title: string;
    category?: string;
}

suite('Extension manifest', () => {
    const workspaceRoot = path.resolve(__dirname, '../../../../');
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    const languageConfigPath = path.join(workspaceRoot, 'language-configuration.json');

    test('passes Windows bndrun URIs with a literal drive colon to Java resolve', () => {
        const uri = vscode.Uri.parse('file:///c%3A/workspace/my%20app/launch.bndrun');
        assert.strictEqual(resolveBndrunUri(uri), 'file:///c:/workspace/my%20app/launch.bndrun');
        assert.strictEqual(resolveBndrunUri(vscode.Uri.parse('file:///workspace/launch.bndrun')),
            'file:///workspace/launch.bndrun');
    });

    test('contains expected bnd command contributions', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            contributes?: { commands?: PackageJsonCommand[] };
        };

        const commands = new Set(
            (pkg.contributes?.commands ?? []).map(entry => entry.command)
        );

        const expected = [
            'bnd.showEffective',
            'bnd.showEffectiveToSide',
            'bnd.openSource',
            'bnd.showEffectiveSource',
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
            'bnd.lsp.resolve',
            'bnd.lsp.buildProject',
            'bnd.lsp.expandMacro',
        ];

        const missing = expected.filter(name => !commands.has(name));
        assert.deepStrictEqual(
            missing,
            [],
            `Missing command contributions: ${missing.join(', ')}`,
        );
    });

    test('keeps client wrapper commands distinct from server commands', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            contributes?: { commands?: PackageJsonCommand[] };
        };
        const commands = new Set(
            (pkg.contributes?.commands ?? []).map(entry => entry.command)
        );
        const serverCommands = [
            'bnd.resolve',
            'bnd.build.project',
            'bnd.macro.expand',
        ];

        const collisions = serverCommands.filter(command => commands.has(command));
        assert.deepStrictEqual(
            collisions,
            [],
            `Client commands collide with language-server commands: ${collisions.join(', ')}`,
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

    test('Effective is optional and does not replace the default source editor', () => {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const editor = pkg.contributes.customEditors.find((item: { viewType: string }) => item.viewType === 'bnd.effective');
        assert.strictEqual(editor.priority, 'option');
        assert.deepStrictEqual(editor.selector.map((item: { filenamePattern: string }) => item.filenamePattern), ['*.bnd', '*.bndrun']);
        assert.ok(pkg.contributes.menus['editor/title'].some((item: { command: string }) => item.command === 'bnd.showEffective'));
    });
});
