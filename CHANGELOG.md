# Changelog

## 0.14.0

### Added
- A bundled headless JDT LS adapter imports bnd Java projects natively, ahead of Gradle, with source/test roots, separate outputs, compiler/JRE settings and resolved build/test dependencies. Requires Red Hat Java 1.56 or later and Java 21 or later for JDT LS.
- Native classpath refresh for `.bnd` and `.mvn` changes, including workspace configuration under `cnf`.
- Debugger source paths for launched workspace bundles, with optional `sourcePaths` and `projectName` launch overrides.
- `npm run test:jdtls` validates import and live classpath refresh in an isolated real JDT LS.

## 0.13.1

### Fixed
- Launch cleanup and Effective properties requests use the typed LSP execute-command request so an omitted cancellation token does not become an extra JSON-RPC parameter rejected by the Java server.

## 0.13.0

### Added
- Run and debug `.bndrun` files, bnd projects, and OSGi tests through VS Code's Run and Debug facility. A new `bnd` debug type asks the Java language server to prepare the launch (`bnd.launch.prepare`) and hands it to Debugger for Java; `bnd.launch.dispose` cleans up when the session ends.
- Run/Debug CodeLens (`bnd.launch.codeLens`), editor title run menu, Explorer context menu, and commands **Bnd: Run OSGi Framework**, **Bnd: Debug OSGi Framework**, **Bnd: Run OSGi Tests (Launch)**, **Bnd: Debug OSGi Tests**.
- `launch.json` snippets and dynamic configurations for all `.bndrun` files and test projects.
- Walkthrough step **Run and Debug OSGi Frameworks**.

### Changed
- Bundled Java language server adds `bnd.launch.prepare` and `bnd.launch.dispose`, and resolves the project for files inside a project directory (fixes **Build Project (LSP)** on `bnd.bnd`).

## 0.12.0

### Added
- **Bnd: Select Language Server JAR...** chooses the Java language server JAR: bundled, release (Maven Central), snapshot (bndtools Artifactory), custom https URL, or local file.
- Settings `bnd.server.jarSource`, `bnd.server.jarVersion` (`latest` follows new versions), `bnd.server.jarUrl`, and `bnd.server.jarSha256` (machine-scoped).
- Downloaded language server JARs are verified (`.sha1` for repository downloads, optional SHA-256 for custom URLs), cached in global storage, and fetched in the background while the bundled JAR keeps the server available.

### Fixed
- A configured but missing `bnd.server.jar` now produces a warning instead of silently using the bundled JAR.
- Several language server setting changes in a row trigger a single restart.

### Improved
- CI runs the full extension test suite on Java 17 under Xvfb, against the bnd `fea-bnd-ls` sources and a checksum-verified bnd 7.4.0 CLI JAR, before packaging.

## 0.11.3

### Changed
- Dependencies: `vscode-languageclient` 10.1.2, `vscode-languageserver` 10.1.2, `vscode-languageserver-textdocument` 1.0.15, `@types/node` 26.6.3, `@vscode/test-electron` 3.1.0, TypeScript 7.0.2.
- The **bnd Language Server** output channel is a log channel (required by `vscode-languageclient` 10); server stderr appears as error entries.

## 0.11.1

### Improved
- Extension client and fallback language server are bundled with esbuild; the VSIX shrinks from about 1,290 files to 25 and the Marketplace bundling warning is resolved.
- CI and release workflows pin the `ubuntu-24.04` runner instead of `ubuntu-latest`, ahead of the Ubuntu 26 label migration.
- Release workflow names the GitHub Release `bnd v<version>`, attaches `bnd-<version>.vsix` for download, and fails when no VSIX is produced; install docs point to GitHub Releases.

## Unreleased

### Added
- Optional **Bnd Effective** file editor with side-by-side display, expanded and merged properties, provenance navigation, filtering, and generated read-only source.
- Java LSP effective-property snapshots for unsaved current-file changes, with trust enforcement and saved-dependency refresh.
- Support for selecting the bnd language server startup mode via `bnd.server.mode`.
- New Java-based, Node-based, and socket-based server startup paths.
- Explicit configuration for `bnd.server.jar`, `bnd.server.javaExecutable`, `bnd.server.jvmArgs`, and `bnd.server.socketPort`.
- Fallback behavior when the bundled language server JAR is missing: the extension warns and continues with the Node server.
- Restart command for the language server from the Command Palette.
- LSP-backed helper commands for resolving `.bndrun` files, building projects, and expanding macro expressions.

### Improved
- Better environment compatibility for users who run the extension with custom Java installations or custom local server environments.
- More transparent startup diagnostics when the Java LSP JAR is absent or not usable.
- Clearer command and configuration documentation in the extension walkthroughs and installation guide.

### Fixed
- Server startup is now resilient when no bundled JAR is available.
- Language-server configuration is easier to override without editing code.

## Validation

The extension and TypeScript server compile successfully. All 14 VS Code extension tests pass, including a live Java LSP round-trip and the Effective editor/source workflow.

Evidence from the latest run:

- `npm run compile:all` completed successfully.
- `npm test` completed with 14 passing tests.
- The Java LSP module build and tests passed. Its JAR was built in an isolated output directory because a running development server held the default output JAR open on Windows.

## Notes for Release

This update is primarily a reliability and configuration pass for the bnd language server. It makes the extension easier to run across different Java setups and more resilient in environments where only the Node-based server is available.
