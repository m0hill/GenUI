# Expression Model

Generated UI needs a way to express interaction.

The framework must make one clear decision: use Datastar's expression semantics as the source of truth, or define a smaller closed expression language. Mixing both creates confusing behavior.

## The Problem

Declarative UI attributes often contain expressions.

Those expressions can describe:

- local state reads;
- local state writes;
- conditionals;
- class or style changes;
- form values;
- capability inputs;
- action calls.

If one runtime evaluates those expressions, but another parser independently tries to extract capability inputs from the same strings, the two can disagree.

That creates two classes of bugs:

- the UI appears to do one thing while the capability request receives different input;
- the model learns syntax that works in one place but fails in another.

## Option A: Datastar As The Semantics

In this model, Datastar owns expression behavior.

The framework accepts Datastar's expression model inside the sandbox and designs capability calls around Datastar state.

Benefits:

- fewer invented concepts;
- better alignment with Datastar documentation;
- richer local UI behavior;
- easier model authoring if the model already knows Datastar;
- less custom parser design.

Costs:

- the sandbox must support Datastar's evaluation strategy;
- the sanitizer and runtime must clearly document the allowed subset;
- capability input extraction should not be a separate approximate parser;
- result rendering must follow Datastar's grain, likely through server-rendered fragments or trusted plugins.

If this path is chosen, the framework should avoid independently interpreting Datastar expressions except at carefully defined boundaries.

## Option B: A Closed Expression DSL

In this model, the framework defines a tiny expression language.

The DSL supports only the operations needed for generated UI:

- local signal reads;
- literal values;
- simple assignments;
- capability calls;
- local action calls;
- basic boolean display conditions;
- maybe simple string interpolation.

Benefits:

- no general JavaScript evaluation;
- one interpreter controlled by the framework;
- easier to make behavior consistent;
- easier to explain exactly what generated UI can express.

Costs:

- more framework design work;
- less reuse of Datastar semantics;
- the model must learn a narrower custom language;
- complex local interactions may need more trusted plugins.

If this path is chosen, Datastar becomes inspiration or rendering machinery, not the expression authority.

## What Not To Do

Avoid a halfway model where:

- Datastar evaluates some expressions;
- the bridge hand-parses some of the same expressions;
- the sanitizer applies a third interpretation;
- documentation describes only a vague subset.

That makes the runtime harder to reason about and harder for the model to use correctly.

## Practical Recommendation

For the current prototype, the fastest path is to lean into Datastar for normal interaction and reduce custom parsing wherever possible.

For a reusable framework, the team should explicitly choose one:

```text
Datastar semantics with carefully designed capability integration
```

or:

```text
a small closed DSL with Datastar-like ergonomics
```

The decision should happen before expanding widgets, shared state, or advanced result rendering, because all of those depend on expression semantics.

## List Rendering Pressure

The expression model decision is tied to result rendering.

Many capability results are lists: weather days, search results, issues, contacts, invoices, tasks. If the generated surface cannot render lists cleanly, it will fall back to dumping raw JSON.

Possible answers:

- return server-rendered fragments for list results;
- add a trusted repeat/template plugin;
- add trusted widgets for common list and table shapes;
- make capabilities return both data and a display fragment;
- keep generated surfaces shell-like and fetch/render data through trusted runtime components.

The framework should solve list rendering as a first-class problem, not as an afterthought.

