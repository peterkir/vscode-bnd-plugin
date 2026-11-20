---
title: JAR Viewer
layout: default
permalink: /jar-viewer/
description: Inspect JAR files with the bnd JAR Viewer - archive tree, manifest, and the bnd print report.
---

`.jar` files open in the **bnd JAR Viewer** by default. It is a port of the Bndtools Eclipse JAR editor and never modifies the JAR.

## Opening a JAR

- Open any `.jar` file from the Explorer.
- Use **Open with bnd JAR Viewer** in the context menu of the Explorer or the bnd Explorer.
- Use **Reopen Editor With...** to switch between the viewer and other editors.
- Activate a bundle in the [Repositories view]({{ '/repositories/' | relative_url }}). The newest JAR opens in the viewer. A version opens that exact JAR. **Show Manifest** opens the manifest directly.

## Tree page

The **Tree** page lists the archive entries and initially selects `feature.xml` or `META-INF/MANIFEST.MF`. For the selected entry it shows size and last-modified time.

- **Show As** chooses how to display the content: **Auto** (hex if the content contains a zero byte, otherwise text), **Text** with a selectable encoding, or **Binary (hex)**.
- **Limit** reads at most 1,000,000 bytes.
- Double-click an entry or press <kbd>Enter</kbd> to open it read-only in a normal editor.

![JAR Viewer tree with META-INF/MANIFEST.MF selected]({{ '/images/jar-viewer.png' | relative_url }})

## Print page

The **Print** page shows the complete `bnd print` report:

- manifest,
- imports and exports,
- capabilities,
- components,
- metatype,
- API and uses, and
- the entry list.

Press <kbd>Ctrl</kbd>+<kbd>F</kbd> to search the report.

![JAR Viewer print page with the bnd print report]({{ '/images/jar-viewer-print.png' | relative_url }})

The Print page needs the Java language server. The Node fallback and older servers report it as unavailable. The Tree page always works locally.

The viewer follows changes to the file and closes when the file is deleted.

## Alternatives on the command line

**bnd-cli: Print Bundle Info** runs `bnd print` in a terminal with a view mode of your choice. **bnd-cli: Diff Bundles** compares two JARs and **bnd-cli: Verify JARs** verifies them. See [bnd CLI commands]({{ '/cli/' | relative_url }}).
