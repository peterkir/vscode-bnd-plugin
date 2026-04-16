# Agents for vscode-bnd

This file defines recommended working modes for contributors and coding agents operating in this repository.

## Project Context

- Project type: VS Code extension + LSP server
- Goal: improve editing and CLI usage support for the bnd tool
- Upstream canonical docs:
  - https://github.com/bndtools/bnd/tree/master/docs
  - https://bnd.bndtools.org/
  - https://bnd.bndtools.org/commands/overview.html
  - https://bnd.bndtools.org/instructions/
  - https://bnd.bndtools.org/macros/
  - https://bnd.bndtools.org/headers/

## Agent Modes

### 1) Extension Client Agent

Use for changes in:

- `src/extension.ts`
- `src/bndCliCommands.ts`
- `package.json` command/menu/config contributions

Responsibilities:

- Command registration and UX in Command Palette.
- Terminal command execution patterns.
- File pickers and command argument assembly.
- Safe confirmations for risky operations.

Guardrails:

- Keep behavior aligned with bnd CLI semantics.
- Respect `bnd.cli.executable` as user-configured command.
- Prefer minimal and reversible UX changes.

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

## Done Criteria

A task is complete when:

- Code compiles for both client and server.
- Affected commands or language features are validated in-context.
- Documentation references remain accurate.
- Changes are minimal, focused, and easy to review.
