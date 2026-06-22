import type { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"

const request = (path: string, init: RequestInit = {}): Request =>
  new Request(`http://test.local${path}`, init)

const datastarPost = (path: string, signals: unknown = {}): Request =>
  request(path, {
    method: "POST",
    headers: { "datastar-request": "true" },
    body: JSON.stringify(signals)
  })

const loadApp = async (): Promise<Hono> => {
  vi.resetModules()
  return (await import("./app.js")).app
}

const addTodo = async (app: Hono, title: string): Promise<Response> =>
  app.fetch(datastarPost("/todos", { title }))

describe("Hono todos", () => {
  it("renders the initial page as ordinary HTML", async () => {
    const app = await loadApp()
    const response = await app.fetch(request("/"))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("<h1>Hono todos</h1>")
    expect(html).toContain('data-on:submit__prevent="@post(&quot;/todos&quot;)"')
    expect(html).toContain('data-bind="title"')
    expect(html).toContain('<section id="todos" aria-label="Todos">')
    expect(html).toContain("No todos yet.")
  })

  it("adds a todo by calling the Hono app with a Datastar signal request", async () => {
    const app = await loadApp()
    const response = await app.fetch(datastarPost("/todos", { title: "Write tests" }))
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache")
    expect(body).toContain(
      'event: datastar-patch-signals\ndata: signals {"title":"","errors":{"title":""}}\n\n'
    )
    expect(body).toContain("event: datastar-patch-elements")
    expect(body).toContain('<li id="todo-1" data-completed="false">')
    expect(body).toContain("Write tests")
    expect(body).toContain("@post(&quot;/todos/1/toggle&quot;)")
    expect(body).toContain("1 of 1 remaining")
  })

  it("returns signal validation errors without a browser or framework mock", async () => {
    const app = await loadApp()
    const response = await app.fetch(datastarPost("/todos", { title: "   " }))

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    await expect(response.text()).resolves.toBe(
      'event: datastar-patch-signals\ndata: signals {"errors":{"title":"Enter a todo title."}}\n\n'
    )
  })

  it("patches the todo list after toggling and deleting items", async () => {
    const app = await loadApp()
    await addTodo(app, "Write docs")

    const toggled = await app.fetch(datastarPost("/todos/1/toggle"))
    const toggledBody = await toggled.text()

    expect(toggled.status).toBe(200)
    expect(toggledBody).toContain('<li id="todo-1" data-completed="true">')
    expect(toggledBody).toContain("<s>Write docs</s>")
    expect(toggledBody).toContain("0 of 1 remaining")

    const deleted = await app.fetch(datastarPost("/todos/1/delete"))
    const deletedBody = await deleted.text()

    expect(deleted.status).toBe(200)
    expect(deletedBody).toContain('<p id="empty-state">No todos yet.</p>')
    expect(deletedBody).toContain("0 of 0 remaining")
  })

  it("uses normal HTTP assertions for routes outside the Datastar contract", async () => {
    const app = await loadApp()
    const response = await app.fetch(datastarPost("/todos/999/toggle"))

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toBe("Not Found")
  })
})
