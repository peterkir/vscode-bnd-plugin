# Release Validation Checklist

Follow the [development guide](DEV.md) for local development and the [PR-to-Marketplace procedure](DEV.md#6-publishing) for commands. Complete the gates in order; neither main CI nor a GitHub Release alone proves Marketplace publication.

## Environment and setup
- [ ] Install locked dependencies with `npm ci`.
- [ ] Install locked server dependencies with `npm ci --prefix server`.
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
- [ ] Set `BND_CLI_JAR` to a bnd CLI 7.4.0 JAR for real CLI invocation coverage, matching CI.
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
- [ ] For code changes, apply the appropriate SemVer bump in both `package.json` and `package-lock.json` before committing; documentation-only changes need no bump.

## PR and remote artifact
- [ ] Review the diff, stage only intended files, commit with `git commit -s`, push a `fea-...` branch, and open a PR targeting main.
- [ ] Include local validation results, manual checks, and any Java JAR provenance in the PR.
- [ ] Wait for current PR CI and required reviews; do not reuse an older green run.
- [ ] Check the CI run's PR/revision and test its downloaded VSIX with `bash scripts/try-ci-vsix.sh <run-id> <sample-folder>`.
- [ ] Confirm the isolated installed version, packaged Java JAR selection, and changed behavior; install Java/debug dependencies separately when needed.
- [ ] Record the CI run URL and packaged smoke-test results before merging.

## Main validation and Marketplace release
- [ ] Merge the reviewed PR using an allowed merge method, update local main, and identify the exact merged commit.
- [ ] Wait for successful main push CI for that commit and repeat the remote VSIX smoke tests.
- [ ] Confirm a clean worktree, changelog, matching package/lock versions, and a version not already published to Marketplace.
- [ ] Confirm repository Actions secret `VSCE_PAT` is configured for publisher `klibio`; never expose its value.
- [ ] Create `v<package-version>` on the validated main commit and push only that tag; do not move published tags.
- [ ] Wait for Release and inspect the Marketplace publish step explicitly. Release skips publishing without the secret and does not run tests or validate tag/version equality.
- [ ] Verify the GitHub Release VSIX and expected version on Marketplace (`klibio.bnd`).
- [ ] Install from Marketplace in a fresh isolated profile, confirm the installed version, and repeat relevant smoke tests.
- [ ] Record tag, commit, CI/Release run URLs, installed version, and verification results. If publishing failed, check whether the version already exists before retrying.
