import { action } from "genui"
import { z } from "zod"

const OrderStatusSchema = z.enum(["pending", "processing", "shipped"])

const OrderSchema = z.strictObject({
  id: z.string(),
  customer: z.string(),
  status: OrderStatusSchema,
  total: z.number(),
})
type Order = z.infer<typeof OrderSchema>

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

export const resetDemoOrders = (): void => {
  orders = initialOrders.map((order) => ({ ...order }))
}

resetDemoOrders()

const orderJsonSchema = z.toJSONSchema(OrderSchema)

const findOrder = (id: string): Order => {
  const order = orders.find((candidate) => candidate.id === id)
  if (order === undefined) throw new Error(`Unknown order: ${id}`)
  return order
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
