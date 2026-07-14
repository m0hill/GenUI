# Actions

Define each host action once with `action()`. Use the same schema source for
runtime validation and model-facing JSON Schema.

Use [subscriptions.md](subscriptions.md) for granted read-only event sources.
Do not make an action return a topic, stream ID, callback, or live iterator.

```ts
import { action } from "genui"
import { z } from "zod"

const SearchOrdersInput = z.object({
  query: z.string().trim().max(100),
})

const SearchOrdersOutput = z.object({
  orders: z.array(
    z.object({
      id: z.string(),
      customer: z.string(),
      status: z.string(),
    }),
  ),
})

const searchOrders = action({
  name: "orders.search",
  description: "Search orders by customer or order number.",
  effect: "read",
  input: SearchOrdersInput,
  output: SearchOrdersOutput,
  execute: async (context, input) => context.orders.search(input.query),
})
```

The framework accepts any Standard Schema validator. Zod is an application
choice, not a runtime dependency.

## Required fields

- `name` is a stable, namespaced identifier such as `orders.search`.
- `description` tells the model and approval UI what the action does.
- `effect` classifies the action as `local`, `read`, `write`, or `dangerous`.
- `input` validates and canonicalizes untrusted call input.
- `execute(context, input)` receives only the canonical validated input.

## Transforming validators

Genui preserves both sides of a transforming Standard Schema contract:

- Generated UI supplies the input validator's input type.
- `execute` receives the input validator's canonical output type.
- `execute` returns the output validator's input candidate type.
- Generated UI receives the output validator's canonical output type.

For example, this action receives a `Date`, returns a `number`, and exposes
strings at both generated-interface boundaries:

```ts
const IsoDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (value) => new Date(value),
  encode: (value) => value.toISOString(),
})
const YearText = z.codec(z.number(), z.string(), {
  decode: (value) => String(value),
  encode: (value) => Number(value),
})

const readYear = action({
  name: "dates.read_year",
  description: "Read the UTC year from an ISO date.",
  effect: "read",
  input: IsoDate,
  output: YearText,
  execute: (_context, date) => date.getUTCFullYear(),
})
```

Action names must contain at least two segments. Separate segments with `.`,
`_`, or `-`. Names are globally unique across actions and subscriptions in one
`Genui` instance.

## JSON Schema projection

Genui derives model-facing schemas automatically when a validator implements
Standard JSON Schema V1. Action input uses the converter's input direction.
Validated action output uses its output direction. Genui requests JSON Schema
draft 2020-12.

Use `inputJsonSchema` or `outputJsonSchema` when the validator cannot derive the
contract or the application needs a deliberately different model-facing
description. An explicit schema takes precedence and its converter is not
called. An output JSON Schema without an `output` validator is rejected.

Derived and explicit schemas are copied into action descriptors as
`inputSchema` and `outputSchema`. Standard Schema remains the enforcement
mechanism; JSON Schema is descriptive metadata. A converter error rejects
`new Genui(...)` as a configuration error instead of silently omitting the
model contract. Validators without a converter remain supported and may use
explicit schemas.

## Effects and policy

Default policy is derived from `effect`:

- `local` and `read` default to `allow`.
- `write` and `dangerous` default to `ask`.

Set `policy: "allow" | "ask" | "block"` only when the action needs an explicit
override. Explicit policy always wins.

The kernel's `approve` hook is authoritative and runs after validation with the
canonical input. Its result has three meanings:

- `true` approves execution.
- `false` returns the terminal `approval_denied` result.
- `undefined` returns `approval_required` with the server-rendered intent in
  its message.

`write` and `dangerous` calls are idempotent by `(surfaceId, callId)` for five
minutes after completion. Concurrent retries share one result and do not ask
for approval or execute twice. Object key order is ignored recursively when
comparing retry input. Reusing a call ID with a different action, JSON value, or
array order returns `invalid_input`. `local` and `read` actions are not deduped.
`approval_required` is provisional and is not retained in the idempotency
window; an approved retry must be able to proceed.

## Approval intent

Add `intent` to render concise trusted approval copy:

```ts
const updateStatus = action({
  name: "orders.update_status",
  description: "Change an order's status.",
  effect: "write",
  intent: "Change order {input.id} to {input.status}",
  input: UpdateStatusInput,
  execute: async (context, input) => context.orders.updateStatus(input),
})
```

Placeholders use `{input.path}`. Only primitive values render directly. Missing
or non-primitive values render as `?`. Rendering happens from canonical input
inside the kernel, not from raw guest input in the browser.

Treat interpolated strings as untrusted display data even after validation. A
value can contain persuasive or instruction-like text. Put the action and its
consequence in fixed template text, use placeholders only for clearly labelled
values, and render the final intent as plain text rather than HTML. For long
values, show a bounded preview with a separate trusted detail view.

## Confidentiality

Actions default to `confidentiality: "normal"`.

Set `confidentiality: "sensitive"` when an action result must not enter the
default generated-code renderer. Non-blocked sensitive actions remain
available through `genui.actions()` for trusted registry inspection, but
surface grants drop them with reason `confidential`.

## Subject binding

Bind a surface to an authenticated user or session by setting `subject` during
surface creation. Pass the same opaque string as `ExecuteOptions.subject` on
every call. A missing or different subject returns `not_granted` before policy,
schema validation, approval, or execution.

Subject strings are host-provided identity references. The runtime does not
authenticate users or interpret their contents. Surfaces without a subject
retain unbound behavior.
