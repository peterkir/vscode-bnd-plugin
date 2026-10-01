# Changelog

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
