# bnd-lsp

A Java [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) (LSP) server for [bnd](https://bnd.bndtools.org/) files (`.bnd`, `.bndrun`).

## Features

- **Completion** — Instructions (starting with `-`) and OSGi headers, populated directly from `aQute.bnd.help.Syntax.HELP` at startup.
- **Hover** — Markdown hover documentation with description, example, and a link to the bnd docs.

## Requirements

- Java 17 or newer.

## Running

```bash
java -jar bnd-lsp-<version>.jar
```

The server reads LSP messages from **stdin** and writes LSP messages to **stdout**.  
All log output is written to **stderr**.

## Building from Source

```bash
./gradlew shadowJar
# Produces: build/libs/bnd-lsp-<version>.jar
```

### Releasing

On a tag push (`vX.Y.Z`) GitHub Actions builds the fat JAR and publishes it as a GitHub Release asset named `bnd-lsp.jar`.

## Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| `org.eclipse.lsp4j:org.eclipse.lsp4j` | 0.23.1 | LSP protocol types |
| `org.eclipse.lsp4j:org.eclipse.lsp4j.jsonrpc` | 0.23.1 | JSON-RPC transport |
| `biz.aQute.bnd:biz.aQute.bndlib` | 7.1.0 | bnd metadata/Syntax API |
| `org.slf4j:slf4j-simple` | 2.0.9 | Logging to stderr |

## Versioning

`bnd-lsp` is versioned independently of bndlib.  
The compatible bndlib version is documented in each GitHub Release.

| bnd-lsp | bndlib |
|---|---|
| 0.1.x | 7.1.0 |

## Usage with VS Code

The `vscode-bnd-plugin` extension auto-downloads the latest `bnd-lsp.jar` from [GitHub Releases](../../releases) and launches it automatically. See that extension's README for details.

## License

Eclipse Public License 2.0 (EPL-2.0)
