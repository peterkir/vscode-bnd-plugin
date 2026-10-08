# Release Validation Checklist

## Environment and setup
- [ ] Install dependencies with `npm install`.
- [ ] Install the server dependencies with `npm install --prefix server`.
- [ ] Ensure the target Java runtime is available for the `java` server mode.
- [ ] Confirm whether the bundled LSP JAR is present in `server/biz.aQute.bnd.lsp.jar`.

## Compile checks
- [ ] Run `npm run compile`.
- [ ] Run `npm run compile:server`.
- [ ] Run `npm run compile:all`.
- [ ] Run `npm run compile:tests`.
- [ ] Confirm there are no TypeScript errors.

## Extension test checks
- [ ] Close VS Code if an update is running.
- [ ] Run `npm test`.
- [ ] If the test host fails with `Code is currently being updated`, wait for the update to finish and retry.
- [ ] Set `BND_SOURCE_REPO` or `BND_JAVA_REPO` to an existing bnd source repo before running tests; upstream parity checks must not be skipped.
- [ ] Confirm the extension host launches successfully.
- [ ] Confirm the complete suite passes and report any failures or unexpected skips.
- [ ] For Java LSP changes, run `./gradlew :biz.aQute.bnd.lsp:test :biz.aQute.bnd.lsp:jar` in the upstream checkout and update the bundled JAR before `npm test`.

## Manual editor verification
- [ ] Open a `.bnd` or `.bndrun` file in VS Code.
- [ ] Verify syntax highlighting and completion behavior.
- [ ] Press `Ctrl+Space` to confirm instruction completions.
- [ ] Type `${` and confirm macro completions.
- [ ] Hover over a known instruction and check the docs appear.
- [ ] Run `bnd: Restart Language Server`.
- [ ] Confirm the selected server mode starts without errors.
- [ ] Run `bnd: Resolve Runbundles (LSP)` on a `.bndrun` file.
- [ ] Run `bnd: Build Project (LSP)` on a bnd project.
- [ ] Run `bnd: Evaluate Macro (LSP)` and confirm the result is shown.
- [ ] Run `bnd-cli: Toggle CLI Commands in Command Palette`; verify other CLI entries hide and return, the toggle stays visible, User settings are unchanged, and the extension's stored choice survives reload.

## Views and launch verification
- [ ] Verify bnd Explorer multi-root browsing, exact-name exclusions, create/rename/delete, cut/copy/paste, drag-and-drop, and compare actions.
- [ ] Open Effective to Side from the bnd Explorer and verify unsaved source edits, provenance, and dependency refresh.
- [ ] Browse Workspace/plugin repositories and P2 features, filter, search for providers, copy entries, and drag an entry into a bnd editor.
- [ ] Add JARs to a writable repository, fetch remote content, toggle offline mode, and check repository actions.
- [ ] Open a JAR, inspect text/hex and encoding/read-limit controls, open an entry read-only, search Print, and verify archive-change refresh.
- [ ] Analyze saved `.bnd`/`.jar` resources in Resolution; confirm repository selection replaces resources and drops append them.
- [ ] Verify matching/unmatched requirements, optional filters, row copying, add/remove/clear, and persisted resource choices.
- [ ] Run/debug from CodeLens, both Explorer menus, and the Command Palette without a launch file active; verify breakpoints, OSGi tests, and launch cleanup.
- [ ] Verify native Java import and classpath refresh with Red Hat Java 1.56+ on Java 21+; run `npm run test:jdtls` with the variables documented in `DEV.md`.
- [ ] Verify **Java: Reload Projects** refreshes imported bnd projects without clearing the Java workspace.

## Fallback validation
- [ ] Set `bnd.server.mode` to `java` with a valid Java runtime.
- [ ] Set `bnd.server.mode` to `node` and confirm the Node server starts.
- [ ] Set `bnd.server.mode` to `socket` and connect to a running LSP socket.
- [ ] Remove or move the bundled JAR temporarily and confirm the extension reports a warning and falls back.
- [ ] Confirm Node/older servers show unsupported states for Repositories, Effective, Resolution, and JAR Print while JAR Tree remains usable.
- [ ] Confirm untrusted workspaces block repository commands, Effective evaluation, Resolution analysis, and launches.

## Packaging check
- [ ] Run `npm run package`.
- [ ] Confirm the VSIX is created successfully.
- [ ] Install the VSIX locally in VS Code.
- [ ] Open the extension and verify the same manual checks still work after install.

## Release signoff
- [ ] Confirm the docs and walkthroughs match the actual behavior.
- [ ] Confirm the changelog accurately reflects the shipped changes.
- [ ] Confirm there are no open blockers from compile or runtime validation.
