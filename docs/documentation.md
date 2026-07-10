# Documentation

Read when creating or editing Markdown.

## Purpose

- Documentation should provide clear instructions.
- Start from what needs to be done or decided.
- Prefer rules over explanation.
- Keep rationale only when it prevents a wrong choice.
- Update documentation when code establishes a convention.
- Update documentation when a correction repeats.
- Fix stale documentation when you find it.

## Placement

- Put guidance in the most relevant guide.
- Add a new guide only for a new durable topic.
- Add new guides to the main documentation index.
- Cross-link only when another guide must be read.
- Keep examples near the rule they clarify.

## Style

- Be concise.
- One idea per sentence.
- One topic per paragraph.
- Prefer bullets.
- Use concrete file paths, APIs, and names.
- Say what to use.
- Say what to avoid.
- Delete vague advice.
- Delete duplicated advice.
- Delete historical notes unless they change current work.

## Conflicts

- If guides conflict, choose one pattern.
- Prefer current code when it is intentional.
- Prefer specialized guides over general README prose.
- Prefer established project patterns.
- Patch every document that would send readers the wrong way.

## Checks

- New documentation should be useful without surrounding context.
- Headings should name the decision area.
- Rules should survive copy-paste into another document or prompt.
- Run `pnpm check` before handoff.
