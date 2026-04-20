# Hover Documentation

Hovering over a recognised keyword opens an inline documentation panel.

## How to Use

1. Open a `.bnd` or `.bndrun` file.
2. Hover the mouse cursor over any instruction, OSGi header, or macro name.
3. A popup appears with:
   - The **full syntax signature** in bold.
   - A **documentation summary** from the bnd reference.
   - A copy-ready **example** in a `bnd` code block.

## What You Can Hover Over

- **Instructions** — e.g. `-buildpath`, `-runbundles`, `-dsannotations`, `-runee`
- **OSGi headers** — e.g. `Bundle-SymbolicName`, `Export-Package`, `Require-Capability`
- **Macro names** — e.g. `bsn`, `version`, `range`, `filter`

## Example

Hovering over `-buildpath:` shows:

> **-buildpath: \<bundle\>[\;\<attrs\>]…**
>
> Specifies the compile-time class path. Each entry is a bundle BSN optionally followed by version or other directives.
>
> **Example:**
> ```bnd
> -buildpath: osgi.core;version='[7,8)'
> ```
