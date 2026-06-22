import { describe, expect, it } from "vitest"
import { del, get, js, patch, post, put, queryUrl, regex, signal } from "../src/ds/index.js"

describe("queryUrl", () => {
  it("builds encoded query URL expressions from signals", () => {
    const q = signal<string, "q">("q")

    expect(queryUrl("/search", { q }).toDatastarExpression()).toBe(
      "`/search?q=${encodeURIComponent($q)}`"
    )
  })

  it("returns a string literal when there are no dynamic parameters", () => {
    expect(queryUrl("/search", {}).toDatastarExpression()).toBe('"/search"')
  })

  it("uses ampersands when the path already has a query string", () => {
    const page = signal<number, "page">("page")

    expect(queryUrl("/search?sort=name", { page }).toDatastarExpression()).toBe(
      "`/search?sort=name&page=${encodeURIComponent($page)}`"
    )
  })

  it("inserts generated query parameters before URL fragments", () => {
    const q = signal<string, "q">("q")

    expect(queryUrl("/search#results", { q }).toDatastarExpression()).toBe(
      "`/search?q=${encodeURIComponent($q)}#results`"
    )
    expect(queryUrl("/search?sort=name#results", { q }).toDatastarExpression()).toBe(
      "`/search?sort=name&q=${encodeURIComponent($q)}#results`"
    )
  })

  it("does not add an extra separator after an open query string", () => {
    const page = signal<number, "page">("page")

    expect(queryUrl("/search?", { page }).toDatastarExpression()).toBe(
      "`/search?page=${encodeURIComponent($page)}`"
    )
    expect(queryUrl("/search?sort=name&", { page }).toDatastarExpression()).toBe(
      "`/search?sort=name&page=${encodeURIComponent($page)}`"
    )
  })

  it("supports static query values", () => {
    expect(queryUrl("/search", { q: "ada", page: 2 }).toDatastarExpression()).toBe(
      '`/search?q=${encodeURIComponent("ada")}&page=${encodeURIComponent(2)}`'
    )
  })

  it("escapes template syntax that belongs to the authored path", () => {
    const q = signal<string, "q">("q")

    expect(queryUrl("/docs/`literal`/${section}", { q }).toDatastarExpression()).toBe(
      "`/docs/\\`literal\\`/\\${section}?q=${encodeURIComponent($q)}`"
    )
  })
})

describe("fetch actions", () => {
  it("builds all HTTP method helpers", () => {
    expect(get("/items").toDatastarExpression()).toBe('@get("/items")')
    expect(post("/items").toDatastarExpression()).toBe('@post("/items")')
    expect(put("/items/1").toDatastarExpression()).toBe('@put("/items/1")')
    expect(patch("/items/1").toDatastarExpression()).toBe('@patch("/items/1")')
    expect(del("/items/1").toDatastarExpression()).toBe('@delete("/items/1")')
  })

  it("composes dynamic URLs with backend actions", () => {
    const q = signal<string, "q">("q")

    expect(get(queryUrl("/search", { q })).toDatastarExpression()).toBe(
      "@get(`/search?q=${encodeURIComponent($q)}`)"
    )
  })

  it("serializes fetch action protocol options in Datastar order", () => {
    const count = signal<number, "count">("count")

    expect(
      get("/todos", {
        selector: "#filters",
        headers: { "x-csrf": "token" },
        contentType: "json",
        filterSignals: { include: regex("^todo"), exclude: /_draft$/ },
        openWhenHidden: true,
        payload: { count, note: "hello" },
        retry: "always",
        retryInterval: 250,
        retryScaler: 1.5,
        retryMaxWait: 5000,
        retryMaxCount: 3,
        requestCancellation: js<AbortController>("controller")
      }).toDatastarExpression()
    ).toBe(
      '@get("/todos", {selector: "#filters", headers: {"x-csrf": "token"}, contentType: "json", filterSignals: {"include": new RegExp("^todo", ""), "exclude": new RegExp("_draft$", "")}, openWhenHidden: true, payload: {"count": $count, "note": "hello"}, retry: "always", retryInterval: 250, retryScaler: 1.5, retryMaxWait: 5000, retryMaxCount: 3, requestCancellation: controller})'
    )
  })

  it("serializes null selector and form encoding options", () => {
    expect(
      get("/fragment", {
        selector: null,
        contentType: "form",
        openWhenHidden: true
      }).toDatastarExpression()
    ).toBe('@get("/fragment", {selector: null, contentType: "form", openWhenHidden: true})')
  })
})
