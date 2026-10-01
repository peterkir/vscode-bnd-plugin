# Copilot Instructions for vscode-bnd

This repository contains a VS Code extension with a separate Language Server Protocol (LSP) server for bnd and bndrun files.

## Mission

- Support editing of `.bnd` and `.bndrun` files with accurate language features.
- Support practical use of bnd CLI capabilities directly from VS Code.
- Keep docs and command behavior aligned with upstream bnd documentation and command semantics.

## Architecture Boundaries

- Extension host/client code: `src/`
- Language server code: `server/src/`
- TextMate grammar: `syntaxes/bnd.tmLanguage.json`

When implementing features:

- Put editor process concerns in client code (`src/extension.ts`, `src/bndCliCommands.ts`).
- Put completion/hover and language intelligence in server code (`server/src/server.ts`).
- Keep generated command/reference data in data modules and avoid ad-hoc hardcoding.

## Sources of Truth

Use these in priority order when adding or correcting bnd data:

1. Upstream bnd docs in the bnd repository docs tree:
   - https://github.com/bndtools/bnd/tree/master/docs
2. Published bnd manual site:
   - https://bnd.bndtools.org/
3. Command and reference hubs:
   - https://bnd.bndtools.org/commands/overview.html
   - https://bnd.bndtools.org/instructions/
   - https://bnd.bndtools.org/macros/
   - https://bnd.bndtools.org/headers/

Do not invent option names, syntaxes, defaults, or examples when canonical docs exist.

## CLI Integration Rules

- Respect the configurable executable command from `bnd.cli.executable`.
- Keep command invocation safe and explicit.
- Prefer workspace-relative paths for picked files where this matches current command behavior.
- For destructive or publish-like commands (for example release), keep confirmation prompts.
- If adding commands, wire them consistently across:
  - `package.json` contributions
  - command registration in `src/bndCliCommands.ts`
  - command metadata/data sources

## LSP Behavior Rules

- Keep server responses deterministic and fast.
- Avoid blocking operations in completion/hover handlers.
- Ensure completion and hover content reflect upstream bnd syntax and wording.
- Favor plain-text insertion snippets unless richer snippets are clearly needed and tested.

## Documentation and Data Quality

- Prefer examples that match official docs language and syntax.
- Keep terminology consistent: instruction, header, macro, command, option.
- When docs are ambiguous, note assumptions in the PR or commit message and keep changes minimal.
- Write all repository documentation in English, including new or revised examples and release notes.
- Review affected documentation after every change; correct obsolete commands, settings, examples, links, and version references, then validate them against current code and bnd CLI behavior.

## Change Hygiene

- Make small, focused changes.
- Preserve existing coding style and file organization.
- Update README content when user-visible behavior changes.
- Do not refactor unrelated areas while adding command/doc updates.
- For every code change, bump the extension version in `package.json` and `package-lock.json` according to Semantic Versioning: patch for compatible fixes, minor for compatible features, major for breaking changes. Do not create commits or tags unless requested.

## Validation Checklist

Before completing work:

- Build extension and server TypeScript successfully.
- Compile extension tests and run the entire extension test suite (`npm run compile:tests` and `npm test`) after every code change. Set `BND_SOURCE_REPO` or `BND_JAVA_REPO` to an existing bnd source repository so repo-dependent tests run instead of skipping. Do not claim full validation if tests fail, are blocked, or are skipped unexpectedly.
- Confirm command registration and invocation paths are consistent.
- Manually sanity-check at least one completion and one hover case when touching language data.
- Verify documentation accuracy, English wording, and links to canonical bnd docs.

## Extension Test Runner

- The repository uses VS Code Extension Test Runner via `@vscode/test-electron`.
- Standard test flow:
   - `npm run compile:all`
   - `npm run compile:tests`
   - `npm test`

## Upstream Java Source Parity Checks

- Upstream command parity tests can validate extension CLI command coverage against:
   - `biz.aQute.bnd/src/aQute/bnd/main/bnd.java`
- Configure source repo path with one of:
   - `BND_SOURCE_REPO`
   - `BND_JAVA_REPO`
- If unset, tests try sibling path `../bnd`.
- If no source repo is found, parity tests are skipped.
