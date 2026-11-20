---
title: Editing bnd files
layout: default
permalink: /editing/
description: Syntax highlighting, completion, hover documentation, diagnostics, quick fixes, and the Effective properties view for bnd and bndrun files.
---

<div class="toc-box" markdown="1">
<p class="toc-title">On this page</p>

* TOC
{:toc}
</div>

The extension activates for files with the extensions `.bnd`, `.bndrun`, and `.mvn`. Highlighting, completion, and hover work with every server mode. Diagnostics, quick fixes, attribute completion, and the Effective view need the Java language server (see [Language server modes]({{ '/language-server/#language-server-modes' | relative_url }})).

## Syntax highlighting

A TextMate grammar highlights:

| Element | Example |
|---|---|
| Instructions | `-buildpath:`, `-runbundles:`, `-privatepackage:` |
| OSGi headers | `Bundle-SymbolicName:`, `Export-Package:`, `Import-Package:` |
| Properties | lowercase key-value properties |
| Macros, including nested ones | `${bsn}`, `${if;${driver;vscode};.vscode}` |
| Version ranges | `[1.0,2.0)`, `(1.0,2.0]` |
| Strings | single- and double-quoted |
| Attributes and directives | `version=1.0`, `resolution:=optional` |
| Continuation lines | trailing `\` |
| Comments | `#` line comments and `//` inline comments |

## IntelliSense completion

Press <kbd>Ctrl</kbd>+<kbd>Space</kbd>. Completion also opens automatically after `-`, `$`, `{`, and `:`. Every entry is pre-filled with a real example from the bnd documentation.

![Completion list for -run instructions with documentation preview]({{ '/images/completions.png' | relative_url }})

| Kind | Coverage |
|---|---|
| **Instructions** | 153 bnd instructions, for example `-buildpath: osgi;version=4.1` or `-runee: JavaSE-17`. |
| **Macros** | Triggered inside `${...}`. The Java server lists every macro that bndlib provides for the file, including project and workspace macros, with their help. The Node fallback offers a built-in set of 138. |
| **Headers** | 48 OSGi headers and bnd pseudo-headers, for example `Bundle-SymbolicName`, `Export-Package`, `Require-Capability`. |
| **Attributes and directives** | After `;` in a clause the Java server offers the attributes and directives bnd documents for the header, such as `version=` and `resolution:=` in `Import-Package`, and after `resolution:=` their values. |
| **Execution environments** | `-runee` offers the environments bnd knows, up to the running Java version. |

You can also drag bundles from the [Repositories view]({{ '/repositories/' | relative_url }}) into an editor to insert `bsn;version=...` entries.

## Hover documentation

Hover over an instruction, header, or macro name to see

- the syntax signature,
- a summary from the bnd reference documentation, and
- an example from the official docs, shown in a `bnd` code block.

![Hover documentation for -buildpath]({{ '/images/hover.png' | relative_url }})

## Diagnostics and quick fixes

With the Java language server, problems reported by bnd while building, running, and verifying appear inline and in the Problems panel. Press <kbd>Ctrl</kbd>+<kbd>.</kbd> on a problem to see quick fixes.

![Quick fixes for a duplicate -runvm definition]({{ '/images/quickfix.png' | relative_url }})

| Problem | Quick fix |
|---|---|
| **Property conflicts**: a key defined more than once in a file, or a merged-property key such as `-runvm` or `-runrequires` shadowed by an `-include`d file. Validated from the unsaved editor text with exact key ranges. | Rename a merge-capable key to a unique `key.<suffix>`, or remove the conflicting definition including its continuation lines. |
| **Invalid `Bundle-Activator`**: the class is missing, abstract, imported, or otherwise unusable. | Remove the header. |
| **Baseline `Bundle-Version` mismatch**. | Change the version to the one suggested by baselining, keeping a macro qualifier such as `.${tstamp}`. |

Property conflict reporting follows bnd's [`-propertyconflicts`](https://bnd.bndtools.org/instructions/propertyconflicts.html) policy and is **off by default**. Enable it with `-propertyconflicts: warning` (or `error`) in `cnf/build.bnd` or the edited file, or with `-pedantic: true`.

## Effective properties

A `.bnd` file is only part of the truth: includes, workspace settings, and macros all contribute. The **Effective** view shows the result.

Open it with:

- **bnd: Open Effective** on a `.bnd` or `.bndrun` file, or
- **bnd: Open Effective to Side**, which keeps the source editor visible, or
- **Reopen Editor With...** and **Bnd Effective**.

The normal text editor stays the default.

![Effective properties filtered by "path" with the -buildpath value expanded]({{ '/images/effective.png' | relative_url }})

The table has the columns **Key**, **Value**, **Provenance**, and **Errors**.

- Filter rows, resize columns, and expand long values.
- Click a provenance link to open the file that defines the value.
- **Expanded** evaluates macros. **Merged** combines supported instructions and headers using bnd's decorated-property semantics. Turning expansion off also turns merging off.
- **Show Effective Source** opens generated read-only bnd text. **Open Original Source** returns to the editable file.
- **Refresh** recomputes the view.

Edits to the current file appear without saving, including added and deleted properties. Included files and workspace settings use their saved content; a warning names unsaved dependencies. The view re-evaluates only when the edited file or one of its dependencies changes on disk.

> **Security note.** Macro evaluation is not a sandbox. Trusted bnd configuration can initialize plugins, create caches, access repositories, or run commands. Effective values can contain secrets; copy or export them deliberately.

The view requires a trusted workspace and the Java language server. The Node fallback and older custom servers report that it is unavailable.

## Macro evaluation on demand

**bnd: Evaluate Macro (LSP)** evaluates a macro expression in the context of the current file, for example `${driver}` or `${tstamp;yyyy-MM-dd}`. The CLI variant **bnd-cli: Evaluate Macro Expression** runs `bnd macro`.
