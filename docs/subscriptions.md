# Subscriptions

Use `subscription()` for read-only event sources that generated UI may follow
over time. Keep actions for one-shot reads and mutations. Do not return a topic,
stream ID, callback, or socket from an action.

```ts
import { subscription } from "genui"
import { z } from "zod"

const OrderChangesInput = z.strictObject({
  status: z.enum(["pending", "processing", "shipped"]).optional(),
})

const OrderChangeEvent = z.strictObject({
  id: z.string(),
  status: z.enum(["pending", "processing", "shipped"]),
})

const orderChanges = subscription({
  name: "orders.changes",
  description: "Receive order status changes matching an optional status filter.",
  input: OrderChangesInput,
  inputJsonSchema: z.toJSONSchema(OrderChangesInput, { io: "input" }),
  event: OrderChangeEvent,
  eventJsonSchema: z.toJSONSchema(OrderChangeEvent),
  policy: "allow",
  async *subscribe(context, input, { signal }) {
    for await (const event of context.orders.watch(input, { signal })) {
      yield event
    }
  },
})
```

The framework accepts any Standard Schema validator. Zod is an application
choice, not a runtime dependency.

## Definition contract

- `name` is a stable, namespaced identifier such as `orders.changes`.
- `description` tells the model which events the source provides.
- `input` validates and canonicalizes the requested filter.
- `event` validates and canonicalizes every source event.
- `subscribe(context, input, { signal })` returns an `AsyncIterable`.
- `inputJsonSchema` and `eventJsonSchema` describe the same validators to the
  model. Standard Schema remains authoritative.

Subscription and action names are globally unique within one `Genui` instance.
Subscriptions have an implicit `read` effect. Their policy is `allow` or
`block`; they have no approval, write, dangerous, or idempotency mode. Use a
trusted action first when consent or a mutation must establish new authority.

Subscriptions default to `confidentiality: "normal"`. A sensitive, blocked,
unknown, or duplicate requested subscription is omitted from a generated-code
grant with a projection diagnostic, matching actions.

## Configure and grant subscriptions

Configure subscriptions separately from actions. Select their definitions with
the actions that generated code may use. The generation selection and registry
subscription arrays are optional and default to no subscriptions.

```ts
const genui = new Genui({
  actions: [searchOrders, updateOrder],
  subscriptions: [orderChanges],
})

const ordersUi = genui.generation({
  actions: [searchOrders, updateOrder],
  subscriptions: [orderChanges],
})

const surface = await ordersUi.createSurface({
  content,
  subject: session.id,
  ttlMs: 15 * 60_000,
})
```

Every serialized grant contains separate `actions` and `subscriptions` arrays,
including when either is empty. A subscription descriptor contains its name,
description, confidentiality, input JSON Schema, event JSON Schema, and fixed
`maxEventBytes` limit.

## Authorize the start

Starting a subscription is an authority check, not a browser capability call.
The kernel loads the authoritative surface, verifies subject and expiry, checks
the current definition and `allow | block` policy, checks stored grant
membership, enforces limits, validates and canonicalizes input, and only then
starts the app source with a kernel-owned abort signal.

Subscription input must be JSON-serializable and no larger than 64 KiB in UTF-8.
At most four subscriptions may be active for one surface in a `Genui` instance.
These limits apply before app source startup.

The browser grant is only an early-rejection snapshot. Never treat a
guest-generated subscription ID, acknowledgment, or unsubscribe message as
authority or a secret.

## Validate every event

Before yielding each event, the kernel reloads the authoritative surface and
rechecks subject, exact expiry, current policy, definition, and stored grant
membership. Store failure terminates the subscription rather than using cached
authority.

The kernel validates the source value with the declared event Standard Schema,
JSON-normalizes the canonical value, enforces the fixed 64 KiB UTF-8 event
limit, and then assigns the next monotonically increasing sequence number. A
malformed, non-JSON, or oversized event terminates the subscription. It is not
skipped.

An event whose authority check began before revocation may finish. No later
event may pass the next authoritative check.

## Bound delivery

Genui permits one event awaiting guest acknowledgment per subscription. The
guest handler has five seconds to settle. The browser broker also permits at
most ten delivered events per second in aggregate for one surface.

Acknowledgments provide flow control only. Generated code can forge or send
them early, so they never carry credentials and never bypass the aggregate rate
limit. Subscription IDs are correlation values, not secrets.

Events are delivered in order and at most once within one mounted subscription.
Genui does not silently drop, generically coalesce, or queue an unbounded number
of events. Delivery that cannot keep up terminates with `rate_limited`,
`ack_timeout`, or `overflow`. Implement application-specific snapshots or
coalescing inside the app source only when that event contract makes it safe.

## Cancellation and revocation

The kernel aborts its source signal and calls the iterator's `return()` when it
can. App sources should honor both mechanisms and make cleanup idempotent.

- Guest unsubscribe aborts only that subscription.
- Browser replacement cancels every old-document subscription, including a
  same-surface replacement.
- Graceful teardown keeps active delivery live until the final acknowledgment
  or deadline disposes the mount.
- Final disposal, navigation termination, and heartbeat termination abort
  immediately.
- Source completion closes normally. Source or transport failure closes only
  that subscription.
- There is no automatic reconnect, replay, durable cursor, or snapshot restore
  of a live handle in v0.

`Genui.revoke()` immediately aborts matching subscriptions owned by that same
`Genui` instance. Another replica observes revocation during the required store
read before the next event. A quiet remotely revoked source can remain connected
until it yields again, but it cannot deliver another event. Genui does not run
an optional quiet-stream revalidation poll in v0.

An expiry timer aborts at the grant's exact `expiresAt`, including while the
source is quiet. Active iterators, callbacks, browser subscription IDs, and
transport handles remain connection-local and are never stored in
`SurfaceStore`.

## Observe lifecycle without payloads

Record start attempts and outcomes, opened streams, event sequence and byte
count, close reason, event count, byte count, duration, invalid source events,
rate limits, acknowledgment timeouts, revocation, and expiry. Do not put event
payloads into generic lifecycle telemetry.

Do not reuse action `onCall` auditing for high-volume subscription events.
Trusted subscription errors distinguish surface-store authorization, input
validation, source startup, event validation, serialization and size
enforcement, source iteration, and cleanup. Original causes remain trusted-side
only and may contain application data.

Generated code never receives the app source, transport, network connection, or
kernel context. A trusted adapter may use fetch streaming, SSE, WebSockets,
database notifications, or an in-process bus, but its framing is app-specific
and is not part of `genui/protocol`.
