import { subscription } from "genui"
import { z } from "zod"
import { OrderSchema, OrderStatusSchema, watchOrderChanges } from "./actions.js"

const OrderChangesInputSchema = z.strictObject({
  status: OrderStatusSchema.optional(),
})

const OrderChangeEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("orders.snapshot"),
    orders: z.array(OrderSchema),
  }),
  z.strictObject({
    type: z.literal("order.updated"),
    order: OrderSchema,
    previousStatus: OrderStatusSchema,
  }),
])

export const demoSubscriptions = [
  subscription({
    name: "orders.changes",
    description: "Receive an initial order snapshot and later status changes.",
    input: OrderChangesInputSchema,
    inputJsonSchema: z.toJSONSchema(OrderChangesInputSchema, { io: "input" }),
    event: OrderChangeEventSchema,
    eventJsonSchema: z.toJSONSchema(OrderChangeEventSchema),
    subscribe: (_context: unknown, input, options) => watchOrderChanges(input, options),
  }),
] as const
