---
title: Installation
layout: default
permalink: /installation/
description: Install the OSGi with bnd/bndtools extension from the Marketplace or a VSIX file, and verify that it works.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

## Prerequisites

| Requirement | Details |
|---|---|
| Visual Studio Code | Version **1.140.0** or later. |
| Java runtime | **Java 17 or later**. The bundled bnd language server and the bnd CLI run on it. Without Java the extension falls back to the Node server (editing support only). |
| Language Support for Java | Optional, but recommended. Extension `redhat.java` **1.56 or later**, whose JDT LS needs **Java 21 or later**. It enables the native import of bnd projects (source roots, classpath, compiler settings). |
| Debugger for Java | Required only for [Run and Debug]({{ '/run-debug/' | relative_url }}). Extension `vscjava.vscode-java-debug`. |
| bnd CLI | Optional. Only the [CLI commands]({{ '/cli/' | relative_url }}) need it. The extension can download it for you. |

> The JDT LS Java version (21+) is independent of the Java version that the bnd language server uses (17+) and of the `-runee` of the frameworks you launch.

## Install from the Marketplace

The published extension is **`klibio.bnd`** ("OSGi with bnd/bndtools").

1. Open the Extensions view with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd> (macOS: <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>).
2. Search for `OSGi with bnd/bndtools` or `klibio.bnd`.
3. Select **Install**.

Or use the command line:

```bash
code --install-extension klibio.bnd --force
```

You can also open the [Marketplace page]({{ site.marketplace_url }}) and select **Install**.

### Pre-release versions

Every successful CI build of the `main` branch is published as a Marketplace **pre-release**. Its version is `major.(minor+1).<build>`, for example `0.30.123`. To follow the pre-releases, either select **Switch to Pre-Release Version** on the extension page or run:

```bash
code --install-extension klibio.bnd --pre-release --force
```

Use **Switch to Release Version** to return to the stable channel.

## Install from a VSIX file

Every [GitHub release]({{ site.repository_url }}/releases) attaches the packaged extension as `bnd-<version>.vsix` together with its SHA-256 checksum. The release notes list the provenance of the bundled language server JARs.

**In the VS Code UI**

1. Download `bnd-<version>.vsix` from the release page.
2. Open the Extensions view.
3. Open the **...** (Views and More Actions) menu and select **Install from VSIX...**.
4. Select the file and reload VS Code if prompted.

**On the command line**

```bash
code --install-extension /path/to/bnd-<version>.vsix
```

## Build from source

Only needed if you want to change the extension. You need [Node.js](https://nodejs.org/) 20 and npm.

```bash
git clone https://github.com/peterkir/vscode-bnd-plugin.git
cd vscode-bnd-plugin
npm ci                   # client dependencies
npm ci --prefix server   # language server dependencies
npm run compile:all      # compile client and server
npm run package          # creates bnd-<version>.vsix
```

Install the resulting file as described above. Developer documentation, test setup, and the release process are in [DEV.md]({{ site.repository_url }}/blob/main/DEV.md).

## Verify the installation

1. Open any `.bnd` or `.bndrun` file. Keywords such as `-buildpath:` are highlighted.
2. Press <kbd>Ctrl</kbd>+<kbd>Space</kbd> on an empty line. Instruction and header completions appear.
3. Type `${` and press <kbd>Ctrl</kbd>+<kbd>Space</kbd>. Macro completions appear.
4. Hover over `-buildpath`. A documentation card with an example appears.
5. Look at the right side of the status bar. The **bnd LS** item shows the server state and mode (`java`, `node`, or `socket`).
6. Open the Command Palette (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>) and run **bnd: Restart Language Server**. Afterwards **bnd: Evaluate Macro (LSP)** and **bnd: Resolve Runbundles (LSP)** work in a bnd workspace.

If the **bnd LS** item shows `node`, the Java server is not running and only completion, hover, and highlighting are available. See [Language server modes]({{ '/language-server/#language-server-modes' | relative_url }}) and [Troubleshooting]({{ '/troubleshooting/' | relative_url }}).

## Workspace trust

Several features run code from your workspace: bnd evaluates macros, repository plugins, and launchers. Therefore the following features require a **trusted workspace**: Repositories, Effective properties, Resolution, automatic build, workspace wizards, and Run and Debug. Mark a folder as trusted via the banner VS Code shows when opening it, or via **Workspaces: Manage Workspace Trust**.

## Update

VS Code updates Marketplace extensions automatically unless you disabled auto-update. VSIX installations are updated by installing a newer VSIX over the old one. After upgrading an existing Java workspace to a version that changes the native project import, run **Java: Clean Java Language Server Workspace** once and allow the reimport.

## Uninstall

1. Open the Extensions view.
2. Search for `OSGi with bnd/bndtools`.
3. Select the gear icon and choose **Uninstall**.

Libraries the extension downloaded are kept in its global storage (`library/tool` and `library/lsp`). Files the extension created in your workspaces, such as `cnf/ext/vscode-outputs.bnd`, stay in place.
