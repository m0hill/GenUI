import type { Context } from "hono"

export const prefersMarkdown = (c: Context): boolean =>
  /\btext\/markdown\b/i.test(c.req.header("accept") ?? "")

const estimateTokens = (body: string): number => Math.max(1, Math.ceil(body.length / 4))

export const markdownResponse = (body: string): Response =>
  new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "x-markdown-tokens": String(estimateTokens(body)),
      vary: "Accept"
    }
  })

export const varyOnAccept = (res: Response): Response => {
  res.headers.set("Vary", "Accept")
  return res
}
