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
- [ ] If a bnd Java repo is available, set `BND_SOURCE_REPO` or `BND_JAVA_REPO` before running tests.
- [ ] Confirm the extension host launches successfully.

## Manual editor verification
- [ ] Open a `.bnd` or `.bndrun` file in VS Code.
- [ ] Verify syntax highlighting and completion behavior.
- [ ] Press `Ctrl+Space` to confirm instruction completions.
- [ ] Type `${` and confirm macro completions.
- [ ] Hover over a known instruction and check the docs appear.
- [ ] Run `Bnd: Restart Language Server`.
- [ ] Confirm the selected server mode starts without errors.
- [ ] Run `Bnd: Resolve Runbundles (LSP)` on a `.bndrun` file.
- [ ] Run `Bnd: Build Project (LSP)` on a bnd project.
- [ ] Run `Bnd: Evaluate Macro (LSP)` and confirm the result is shown.

## Fallback validation
- [ ] Set `bnd.server.mode` to `java` with a valid Java runtime.
- [ ] Set `bnd.server.mode` to `node` and confirm the Node server starts.
- [ ] Set `bnd.server.mode` to `socket` and connect to a running LSP socket.
- [ ] Remove or move the bundled JAR temporarily and confirm the extension reports a warning and falls back.

## Packaging check
- [ ] Run `npm run package`.
- [ ] Confirm the VSIX is created successfully.
- [ ] Install the VSIX locally in VS Code.
- [ ] Open the extension and verify the same manual checks still work after install.

## Release signoff
- [ ] Confirm the docs and walkthroughs match the actual behavior.
- [ ] Confirm the changelog accurately reflects the shipped changes.
- [ ] Confirm there are no open blockers from compile or runtime validation.
