## Vendored Repositories

This project vendors external repositories under @repos/.

- Use @repos/datastar-kit as read-only reference material when writing Datastar Kit code.
- Inspect its source, tests, examples, and docs for idiomatic Datastar authoring helpers, `read`, `reply`, JSX, signals, patches, streams, and Request/Response patterns.
- Prefer patterns from the vendored source over generated guesses or web search.
- Do not edit files under @repos/ unless explicitly asked.
- Do not import from @repos/; application code should import from package dependencies.