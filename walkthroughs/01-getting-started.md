# Getting Started with Bnd and Bndrun Support

Welcome! This walkthrough explains the main capabilities of the **Bnd and Bndrun Support** extension.

## What This Extension Provides

| Capability | Description |
|---|---|
| Syntax highlighting | Full TextMate grammar for `.bnd` and `.bndrun` files |
| IntelliSense completions | 153 instructions, 138 macros, 48 OSGi headers |
| Hover documentation | Inline docs and examples from the official bnd reference |
| Integrated CLI commands | 19 `bnd` CLI commands available from the Command Palette |
| CLI Reference panel | Searchable view of all 77 bnd CLI sub-commands |

## Quick Check

Open any `.bnd` or `.bndrun` file and verify that syntax highlighting is active — keywords like `-buildpath:` should appear in colour.

If no file is available yet, create `bnd.bnd` with the content below:

```properties
Bundle-SymbolicName: com.example.hello
Bundle-Version: 1.0.0
-buildpath: osgi.core;version='[7,8)'
Export-Package: com.example.api;version='1.0.0'
```
