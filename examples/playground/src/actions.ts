import { action } from "genui"
import { z } from "zod"

export const OrderStatusSchema = z.enum(["pending", "processing", "shipped"])
export type OrderStatus = z.infer<typeof OrderStatusSchema>

export const OrderSchema = z.strictObject({
  id: z.string(),
  customer: z.string(),
  status: OrderStatusSchema,
  total: z.number(),
})
export type Order = z.infer<typeof OrderSchema>

export type OrderChangeEvent =
  | { readonly type: "orders.snapshot"; readonly orders: readonly Order[] }
  | {
      readonly type: "order.updated"
      readonly order: Order
      readonly previousStatus: OrderStatus
    }

interface OrderWatcher {
  readonly status?: OrderStatus
  readonly queue: OrderChangeEvent[]
  closed: boolean
  failure: Error | undefined
  wake: (() => void) | undefined
}

const SearchInputSchema = z.strictObject({
  query: z.string().trim().default(""),
  status: OrderStatusSchema.optional(),
})

const OrderIdInputSchema = z.strictObject({ id: z.string().min(1) })

const UpdateStatusInputSchema = z.strictObject({
  id: z.string().min(1),
  status: OrderStatusSchema,
})

const EmptyInputSchema = z.strictObject({})

const OrdersOutputSchema = z.strictObject({ orders: z.array(OrderSchema) })

const initialOrders: readonly Order[] = [
  { id: "ord-1001", customer: "Aster Labs", status: "processing", total: 148 },
  { id: "ord-1002", customer: "Northwind Studio", status: "pending", total: 86 },
  { id: "ord-1003", customer: "Kite & Co.", status: "shipped", total: 240 },
]

let orders: Order[] = []
const orderWatchers = new Set<OrderWatcher>()
const maxPendingOrderChanges = 8

const wakeWatcher = (watcher: OrderWatcher): void => {
  const wake = watcher.wake
  watcher.wake = undefined
  wake?.()
}

const closeOrderWatchers = (): void => {
  for (const watcher of orderWatchers) {
    watcher.closed = true
    wakeWatcher(watcher)
  }
  orderWatchers.clear()
}

export const resetDemoOrders = (): void => {
  closeOrderWatchers()
  orders = initialOrders.map((order) => ({ ...order }))
}

resetDemoOrders()

const orderJsonSchema = z.toJSONSchema(OrderSchema)

const findOrder = (id: string): Order => {
  const order = orders.find((candidate) => candidate.id === id)
  if (order === undefined) throw new Error(`Unknown order: ${id}`)
  return order
}

const publishOrderChange = (event: Extract<OrderChangeEvent, { type: "order.updated" }>): void => {
  for (const watcher of orderWatchers) {
    if (watcher.closed || watcher.failure !== undefined) continue
    if (
      watcher.status !== undefined &&
      watcher.status !== event.previousStatus &&
      watcher.status !== event.order.status
    ) {
      continue
    }
    if (watcher.queue.length >= maxPendingOrderChanges) {
      watcher.failure = new Error("Order change source overflowed its bounded queue.")
      orderWatchers.delete(watcher)
      wakeWatcher(watcher)
      continue
    }
    watcher.queue.push({ ...event, order: { ...event.order } })
    wakeWatcher(watcher)
  }
}

export async function* watchOrderChanges(
  input: Readonly<{ status?: OrderStatus }>,
  options: { readonly signal: AbortSignal },
): AsyncIterable<OrderChangeEvent> {
  if (options.signal.aborted) return
  const watcher: OrderWatcher = {
    ...(input.status === undefined ? {} : { status: input.status }),
    queue: [],
    closed: false,
    failure: undefined,
    wake: undefined,
  }
  const abort = (): void => {
    watcher.closed = true
    wakeWatcher(watcher)
  }
  options.signal.addEventListener("abort", abort, { once: true })
  orderWatchers.add(watcher)

  try {
    yield {
      type: "orders.snapshot",
      orders: orders
        .filter((order) => input.status === undefined || order.status === input.status)
        .map((order) => ({ ...order })),
    }
    while (!watcher.closed) {
      if (watcher.failure !== undefined) throw watcher.failure
      const event = watcher.queue.shift()
      if (event !== undefined) {
        yield event
        continue
      }
      await new Promise<void>((resolve) => {
        watcher.wake = resolve
        if (watcher.closed || watcher.failure !== undefined || watcher.queue.length > 0) {
          wakeWatcher(watcher)
        }
      })
    }
  } finally {
    watcher.closed = true
    orderWatchers.delete(watcher)
    options.signal.removeEventListener("abort", abort)
    wakeWatcher(watcher)
  }
}

export const demoActions = [
  action({
    name: "orders.search",
    description: "Search orders by customer, order ID, or status.",
    effect: "read",
    input: SearchInputSchema,
    inputJsonSchema: z.toJSONSchema(SearchInputSchema, { io: "input" }),
    output: OrdersOutputSchema,
    outputJsonSchema: z.toJSONSchema(OrdersOutputSchema),
    execute: (_context: unknown, input) => {
      const query = input.query.toLowerCase()
      return {
        orders: orders.filter(
          (order) =>
            (input.status === undefined || order.status === input.status) &&
            (query.length === 0 ||
              order.id.toLowerCase().includes(query) ||
              order.customer.toLowerCase().includes(query)),
        ),
      }
    },
  }),
  action({
    name: "orders.get",
    description: "Get one order by ID.",
    effect: "read",
    input: OrderIdInputSchema,
    inputJsonSchema: z.toJSONSchema(OrderIdInputSchema),
    output: OrderSchema,
    outputJsonSchema: orderJsonSchema,
    execute: (_context: unknown, input) => ({ ...findOrder(input.id) }),
  }),
  action({
    name: "orders.update_status",
    description: "Change an order's fulfillment status.",
    effect: "write",
    intent: "Change order {input.id} to {input.status}",
    input: UpdateStatusInputSchema,
    inputJsonSchema: z.toJSONSchema(UpdateStatusInputSchema),
    output: OrderSchema,
    outputJsonSchema: orderJsonSchema,
    execute: (_context: unknown, input) => {
      const current = findOrder(input.id)
      const updated = { ...current, status: input.status }
      orders = orders.map((order) => (order.id === input.id ? updated : order))
      publishOrderChange({
        type: "order.updated",
        order: updated,
        previousStatus: current.status,
      })
      return updated
    },
  }),
  action({
    name: "orders.export_private",
    description: "Export private customer contact data.",
    effect: "read",
    confidentiality: "sensitive",
    input: EmptyInputSchema,
    inputJsonSchema: z.toJSONSchema(EmptyInputSchema),
    execute: () => ({ contacts: ["private@example.test"] }),
  }),
] as const
