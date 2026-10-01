import * as assert from 'assert';
import { isProxyBypassed, resolveProxyUrl } from '../../bndHttp';
import {
    parseJarNamesFromListing,
    parseLatestVersion,
    parseSnapshotJarName,
    parseVersions,
    parseVersionsFromListing,
    validateCustomJarUrl,
} from '../../bndLibrary';

suite('bnd library metadata parsing', () => {
    const releaseMetadata = `<metadata>
        <versioning>
            <latest>7.4.0</latest>
            <release>7.3.0</release>
            <versions>
                <version>7.2.3</version>
                <version>7.3.0</version>
                <version>7.4.0</version>
            </versions>
        </versioning>
    </metadata>`;

    test('parses release versions and prefers <release> over <latest>', () => {
        const versions = parseVersions(releaseMetadata);
        assert.deepStrictEqual(versions, ['7.2.3', '7.3.0', '7.4.0']);
        assert.strictEqual(parseLatestVersion(releaseMetadata, versions), '7.3.0');
    });

    test('falls back to the newest listed version without <release>/<latest>', () => {
        const xml = '<metadata><versioning><versions><version>1.0.0</version><version>2.0.0</version></versions></versioning></metadata>';
        assert.strictEqual(parseLatestVersion(xml, parseVersions(xml)), '2.0.0');
    });

    test('resolves the timestamped snapshot JAR name', () => {
        const xml = `<metadata>
            <versioning>
                <snapshotVersions>
                    <snapshotVersion>
                        <extension>pom</extension>
                        <value>7.5.0-20260901.101500-3</value>
                    </snapshotVersion>
                    <snapshotVersion>
                        <classifier>sources</classifier>
                        <extension>jar</extension>
                        <value>7.5.0-20260901.101500-3</value>
                    </snapshotVersion>
                    <snapshotVersion>
                        <extension>jar</extension>
                        <value>7.5.0-20260901.101500-3</value>
                    </snapshotVersion>
                </snapshotVersions>
            </versioning>
        </metadata>`;
        assert.strictEqual(
            parseSnapshotJarName(xml, '7.5.0-SNAPSHOT'),
            'biz.aQute.bnd-7.5.0-20260901.101500-3.jar',
        );
    });

    test('builds the snapshot JAR name from timestamp and buildNumber', () => {
        const xml = `<metadata><versioning><snapshot>
            <timestamp>20260901.101500</timestamp>
            <buildNumber>3</buildNumber>
        </snapshot></versioning></metadata>`;
        assert.strictEqual(
            parseSnapshotJarName(xml, '7.5.0-SNAPSHOT'),
            'biz.aQute.bnd-7.5.0-20260901.101500-3.jar',
        );
    });

    test('extracts JAR names from a directory listing and skips sources/javadoc', () => {
        const html = `<a href="biz.aQute.bnd-7.5.0-20260901.101500-3.jar">jar</a>
            <a href="biz.aQute.bnd-7.5.0-20260901.101500-3-sources.jar">sources</a>
            <a href="biz.aQute.bnd-7.5.0-20260901.101500-3.pom">pom</a>`;
        assert.deepStrictEqual(parseJarNamesFromListing(html), ['biz.aQute.bnd-7.5.0-20260901.101500-3.jar']);
    });

    test('extracts versions from a directory listing', () => {
        const html = '<a href="../">..</a><a href="7.4.0-SNAPSHOT/">7.4.0-SNAPSHOT/</a><a href="7.5.0-SNAPSHOT/">7.5.0-SNAPSHOT/</a>';
        assert.deepStrictEqual(parseVersionsFromListing(html), ['7.4.0-SNAPSHOT', '7.5.0-SNAPSHOT']);
    });

    test('accepts only https JAR URLs', () => {
        assert.strictEqual(validateCustomJarUrl('https://example.org/biz.aQute.bnd-7.4.0.jar'), undefined);
        assert.ok(validateCustomJarUrl('http://example.org/biz.aQute.bnd-7.4.0.jar'));
        assert.ok(validateCustomJarUrl('https://example.org/index.html'));
        assert.ok(validateCustomJarUrl('not a url'));
        assert.ok(validateCustomJarUrl('   '));
    });
});

suite('bnd library proxy resolution', () => {
    const target = 'https://repo.maven.apache.org/maven2/maven-metadata.xml';

    test('prefers the http.proxy setting over environment variables', () => {
        const proxy = resolveProxyUrl(target, { proxy: 'http://settings:3128' }, { HTTPS_PROXY: 'http://env:3129' });
        assert.strictEqual(proxy, 'http://settings:3128');
    });

    test('uses HTTPS_PROXY for https targets and HTTP_PROXY as fallback', () => {
        assert.strictEqual(resolveProxyUrl(target, {}, { HTTPS_PROXY: 'http://env:3129' }), 'http://env:3129');
        assert.strictEqual(resolveProxyUrl(target, {}, { HTTP_PROXY: 'http://env:3130' }), 'http://env:3130');
        assert.strictEqual(
            resolveProxyUrl('http://example.org/a.jar', {}, { HTTPS_PROXY: 'http://env:3129' }),
            undefined,
        );
    });

    test('returns undefined without configuration', () => {
        assert.strictEqual(resolveProxyUrl(target, { proxy: '   ' }, {}), undefined);
    });

    test('honours NO_PROXY suffix, port and wildcard matching', () => {
        assert.ok(isProxyBypassed(target, { NO_PROXY: '*' }));
        assert.ok(isProxyBypassed(target, { NO_PROXY: '.maven.apache.org' }));
        assert.ok(isProxyBypassed(target, { no_proxy: 'repo.maven.apache.org:443' }));
        assert.ok(!isProxyBypassed(target, { NO_PROXY: 'repo.maven.apache.org:8080' }));
        assert.ok(!isProxyBypassed(target, { NO_PROXY: 'example.org' }));
        assert.ok(!isProxyBypassed(target, {}));
    });

    test('NO_PROXY wins over a configured proxy', () => {
        const proxy = resolveProxyUrl(target, { proxy: 'http://settings:3128' }, { NO_PROXY: 'maven.apache.org' });
        assert.strictEqual(proxy, undefined);
    });
});
