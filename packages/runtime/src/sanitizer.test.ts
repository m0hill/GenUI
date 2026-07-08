import assert from "node:assert/strict"
import { test } from "node:test"
import { sanitizeSurfaceHtml } from "./sanitizer.js"

const granted = new Set(["dice.roll"])

void test("sanitizer strips dangerous tags, event handlers, and URL schemes", () => {
  const safe = sanitizeSurfaceHtml(
    [
      `<div onclick="evil()">`,
      `<script>alert(1)</script>`,
      `<iframe src="https://example.com/embed"></iframe>`,
      `<a href="javascript:alert(1)">bad</a>`,
      `<img src="data:text/html,evil" onerror="evil()">`,
      `<img src="https://example.com/image.png">`,
      `</div>`,
    ].join(""),
    granted,
  )

  assert.doesNotMatch(safe, /<script/i)
  assert.doesNotMatch(safe, /<iframe/i)
  assert.doesNotMatch(safe, /onclick/i)
  assert.doesNotMatch(safe, /onerror/i)
  assert.doesNotMatch(safe, /javascript:/i)
  assert.doesNotMatch(safe, /data:text/i)
  assert.match(safe, /src="https:\/\/example\.com\/image\.png"/)
})

void test("sanitizer strips direct form submission attributes", () => {
  const safe = sanitizeSurfaceHtml(
    [
      `<form action="https://example.com/post" method="post" target="_top">`,
      `<button formaction="https://example.com/override">Submit</button>`,
      `<a href="https://example.com" target="_top" download ping="https://example.com/ping">Open</a>`,
      `</form>`,
    ].join(""),
    granted,
  )

  assert.doesNotMatch(safe, /\saction=/i)
  assert.doesNotMatch(safe, /\sformaction=/i)
  assert.doesNotMatch(safe, /\smethod=/i)
  assert.doesNotMatch(safe, /\starget=/i)
  assert.doesNotMatch(safe, /\sdownload/i)
  assert.doesNotMatch(safe, /\sping=/i)
  assert.match(safe, /href="https:\/\/example\.com"/)
})

void test("sanitizer strips indirect URL-bearing attributes and inline styles", () => {
  const safe = sanitizeSurfaceHtml(
    [
      `<svg><a xlink:href="javascript:alert(1)">bad</a></svg>`,
      `<img srcset="javascript:alert(1) 1x, https://example.com/a.png 2x">`,
      `<div style="background-image:url(https://example.com/track.png)">x</div>`,
    ].join(""),
    granted,
  )

  assert.doesNotMatch(safe, /xlink:href/i)
  assert.doesNotMatch(safe, /srcset/i)
  assert.doesNotMatch(safe, /\sstyle=/i)
  assert.doesNotMatch(safe, /javascript:/i)
  assert.doesNotMatch(safe, /url\(/i)
})

void test("sanitizer preserves only granted capability calls", () => {
  const safe = sanitizeSurfaceHtml(
    [
      `<button data-on:click="@capability('dice.roll', { sides: 6 }, { target: 'rollResult' })">Roll</button>`,
      `<button data-on:click="@capability('demo.secret', {})">Secret</button>`,
    ].join(""),
    granted,
  )

  assert.match(
    safe,
    /data-on:click="@capability\('dice\.roll', \{ sides: 6 \}, \{ target: 'rollResult' \}\)"/,
  )
  assert.doesNotMatch(safe, /demo\.secret/)
})

void test("sanitizer strips unsafe Datastar expressions", () => {
  const safe = sanitizeSurfaceHtml(
    [
      `<span data-text="window.location">x</span>`,
      `<button data-on:click="@capability('dice.roll', { sides: 6 }); fetch('/x')">Bad</button>`,
      `<span data-signals="{ count: 1 }" data-text="$count">1</span>`,
    ].join(""),
    granted,
  )

  assert.doesNotMatch(safe, /window\.location/)
  assert.doesNotMatch(safe, /fetch/)
  assert.doesNotMatch(safe, /data-on:click/)
  assert.match(safe, /data-signals="\{ count: 1 \}"/)
  assert.match(safe, /data-text="\$count"/)
})

void test("sanitizer strips JavaScript-shaped constructor expressions", () => {
  const safe = sanitizeSurfaceHtml(
    [
      `<span data-text="this['constructor']['constructor']('return 1')()">x</span>`,
      `<button data-on:click="@capability('dice.roll', { sides: this['constructor']['constructor']('return 6')() })">Roll</button>`,
      `<span data-text="$count">1</span>`,
    ].join(""),
    granted,
  )

  assert.doesNotMatch(safe, /constructor/)
  assert.doesNotMatch(safe, /data-on:click/)
  assert.match(safe, /data-text="\$count"/)
})

void test("sanitizer repairs truncated HTML and is idempotent", () => {
  const safe = sanitizeSurfaceHtml(`<section><div><span data-text="$label">Hi`, granted)

  assert.equal(safe, `<section><div><span data-text="$label">Hi</span></div></section>`)
  assert.equal(sanitizeSurfaceHtml(safe, granted), safe)
})

void test("sanitizer preserves text that contains a literal less-than character", () => {
  const safe = sanitizeSurfaceHtml(`<p>2 < 3`, granted)

  assert.equal(safe, `<p>2 &lt; 3</p>`)
})
