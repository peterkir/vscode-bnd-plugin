# Changelog

## 0.22.1

### Added
- Open repository artifacts in the bnd JAR Viewer by activating a bundle (newest version) or a specific version; add an **Open in bnd JAR Viewer** context action.

## 0.20.3

### Fixed
- **Run OSGi** in a terminal no longer fails with "Specified launch file ... was not found". The debug session ends right after spawning the JVM, so the generated `launch*.properties` file is now kept until the same target is launched again or the language server shuts down.

## 0.20.2

### Changed
- Hide CLI palette commands by default, including before extension activation. The visibility toggle remains available; saved choices and explicit settings are preserved.

## 0.20.1

### Fixed
- Persist CLI palette visibility in extension global storage instead of editing User settings, so invalid or unwritable settings do not block the toggle. Restore visibility on activation; `bnd.cli.showCommands` remains the initial default before the first toggle.

## 0.20.0

### Added
- **bnd-cli: Toggle CLI Commands in Command Palette** saves the User preference `bnd.cli.showCommands` (default `true`) to show or hide all other CLI palette entries. The toggle remains available; context menus and command execution are unchanged.

### Changed
- CLI commands use the `bnd-cli:` palette prefix; language-server and other extension actions use `bnd:`. Command IDs remain unchanged.

## 0.19.5

### Fixed
- Show launch/debug actions for `.bndrun` and `bnd.bnd` files in the bnd Explorer using the selected tree item's context, not editor resource keys. Apply the same fix to Effective, Resolution, and JAR actions while preserving standard file actions.

## 0.19.4

### Fixed
- Crop the bnd Activity Bar icon to its artwork and use a theme-aware, visible stroke.

## 0.19.3

### Fixed
- Use the current `media/bndtools.svg` for the bnd Activity Bar container after removing the former dedicated icon.

## 0.19.2

### Fixed
- Java language server document symbols use source line lengths and key offsets, fixing `selectionRange must be contained in fullRange` for short or empty header values and correcting indented header selections.
- Add real Java LanguageClient regression coverage for symbol conversion with LF and CRLF documents and multiline headers.

## 0.19.1

### Fixed
- Preserve repository browsing, bnd Explorer, JAR Viewer, Resolution, launch/debug, and Effective features when merging current `main`.
- Include the Windows `.bndrun` URI fix and its regression test alongside the feature branch's manifest tests.

### Changed
- Integrate `main` dependency updates: Mocha 12.0.3 and `@types/node` 26.6.4.

## 0.19.0

### Added
- The bnd Explorer offers the built-in Explorer's context menu and keys: New File/Folder, Open to the Side, Open With, Reveal in File Explorer, Open in Integrated Terminal, Find in Folder, Cut/Copy/Paste, Copy Path/Relative Path, Rename, Delete, and compare. Drag and drop moves files inside the tree and copies dropped external files.
- Open Effective and Open Effective to Side on `.bnd`/`.bndrun` files in the bnd Explorer.

### Changed
- Selecting repository bundles or versions replaces Resolution's analyzed resources; unversioned bundles use the newest listed version. Drag-and-drop and **Analyze in Resolution View** append resources instead. Resource choices persist per workspace.
- Document the Resolution analysis limit of 100 saved resources, first-sub-builder behavior for `bnd.bnd`, and capability matching rather than full OSGi resolution.
- Document **Java: Reload Projects** and `java.configuration.updateBuildConfiguration` for native bnd classpath refreshes.

## 0.18.3

### Fixed
- **Bnd: Run/Debug OSGi Framework** and **Run/Debug OSGi Tests** no longer require an active `.bndrun` or `bnd.bnd` editor. From any other editor they show a searchable list of the workspace's `.bndrun` and `bnd.bnd` files.

### Added
- Run and Debug actions in the context menu of `.bndrun` and `bnd.bnd` files in the bnd Explorer view.

## 0.18.2

### Fixed
- Register the Resolution Panel view as a webview so its provider displays content, and label the Panel container **Resolution**.
- Accept drag-and-drop of repository bundle versions into the Resolution view for requirement/capability analysis.

## 0.18.1

### Changed
- Use the dedicated `media/bndtools-activity.svg` icon for the bnd Activity Bar container.

## 0.18.0

### Added
- **Resolution** Panel view, porting the bndtools Resolution View's side-by-side OSGi requirements and capabilities analysis for selected `.bnd` files, JARs, and repository versions.
- Wildcard/multi-term filtering, optional and unresolved requirement filters, copyable row details, and resource add/remove actions.
- Java LSP command `bnd.resolution.analyze` returns structured resource requirements, capabilities, and matches without modifying source files.

## 0.17.0

### Added
- **bnd JAR Viewer**, a port of the bndtools Eclipse JAR editor and the default editor for `.jar` files. The **Tree** page lists the archive entries, selects `feature.xml` or `META-INF/MANIFEST.MF` initially, and shows the selected entry as text or hex (Auto/Text/Binary (hex)), with a text encoding choice, size, last modified time and the 1,000,000-byte read limit. Double-click an entry to open it read-only in an editor (`bnd-jar:` scheme). The **Print** page shows the full `bnd print` report from the Java language server.
- **Open with bnd JAR Viewer** in the Explorer and bnd Explorer context menus for `.jar` files.

### Changed
- Bundled Java language server adds `bnd.jar.printText`, which returns the bndtools JAR editor print report (all `JarPrinter` options).

## 0.16.0

### Added
- Independent read-only Explorer above Repositories in the bnd Activity Bar container, with multi-root browsing, native file icons, file opening, refresh/collapse, relative-path copying, native Explorer reveal and file dragging.
- `bnd.explorer.exclude` controls hidden file/folder names independently of the built-in Explorer. User-customized view ordering remains preserved.

## 0.15.0

### Added
- **bnd** Activity Bar container with a **Repositories** view, a port of the bndtools Eclipse Repositories view. It shows one root per bnd workspace (`cnf/build.bnd`), with the Workspace repository (projects and their bundles), plugin repositories, bundles, versions, and P2 features with their included and required items.
- View actions: filter by bundle symbolic name, advanced requirement search (package, service, or any namespace and LDAP filter), refresh, collapse all, and toggle offline mode.
- Item actions: add JARs to writable repositories (also by dropping files on a repository), download remote content, copy the bundle symbolic name, version, or bnd entry, reveal the JAR, show the manifest, and run repository-specific `Actionable` actions.
- Drag bundles or versions into a bnd editor to insert `bsn;version=...` entries.
- Walkthrough step **Browse Repositories**.

### Changed
- Bundled Java language server adds `bnd.repositories.*` commands and `bnd.workspace.offline`. All of them require workspace trust.

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

Validation for 0.19.0 on 2026-10-06: the extension and TypeScript server compile successfully. All 102 VS Code extension tests pass, including CLI execution, upstream command parity, real Java LSP repository/JAR/Resolution round-trips, and the Effective editor/source workflow. No tests were skipped.

Evidence from the latest run:

- `npm run compile:all` completed successfully.
- `npm run compile:tests` completed successfully through `npm test`'s pretest step.
- `npm test` completed with 102 passing tests and `BND_SOURCE_REPO` pointing to the upstream `fea-bnd-ls` worktree. VS Code paths were excluded from the test command's `PATH` to use an isolated downloaded test host instead of the running editor.
- `./gradlew :biz.aQute.bnd.lsp:test :biz.aQute.bnd.lsp:jar` passed in the upstream worktree. The bundled and generated Java LSP JARs have identical SHA-256 hashes.
- This automated run does not replace the manual view, launch/debug, and native JDT LS checks in `CHECKLIST.md` and `DEV.md`.

## Notes for Release

This update is primarily a reliability and configuration pass for the bnd language server. It makes the extension easier to run across different Java setups and more resilient in environments where only the Node-based server is available.
