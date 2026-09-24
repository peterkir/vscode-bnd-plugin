# Changelog

## 0.10.0 - 2026-09-24

### Added
- Support for selecting the bnd language server startup mode via `bnd.server.mode`.
- New Java-based, Node-based, and socket-based server startup paths.
- Explicit configuration for `bnd.server.jar`, `bnd.server.javaExecutable`, `bnd.server.jvmArgs`, and `bnd.server.socketPort`.
- Fallback behavior when the bundled language server JAR is missing: the extension warns and continues with the Node server.
- Restart command for the language server from the Command Palette.
- LSP-backed helper commands for resolving `.bndrun` files, building projects, and expanding macro expressions.
- Language association for `.mvn`, `packageinfo`, and `build.bnd` files.

### Improved
- Better environment compatibility for users who run the extension with custom Java installations or custom local server environments.
- More transparent startup diagnostics when the Java LSP JAR is absent or not usable.
- Clearer command and configuration documentation in the extension walkthroughs and installation guide.

### Fixed
- Server startup is now resilient when no bundled JAR is available.
- Language-server configuration is easier to override without editing code.

## Notes for Release

This update is primarily a reliability and configuration pass for the bnd language server. It makes the extension easier to run across different Java setups and more resilient in environments where only the Node-based server is available.
