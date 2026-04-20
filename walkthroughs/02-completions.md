# IntelliSense Completions

The extension ships completion items built directly from the official bnd documentation.

## Triggering Completions

| Trigger | What you get |
|---|---|
| Start of a new line (or `-`) | All 153 bnd instructions + 48 OSGi headers |
| Inside `${…}` (type `${`) | All 138 bnd macros |
| `Ctrl+Space` anywhere | Manual completion request |

## Examples

**Instruction completion** — type `-b` and press `Ctrl+Space`:

```
-buildpath: osgi.core;version='[7,8)'
```

**Macro completion** — type `${` inside a value and press `Ctrl+Space`:

```
${version;===;${@}}
${tstamp;yyyy-MM-dd}
${repo;bsns}
```

**Header completion** — type `Bu` at the start of a line:

```
Bundle-SymbolicName: com.example.bundle
Bundle-Version: 1.0.0
```

Each completion item includes the full signature, a documentation summary, and a copy-ready example.
