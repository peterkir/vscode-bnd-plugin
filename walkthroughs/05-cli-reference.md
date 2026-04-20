# CLI Reference Panel

The **Bnd: Show CLI Reference** command opens a searchable webview panel containing all 77 bnd CLI sub-commands with their full option lists and examples from the official documentation.

## Opening the Panel

Run `Ctrl+Shift+P` → **Bnd: Show CLI Reference**.

The panel opens beside your editor. It stays open until you close it; re-running the command brings it back into focus.

## Using the Panel

- **Search box** — type any keyword (command name, option, or description fragment) to filter the list in real time.
- **Expandable entries** — click any command row to expand it and see:
  - The full `bnd <subcommand> [options]` synopsis.
  - All short and long option flags with descriptions.
  - One or more usage examples.
- **Counter** — the panel shows how many commands match the current filter.

## Example Workflow

1. You want to check the options for `bnd wrap`.
2. Open the CLI Reference panel.
3. Type `wrap` in the search box.
4. Expand the `wrap` entry to see flags like `--output`, `--bsn`, and `--version`.
