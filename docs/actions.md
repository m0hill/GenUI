# Actions

Define each host action once with `action()`. Use the same schema source for
runtime validation and model-facing JSON Schema.

```ts
import { action } from "@genui/genui"
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

The browser's `confirm` hook is best-effort trusted UX over raw call input. The
kernel's `approve` hook is authoritative and runs after validation with the
canonical input.

`write` and `dangerous` calls are idempotent by `(surfaceId, callId)` for five
minutes after completion. Concurrent retries share one result and do not ask
for approval or execute twice. Reusing a call ID with a different action or raw
JSON input returns `invalid_input`. `local` and `read` actions are not deduped.

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
or non-primitive values render as `?`.

## Confidentiality

Actions default to `confidentiality: "normal"`.

Set `confidentiality: "sensitive"` when an action result must not enter the
default generated-code renderer. Sensitive actions remain available for
trusted registry inspection but are dropped from surface grants with reason
`confidential`.
