# Actions

Define each host action once with `action()`. Use the same schema source for
runtime validation and model-facing JSON Schema.

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
  inputJsonSchema: z.toJSONSchema(SearchOrdersInput),
  output: SearchOrdersOutput,
  outputJsonSchema: z.toJSONSchema(SearchOrdersOutput),
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

Action names must contain at least two segments. Separate segments with `.`,
`_`, or `-`.

## JSON Schema projection

Use `inputJsonSchema` when an action is available to generated UI. It is copied
to the action descriptor as `inputSchema`, so models do not have to infer field
names from prose.

Use `outputJsonSchema` with `output` when the action has a machine-readable
output contract. Standard Schema remains the enforcement mechanism; JSON Schema
is descriptive metadata.

Derive the validator and JSON Schema from the same source. Do not maintain two
independent definitions.

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
  inputJsonSchema: z.toJSONSchema(UpdateStatusInput),
  execute: async (context, input) => context.orders.updateStatus(input),
})
```

Placeholders use `{input.path}`. Only primitive values render directly. Missing
or non-primitive values render as `?`. Rendering happens from canonical input
inside the kernel, not from raw guest input in the browser.

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
