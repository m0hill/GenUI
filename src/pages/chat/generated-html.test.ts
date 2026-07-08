import assert from "node:assert/strict"
import { test } from "node:test"
import { renderGeneratedHtml } from "./generated-html.js"

void test("generated HTML only keeps leased capability calls", () => {
  const allowed = renderGeneratedHtml(
    `<button data-on:click="@capability('demo.echo', { text: 'hello' })">Run</button>`,
    { allowedCapabilities: new Set(["demo.echo"]) },
  )
  assert.match(allowed, /data-on:click="@capability\('demo.echo'/)

  const denied = renderGeneratedHtml(
    `<button data-on:click="@capability('demo.echo', { text: 'hello' })">Run</button>`,
    { allowedCapabilities: new Set(["chat.follow_up"]) },
  )
  assert.doesNotMatch(denied, /data-on:click/)
})

void test("generated HTML keeps registered local Datastar actions and plugin attributes", () => {
  const html = renderGeneratedHtml(
    [
      `<input data-focus-when="$_ui_open">`,
      `<button data-on:click="@toast({ message: 'Saved' })">Save</button>`,
    ].join(""),
    {
      allowedActions: new Set(["toast"]),
      allowedPluginAttributes: new Set(["data-focus-when"]),
    },
  )

  assert.match(html, /data-focus-when="\$_ui_open"/)
  assert.match(html, /data-on:click="@toast/)
})
