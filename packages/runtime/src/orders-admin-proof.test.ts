import assert from "node:assert/strict"
import { test } from "node:test"
import { action, Genui } from "./registry.js"
import type { ActionCall, ActionResult, Surface } from "./types.js"
import { createSurfaceBroker, type SurfaceBrokerEffect } from "./dom/surface-broker.js"
import type { SurfaceBrokerTask } from "./dom/surface-broker.js"
import { protocolChannel } from "./dom/protocol.js"
import { isRecord, testSchema } from "./test-schema.test-support.js"

interface SearchOrdersInput {
  readonly query: string
}

interface RefundOrderInput {
  readonly id: string
}

interface AddOrderNoteInput {
  readonly id: string
  readonly note: string
}

interface LineItem {
  readonly id: string
  readonly sku: string
  readonly quantity: number
}

interface Order {
  readonly id: string
  readonly customer: string
  status: "paid" | "refunded"
  readonly lines: readonly LineItem[]
  notes: string[]
}

interface OrdersResult {
  readonly items: readonly Order[]
}

interface OrdersContext {
  readonly userId: string
  readonly store: OrdersStore
}

const ok = <Value>(value: Value) => ({ ok: true, value }) as const
const err = (message: string) => ({ ok: false, message }) as const

const parseSearchOrdersInput = (value: unknown) =>
  isRecord(value) && typeof value.query === "string"
    ? ok<SearchOrdersInput>({ query: value.query })
    : err("Expected a search query.")

const parseRefundOrderInput = (value: unknown) =>
  isRecord(value) && typeof value.id === "string"
    ? ok<RefundOrderInput>({ id: value.id })
    : err("Expected an order id.")

const parseAddOrderNoteInput = (value: unknown) =>
  isRecord(value) && typeof value.id === "string" && typeof value.note === "string"
    ? ok<AddOrderNoteInput>({ id: value.id, note: value.note })
    : err("Expected an order id and note.")

const isLineItem = (value: unknown): value is LineItem =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.sku === "string" &&
  typeof value.quantity === "number"

const isOrder = (value: unknown): value is Order =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.customer === "string" &&
  (value.status === "paid" || value.status === "refunded") &&
  Array.isArray(value.lines) &&
  value.lines.every(isLineItem) &&
  Array.isArray(value.notes) &&
  value.notes.every((note) => typeof note === "string")

const parseOrdersResult = (value: unknown) =>
  isRecord(value) && Array.isArray(value.items) && value.items.every(isOrder)
    ? ok<OrdersResult>({ items: value.items })
    : err("Expected an orders result.")

class OrdersStore {
  readonly orders: Order[] = [
    {
      id: "order-1",
      customer: "Acme Studio",
      status: "paid",
      lines: [
        { id: "line-1", sku: "FRAME-A", quantity: 1 },
        { id: "line-2", sku: "LENS-B", quantity: 2 },
      ],
      notes: [],
    },
    {
      id: "order-2",
      customer: "Northwind",
      status: "paid",
      lines: [{ id: "line-3", sku: "CASE-C", quantity: 1 }],
      notes: [],
    },
  ]

  search(query: string): OrdersResult {
    const normalized = query.trim().toLowerCase()
    return {
      items: this.orders
        .filter(
          (order) => normalized.length === 0 || order.customer.toLowerCase().includes(normalized),
        )
        .map((order) => ({ ...order, notes: [...order.notes] })),
    }
  }

  refund(id: string): OrdersResult {
    const order = this.orders.find((item) => item.id === id)
    if (order !== undefined) order.status = "refunded"
    return this.search("")
  }

  addNote(input: AddOrderNoteInput): OrdersResult {
    const order = this.orders.find((item) => item.id === input.id)
    if (order !== undefined) order.notes = [...order.notes, input.note]
    return this.search("")
  }
}

const ordersSurfaceHtml = `
  <form data-genui-on-submit="@action('orders.search', { query: $query }, { target: 'orders' })">
    <input data-genui-bind="query" value="Acme">
    <button>Search</button>
  </form>
  <p data-genui-show="$orders.status == 'pending'">Updating</p>
  <p data-genui-show="$orders.status == 'error'" data-genui-text="$orders.error"></p>
  <p data-genui-show="$orders.value.items.length == 0">No orders found</p>
  <table>
    <tbody data-genui-each="$orders.value.items" data-genui-as="order">
      <tr>
        <td data-genui-text="$order.id"></td>
        <td data-genui-text="$order.customer"></td>
        <td data-genui-text="$order.status"></td>
        <td>
          <ul data-genui-each="$order.lines" data-genui-as="line">
            <li>
              <span data-genui-text="$line.sku"></span>
              <span data-genui-text="$line.quantity"></span>
            </li>
          </ul>
        </td>
        <td>
          <button data-genui-on-click="@action('orders.refund', { id: $order.id }, { target: 'orders' })">Refund</button>
          <button data-genui-on-click="@action('orders.add_note', { id: $order.id, note: 'Priority follow-up' }, { target: 'orders' })">Add note</button>
        </td>
      </tr>
    </tbody>
  </table>
`

const actionMessage = (surface: Surface, action: string, input: unknown, callId: string) => ({
  channel: protocolChannel,
  type: "capability",
  surfaceId: surface.id,
  callId,
  action,
  input,
  target: "orders",
})

const taskEffects = async (task: SurfaceBrokerTask): Promise<readonly SurfaceBrokerEffect[]> => [
  ...task.effects,
  ...(task.pending === undefined ? [] : await task.pending),
]

const resultMessage = (
  effects: readonly SurfaceBrokerEffect[],
): Extract<SurfaceBrokerEffect, { readonly type: "post_result" }>["message"] => {
  const effect = effects.find(
    (item): item is Extract<SurfaceBrokerEffect, { readonly type: "post_result" }> =>
      item.type === "post_result",
  )
  if (effect === undefined) assert.fail("Expected a posted result effect.")
  return effect.message
}

const ordersResultValue = (result: ActionResult): OrdersResult => {
  if (!result.ok) assert.fail(`Expected orders result, received ${result.error.code}.`)
  const parsed = parseOrdersResult(result.value)
  if (!parsed.ok) assert.fail(parsed.message)
  return parsed.value
}

void test("orders-admin proof exercises grants, approval, nested data, and refresh mutations", async () => {
  const registry = new Genui<OrdersContext>({
    actions: [
      action({
        name: "orders.search",
        description: "Search orders by customer.",
        effect: "read",
        input: testSchema(parseSearchOrdersInput),
        output: testSchema(parseOrdersResult),
        execute: (ctx, input) => ctx.store.search(input.query),
      }),
      action({
        name: "orders.refund",
        description: "Refund an order and return the refreshed order list.",
        effect: "write",
        policy: "ask",
        input: testSchema(parseRefundOrderInput),
        output: testSchema(parseOrdersResult),
        execute: (ctx, input) => ctx.store.refund(input.id),
      }),
      action({
        name: "orders.add_note",
        description: "Add a note to an order and return the refreshed order list.",
        effect: "write",
        input: testSchema(parseAddOrderNoteInput),
        output: testSchema(parseOrdersResult),
        execute: (ctx, input) => ctx.store.addNote(input),
      }),
    ],
  })
  const ctx: OrdersContext = { userId: "user-1", store: new OrdersStore() }
  const surface = await registry.surface({
    html: ordersSurfaceHtml,
    actions: ["orders.search", "orders.refund", "orders.add_note"],
  })
  const limitedSurface = await registry.surface({
    html: ordersSurfaceHtml,
    actions: ["orders.search"],
  })
  const transportCalls: ActionCall[] = []
  const brokerApprovals: ActionCall[] = []
  const registryApprovals: ActionCall[] = []
  let brokerApproves = true

  const broker = createSurfaceBroker(surface, {
    confirm: (_descriptor, call) => {
      brokerApprovals.push(call)
      return brokerApproves
    },
    transport: async (call): Promise<ActionResult> => {
      transportCalls.push(call)
      return registry.execute(call, ctx, {
        approve: (_descriptor, approvedCall) => {
          registryApprovals.push(approvedCall)
          return true
        },
      })
    },
  })

  assert.deepEqual(
    surface.grant.actions.map((capability) => capability.name),
    ["orders.search", "orders.refund", "orders.add_note"],
  )
  assert.equal(surface.html.includes("$orders.value.items.length == 0"), true)
  assert.equal(surface.html.includes('data-genui-each="$order.lines"'), true)

  const directDenied = await registry.execute(
    {
      surfaceId: surface.id,
      callId: "direct-refund",
      action: "orders.refund",
      input: { id: "order-1" },
    },
    ctx,
  )
  assert.equal(directDenied.ok, false)
  assert.equal(directDenied.ok ? undefined : directDenied.error.code, "approval_denied")

  const searchResult = resultMessage(
    await taskEffects(
      broker.handleSandboxMessage(
        actionMessage(surface, "orders.search", { query: "Acme" }, "call-search"),
      ),
    ),
  )
  const searchedOrders = ordersResultValue(searchResult.result)
  assert.equal(searchResult.target, "orders")
  assert.equal(searchedOrders.items.length, 1)
  assert.equal(searchedOrders.items[0]?.lines.length, 2)

  brokerApproves = false
  const deniedRefund = resultMessage(
    await taskEffects(
      broker.handleSandboxMessage(
        actionMessage(surface, "orders.refund", { id: "order-1" }, "call-refund-denied"),
      ),
    ),
  )
  assert.equal(deniedRefund.result.ok, false)
  assert.equal(
    deniedRefund.result.ok ? undefined : deniedRefund.result.error.code,
    "approval_denied",
  )
  assert.equal(ctx.store.orders[0]?.status, "paid")

  brokerApproves = true
  const approvedRefund = resultMessage(
    await taskEffects(
      broker.handleSandboxMessage(
        actionMessage(surface, "orders.refund", { id: "order-1" }, "call-refund"),
      ),
    ),
  )
  const refundedOrders = ordersResultValue(approvedRefund.result)
  assert.equal(ctx.store.orders[0]?.status, "refunded")
  assert.equal(refundedOrders.items[0]?.status, "refunded")

  const noteResult = resultMessage(
    await taskEffects(
      broker.handleSandboxMessage(
        actionMessage(
          surface,
          "orders.add_note",
          { id: "order-1", note: "Priority follow-up" },
          "call-note",
        ),
      ),
    ),
  )
  ordersResultValue(noteResult.result)
  assert.deepEqual(ctx.store.orders[0]?.notes, ["Priority follow-up"])

  let limitedTransportCalled = false
  const limitedBroker = createSurfaceBroker(limitedSurface, {
    transport: async (): Promise<ActionResult> => {
      limitedTransportCalled = true
      return { ok: true, value: {} }
    },
  })
  const ungrantedRefund = resultMessage(
    await taskEffects(
      limitedBroker.handleSandboxMessage(
        actionMessage(limitedSurface, "orders.refund", { id: "order-1" }, "call-ungranted-refund"),
      ),
    ),
  )
  assert.equal(ungrantedRefund.result.ok, false)
  assert.equal(
    ungrantedRefund.result.ok ? undefined : ungrantedRefund.result.error.code,
    "not_granted",
  )
  assert.equal(limitedTransportCalled, false)
  assert.deepEqual(
    transportCalls.map((call) => call.action),
    ["orders.search", "orders.refund", "orders.add_note"],
  )
  assert.deepEqual(
    brokerApprovals.map((call) => call.callId),
    ["call-refund-denied", "call-refund"],
  )
  assert.deepEqual(
    registryApprovals.map((call) => call.callId),
    ["call-refund"],
  )
})
