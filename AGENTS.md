# Agents for vscode-bnd

This file is the repository's instruction source for contributors and AI coding agents.

## Project Context

- Project type: VS Code extension + LSP server
- Goal: improve editing and CLI usage support for the bnd tool
- Architecture: extension host/client code is in `src/`, language-server code is in `server/src/`, and the TextMate grammar is in `syntaxes/bnd.tmLanguage.json`. Keep editor concerns in the client, language intelligence in the server, and generated command/reference data in data modules.
- Upstream canonical docs:
  - https://github.com/bndtools/bnd/tree/master/docs
  - https://bnd.bndtools.org/
  - https://bnd.bndtools.org/commands/overview.html
  - https://bnd.bndtools.org/instructions/
  - https://bnd.bndtools.org/macros/
  - https://bnd.bndtools.org/headers/
- For bnd data, prefer the upstream repository docs, then the published manual, then the command and reference hubs. Do not invent options or syntax.

## Agent Modes

### 1) Extension Client Agent

Use for changes in:

- `src/extension.ts`
- `src/bndCliCommands.ts`
- `src/bndLaunch.ts`
- `package.json` command/menu/config contributions

Responsibilities:

- Command registration and UX in Command Palette.
- Terminal command execution patterns.
- File pickers and command argument assembly.
- Safe confirmations for risky operations.

Guardrails:

- Keep behavior aligned with bnd CLI semantics.
- Use the bnd CLI only in the explicit `bnd-cli:` commands of `src/bndCliCommands.ts`. Every other feature (build, clean, export, launch, resolve, baseline, repositories, wizards, effective properties, JAR viewer, automatic build) must go through the language server (`bnd.*` server commands) or the extension's own code. Never spawn `bnd`, run `bnd.cli.executable`, or send CLI text to a terminal from another module. If the server lacks a capability, say so to the user instead of falling back to the CLI. The test `bnd CLI isolation` in `src/test/suite/cliInvocation.test.ts` enforces this; extend its allow-list only deliberately.
- Respect `bnd.cli.executable` as user-configured command.
- Prefer minimal and reversible UX changes.
- Keep command invocation safe and explicit, prefer workspace-relative picked paths when appropriate, and confirm destructive or publish-like operations.
- Wire added CLI commands consistently through `package.json`, registration in `src/bndCliCommands.ts`, and command metadata/data sources.

### 2) Language Server Agent

Use for changes in:

- `server/src/server.ts`
- `server/src/bndData.ts`

Responsibilities:

- Completion and hover behavior.
- Trigger characters and context detection.
- Data-driven docs and examples.

Guardrails:

- Keep responses fast and deterministic.
- Avoid I/O in request handlers unless strictly needed.
- Preserve protocol-compatible behavior.
- Keep completion and hover content aligned with upstream bnd syntax, and prefer plain-text insertion snippets unless richer snippets are needed and tested.

### 3) Documentation Sync Agent

Use for:

- Updating instruction/header/macro/command datasets.
- Aligning wording/examples with upstream docs.

Responsibilities:

- Verify data against canonical docs pages.
- Keep naming and syntax exact.
- Avoid undocumented shortcuts unless already supported by bnd docs.

Guardrails:

- Never invent CLI options or instruction syntax.
- Prefer official examples where available.
- Document assumptions if canonical docs conflict.

### 4) Release and Validation Agent

Use for:

- Pre-release checks and packaging readiness.

Responsibilities:

- Compile extension and server.
- Check command wiring consistency.
- Verify user-visible docs for changed behaviors.

Guardrails:

- Do not include unrelated refactors.
- Keep changes scoped to validated requirements.

## Working Agreements

- Implement the smallest useful change first.
- Keep client/server separation clear.
- Treat upstream bnd docs as source of truth.
- Prefer data updates over logic changes when behavior intent is unchanged.
- Keep user-facing terms consistent with bnd documentation.
- Write and maintain all repository documentation in English.
- For every code change, update the extension version in `package.json` and `package-lock.json` using Semantic Versioning: patch for compatible fixes, minor for compatible features, major for breaking changes. Do not create tags or commits unless requested.
- For every code change, update developer documentation (`DEV.md` or another relevant developer guide) and user documentation (`README.md` or another relevant user guide). Update the GitHub Pages source in `docs/` whenever the change applies to the site, and update `CHANGELOG.md` for user-visible changes. Keep all affected documentation consistent with each other and with the implementation.
- Review affected documentation for every change; correct outdated commands, settings, examples, links, and version references. Validate the resulting documentation against the implementation, current CLI semantics, and canonical bnd documentation.
- Use official examples where possible and keep instruction, header, macro, command, and option terminology consistent. Record assumptions when upstream documentation is ambiguous.
- Run the complete test suite after every code change. Do not report a change as fully validated unless the entire suite passes; report blockers and skipped tests explicitly.
- Add test cases for every behavior a code change introduces or fixes, in the existing suite files (`src/test/suite/*.test.ts`, Java tests next to the changed LSP class). A fix needs a test that fails without it.
- Line coverage must not drop. Run `npm run test:coverage` on the change and on its base branch (`origin/main`) and compare the `All files` line percentage and the changed files; report both numbers in the PR. If coverage drops, add tests or explain why in the PR.
- The Java language server lives upstream in bnd `master` (`biz.aQute.bnd.lsp`, `org.bndtools.jdtls.adapter`). For language server changes, create a `fea-<topic>` or `bug-<topic>` branch from bnd `master` in the bnd fork, push it to the fork, and open a PR against `bndtools/bnd` `master`. Then rebuild the JARs, run `npm run server:update` (or `node scripts/bundledJars.mjs lock --workspace <bnd checkout>` after copying a single JAR), and reference the bnd PR in the extension PR.

## Test and Build Workflow

- Install dependencies:
  - `npm install`
  - `npm install --prefix server`
- Build all TypeScript targets:
  - `npm run compile:all`
- Verify the bundled language server JARs against `server/bundled-jars.json` (also part of CI and `npm test`):
  - `npm run server:verify`
- After rebuilding the Java language server, copy the JARs and rewrite the lock file:
  - `npm run server:update`
- Build extension tests:
  - `npm run compile:tests`
- Run VS Code extension tests:
  - `npm test`
- Measure line coverage (c8; CI publishes the same figure as the README badge):
  - `npm run test:coverage`
  - `node scripts/coverageBadge.mjs coverage/lcov.info <output.json>` prints the line percentage
- Build the Java language server in a bnd checkout (JDK 21+ runs Gradle; the LSP targets Java 17):
  - `./gradlew :biz.aQute.bnd.lsp:build` runs its tests and writes `biz.aQute.bnd.lsp/generated/biz.aQute.bnd.lsp.jar`
  - Every bnd project includes `cnf/includes/jdt.bnd`, which reads `.settings/org.eclipse.jdt.core.prefs`. If a project lacks that file, copy `cnf/.settings/org.eclipse.jdt.core.prefs` (Java 17) locally; do not copy the Java 21 prefs of `org.bndtools.jdtls.adapter` to `biz.aQute.bnd.lsp`, or the JAR no longer starts on Java 17.
  - Smoke-test the JAR with Java 17: `java -jar server/biz.aQute.bnd.lsp.jar` must log `Starting bnd Language Server on stdio`.
- For code changes, run `npm run compile:all`, `npm run compile:tests`, and the complete `npm test` suite with `BND_SOURCE_REPO` (or `BND_JAVA_REPO`) set to an existing bnd source repository. Do not rely on a skipped upstream test or a partial test run.
- Package VSIX:
  - `npm run package`
- Release gates for an annotated tag (run by the Release workflow; usable locally before pushing a tag):
  - `npm run release:check -- vX.Y.Z`

### Upstream Java Repo-Based Tests

- The extension test suite can validate CLI command parity against bnd Java source in `biz.aQute.bnd/src/aQute/bnd/main/bnd.java`.
- To enable this check, set one of:
  - `BND_SOURCE_REPO=<path-to-bnd-repo>`
  - `BND_JAVA_REPO=<path-to-bnd-repo>`
- If neither variable is set, tests also try sibling folder `../bnd`.
- If no bnd source repo is available, upstream-parity tests are skipped (not failed).

## Done Criteria

A task is complete when:

- Code compiles for both client and server.
- Extension tests compile and pass (`npm test`).
- New or fixed behavior has test cases, and line coverage (`npm run test:coverage`) is not lower than on the base branch.
- Language server changes are on a `fea-`/`bug-` branch with a PR against `bndtools/bnd` `master`.
- The full test suite runs without unintentional skips; any blocker is disclosed rather than counted as a pass.
- Affected commands or language features are validated in-context.
- For changes to language data, manually sanity-check at least one completion and one hover case.
- Developer and user documentation are updated for every code change, and the GitHub Pages source is updated when applicable. Documentation is in English, matches current code and CLI behavior, and its references remain accurate.
- Code changes include the appropriate Semantic Versioning bump in both extension package files.
- Changes are minimal, focused, and easy to review.
