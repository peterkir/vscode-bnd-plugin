# Repository Instructions

Follow [AGENTS.md](../AGENTS.md) and [copilot-instructions.md](../copilot-instructions.md) for repository architecture and conventions.

- After every code change, run the complete test suite (`npm test`) with `BND_SOURCE_REPO` or `BND_JAVA_REPO` pointing to an existing bnd source repository. The suite must pass; report failed, blocked, or unexpectedly skipped tests instead of claiming full validation.
- Write all repository documentation in English. Review and validate affected documentation against current code, CLI semantics, settings, examples, links, and version references; update it when necessary.
- Bump the extension version in both `package.json` and `package-lock.json` for every code change. Follow Semantic Versioning: patch for compatible fixes, minor for compatible features, major for breaking changes. Do not commit or tag unless requested.