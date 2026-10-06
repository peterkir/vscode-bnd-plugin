const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { createMessageConnection, StreamMessageReader, StreamMessageWriter } = require('vscode-jsonrpc/node');

async function main() {
    const server = process.env.JDT_LS_HOME;
    assert.ok(server, 'Set JDT_LS_HOME to the redhat.java server directory.');
    const adapter = process.env.BND_JDT_LS_JAR || path.resolve(__dirname, '../server/jdtls/org.bndtools.jdtls.adapter.jar');
    assert.ok(fs.existsSync(adapter), `Missing adapter: ${adapter}`);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bnd-jdtls-'));
    const workspace = path.join(temporary, 'workspace');
    fs.mkdirSync(path.join(workspace, 'cnf'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'cnf/build.bnd'), 'javac.source: 21\njavac.target: 21\n');
    fs.mkdirSync(path.join(workspace, 'sample/src/sample'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'sample/bnd.bnd'), 'Bundle-SymbolicName: sample\n');
    const source = path.join(workspace, 'sample/src/sample/App.java');
    const java = process.env.JDT_LS_JAVA || 'java';
    const javaHome = process.env.JDT_LS_JAVA_HOME || path.dirname(path.dirname(java));
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const library = path.join(temporary, 'library');
    fs.mkdirSync(library);
    fs.writeFileSync(path.join(library, 'Greeting.java'), 'package dependency; public class Greeting {}');
    const compiled = spawnSync(path.join(javaHome, 'bin', 'javac' + suffix), ['-d', library, path.join(library, 'Greeting.java')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const jar = path.join(workspace, 'api.jar');
    const packaged = spawnSync(path.join(javaHome, 'bin', 'jar' + suffix), ['cf', jar, '-C', library, 'dependency'], { encoding: 'utf8' });
    assert.equal(packaged.status, 0, packaged.stderr);
    const testJar = path.join(workspace, 'test-api.jar');
    fs.copyFileSync(jar, testJar);
    fs.writeFileSync(path.join(workspace, 'sample/bnd.bnd'), 'Bundle-SymbolicName: sample\n-buildpath: ../api.jar;version=file\n-testpath: ../test-api.jar;version=file\n');
    fs.mkdirSync(path.join(workspace, 'sample/test/sample'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'sample/test/sample/AppTest.java'), 'package sample; public class AppTest {}');
    fs.writeFileSync(source, 'package sample; import dependency.Greeting; public class App { Greeting greeting; public static void main(String[] args) {} }\n');
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const configuration = path.join(temporary, 'configuration');
    fs.cpSync(path.join(server, `config_${platform}`), configuration, { recursive: true });
    const launcher = fs.readdirSync(path.join(server, 'plugins')).find(name => /^org\.eclipse\.equinox\.launcher_[^/]+\.jar$/.test(name));
    assert.ok(launcher, 'Missing Equinox launcher.');
    const processHandle = spawn(java, [
        '-Declipse.application=org.eclipse.jdt.ls.core.id1',
        '-Dosgi.bundles.defaultStartLevel=4',
        '-Declipse.product=org.eclipse.jdt.ls.core.product',
        '-Dosgi.checkConfiguration=true',
        '-Dosgi.sharedConfiguration.area=' + pathToFileURL(path.join(server, `config_${platform}`)).href,
        '--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED',
        '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
        '-jar', path.join(server, 'plugins', launcher),
        '-configuration', configuration, '-data', path.join(temporary, 'data'),
    ], { cwd: server, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    processHandle.stderr.on('data', data => { stderr += data; });
    const connection = createMessageConnection(new StreamMessageReader(processHandle.stdout),
        new StreamMessageWriter(processHandle.stdin));
    connection.onRequest('workspace/configuration', params => params.items.map(() => ({})));
    connection.onRequest('client/registerCapability', () => null);
    connection.onRequest('window/workDoneProgress/create', () => null);
    connection.onRequest('workspace/applyEdit', () => ({ applied: false }));
    connection.onNotification('window/logMessage', params => {
        if (params.type <= 2) console.error(params.message);
    });
    const diagnostics = new Map();
    let sourcePublished;
    connection.onNotification('textDocument/publishDiagnostics', params => {
        diagnostics.set(params.uri, params.diagnostics);
        if (sourcePublished) sourcePublished(params);
    });
    connection.listen();
    const timeout = setTimeout(() => {
        console.error('JDT LS integration test timed out.', stderr);
        processHandle.kill();
        process.exitCode = 1;
    }, 180000);
    try {
        const uri = pathToFileURL(workspace).href;
        await connection.sendRequest('initialize', {
            processId: process.pid, rootUri: uri,
            workspaceFolders: [{ uri, name: 'bnd-test' }],
            capabilities: { workspace: { configuration: true, workspaceFolders: true }, textDocument: {} },
            initializationOptions: {
                bundles: [adapter], workspaceFolders: [uri],
                settings: { java: {
                    import: { gradle: { enabled: false }, maven: { enabled: false } },
                    configuration: { runtimes: [{ name: 'JavaSE-21', path: javaHome }] },
                } },
            },
        });
        connection.sendNotification('initialized', {});
        const projectUri = pathToFileURL(path.join(workspace, 'sample')).href;
        const settings = await connection.sendRequest('workspace/executeCommand', {
            command: 'java.project.getSettings',
            arguments: [projectUri, ['org.eclipse.jdt.core.compiler.source']],
        });
        assert.equal(settings['org.eclipse.jdt.core.compiler.source'], '21');
        const classpaths = await connection.sendRequest('workspace/executeCommand', {
            command: 'java.project.getClasspaths', arguments: [projectUri, JSON.stringify({ scope: 'runtime' })],
        });
        console.log('JDT project settings:', JSON.stringify(settings));
        console.log('JDT classpaths:', JSON.stringify(classpaths));
        assert.ok(classpaths.classpaths.some(entry => entry.replaceAll('\\', '/').endsWith('/sample/bin')), JSON.stringify(classpaths));
        assert.ok(classpaths.classpaths.some(entry => path.resolve(entry) === path.resolve(jar)), JSON.stringify(classpaths));
        assert.ok(!classpaths.classpaths.some(entry => path.resolve(entry) === path.resolve(testJar)), JSON.stringify(classpaths));
        const testClasspath = await connection.sendRequest('workspace/executeCommand', {
            command: 'java.project.getClasspaths', arguments: [projectUri, JSON.stringify({ scope: 'test' })],
        });
        assert.ok(testClasspath.classpaths.some(entry => entry.replaceAll('\\', '/').endsWith('/sample/bin_test')), JSON.stringify(testClasspath));
        assert.ok(testClasspath.classpaths.some(entry => path.resolve(entry) === path.resolve(testJar)), JSON.stringify(testClasspath));
        const sourceUri = pathToFileURL(source).href;
        let diagnosticsTimer;
        const published = new Promise((resolve, reject) => {
            diagnosticsTimer = setTimeout(() => reject(new Error('No Java source diagnostics received.')), 15000);
            sourcePublished = params => {
                if (params.uri === sourceUri) {
                    clearTimeout(diagnosticsTimer);
                    resolve(params.diagnostics);
                }
            };
        });
        published.catch(() => {});
        connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri: sourceUri, languageId: 'java', version: 1, text: fs.readFileSync(source, 'utf8') },
        });
        const symbols = await connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri: sourceUri } });
        assert.ok(symbols.some(symbol => symbol.name === 'App'), JSON.stringify(symbols));
        let sourceDiagnostics;
        try {
            sourceDiagnostics = await published;
        } finally {
            clearTimeout(diagnosticsTimer);
        }
        const errors = sourceDiagnostics.filter(item => item.severity === 1);
        assert.deepEqual(errors, []);
        const bndFile = path.join(workspace, 'sample/bnd.bnd');
        fs.writeFileSync(bndFile, 'Bundle-SymbolicName: sample\n');
        connection.sendNotification('workspace/didChangeWatchedFiles', {
            changes: [{ uri: pathToFileURL(bndFile).href, type: 2 }],
        });
        let refreshed;
        const deadline = Date.now() + 15000;
        do {
            refreshed = await connection.sendRequest('workspace/executeCommand', {
                command: 'java.project.getClasspaths', arguments: [projectUri, JSON.stringify({ scope: 'runtime' })],
            });
            if (!refreshed.classpaths.some(entry => path.resolve(entry) === path.resolve(jar))) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        } while (Date.now() < deadline);
        assert.ok(!refreshed.classpaths.some(entry => path.resolve(entry) === path.resolve(jar)), 'Buildpath did not refresh.');
        const workspaceFile = path.join(workspace, 'cnf/build.bnd');
        fs.writeFileSync(workspaceFile, 'javac.source: 21\njavac.target: 21\n-buildpath: ../api.jar;version=file\n');
        connection.sendNotification('workspace/didChangeWatchedFiles', {
            changes: [{ uri: pathToFileURL(workspaceFile).href, type: 2 }],
        });
        const workspaceDeadline = Date.now() + 15000;
        do {
            refreshed = await connection.sendRequest('workspace/executeCommand', {
                command: 'java.project.getClasspaths', arguments: [projectUri, JSON.stringify({ scope: 'runtime' })],
            });
            if (refreshed.classpaths.some(entry => path.resolve(entry) === path.resolve(jar))) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        } while (Date.now() < workspaceDeadline);
        assert.ok(refreshed.classpaths.some(entry => path.resolve(entry) === path.resolve(jar)), 'Workspace buildpath did not refresh.');
        console.log('PASS: native bnd import, compiler settings, dependency JAR, test output and Java source model.');
        console.log('PASS: bnd buildpath changes refresh the JDT classpath.');
        console.log('PASS: workspace cnf changes refresh project dependencies; test dependencies stay separate.');
        await connection.sendRequest('shutdown');
        connection.sendNotification('exit');
    } catch (error) {
        const log = path.join(temporary, 'data/.metadata/.log');
        if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8').slice(-14000));
        console.error(stderr);
        throw error;
    } finally {
        clearTimeout(timeout);
        connection.dispose();
        processHandle.kill();
        await new Promise(resolve => {
            if (processHandle.exitCode !== null) resolve();
            else processHandle.once('exit', resolve);
        });
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });