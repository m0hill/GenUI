# Agent setup

Coding agents produce better Datastar Kit code when they can inspect the SDK source, tests, examples, and docs. Package types help, but they do not show the intended application patterns.

The recommended setup is to vendor this repository into your application as read-only reference material and tell the agent when to inspect it.

## Vendor the repository

Add Datastar Kit under a dedicated `repos/` directory:

```sh
git subtree add \
  --prefix=repos/datastar-kit \
  https://github.com/m0hill/datastar-kit.git \
  main \
  --squash
```

Update it when you want newer examples and tests:

```sh
git subtree pull \
  --prefix=repos/datastar-kit \
  https://github.com/m0hill/datastar-kit.git \
  main \
  --squash
```

`--squash` avoids importing the repository's full commit history into your project.

## Add agent instructions

Add a short note to `AGENTS.md`, `CLAUDE.md`, or the instruction file your agent reads:

```md
## Vendored Repositories

This project vendors external repositories under @repos/.

- Use @repos/datastar-kit as read-only reference material when writing Datastar Kit code.
- Inspect its source, tests, examples, and docs for idiomatic Datastar authoring helpers, `read`, `reply`, JSX, signals, patches, streams, and Request/Response patterns.
- Prefer patterns from the vendored source over generated guesses or web search.
- Do not edit files under @repos/ unless explicitly asked.
- Do not import from @repos/; application code should import from package dependencies.
```

For focused work, ask the agent to inspect the relevant area first:

```md
Before changing this Datastar Kit flow, inspect @repos/datastar-kit/packages/datastar-kit/test and @repos/datastar-kit/examples for matching patterns. Use the vendored repository as reference only.
```

## Reduce editor noise

If your editor starts suggesting imports from `repos/`, exclude that directory from search, file watching, and auto-imports. In VS Code:

```json
{
  "typescript.preferences.autoImportFileExcludePatterns": ["repos/**"],
  "javascript.preferences.autoImportFileExcludePatterns": ["repos/**"],
  "files.exclude": {
    "repos/**": true
  },
  "files.watcherExclude": {
    "repos/**": true
  },
  "search.exclude": {
    "repos/**": true
  }
}
```

Related: [Examples](examples.md), [API reference](../reference/api.md).
