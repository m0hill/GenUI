import assert from "node:assert/strict"
import { test } from "node:test"
import { splitDelimitedSource } from "./source-scanner.js"

void test("source scanner splits outside quotes", () => {
  assert.deepEqual(
    splitDelimitedSource(`name: 'a:b', count: 2`, {
      separator: ",",
      brackets: { type: "reject", characters: "()[]{}" },
      requireNonEmptyParts: true,
    }),
    ["name: 'a:b'", "count: 2"],
  )
})

void test("source scanner rejects shallow bracketed content and empty required parts", () => {
  assert.equal(
    splitDelimitedSource(`nested: { value: 1 }`, {
      separator: ":",
      brackets: { type: "reject", characters: "()[]{}" },
      requireNonEmptyParts: true,
    }),
    undefined,
  )
  assert.equal(
    splitDelimitedSource(`name,,count`, {
      separator: ",",
      brackets: { type: "reject", characters: "()[]{}" },
      requireNonEmptyParts: true,
    }),
    undefined,
  )
})

void test("source scanner tracks configured bracket depth", () => {
  assert.deepEqual(
    splitDelimitedSource(`'demo.call', { label: 'a,b' }, { target: 'result' }`, {
      separator: ",",
      brackets: { type: "track-depth", open: "([{", close: ")]}" },
      requireNonEmptyParts: true,
    }),
    ["'demo.call'", "{ label: 'a,b' }", "{ target: 'result' }"],
  )
  assert.equal(
    splitDelimitedSource(`'demo.call', { label: 'a' `, {
      separator: ",",
      brackets: { type: "track-depth", open: "([{", close: ")]}" },
      requireNonEmptyParts: true,
    }),
    undefined,
  )
})

void test("source scanner can preserve empty parts for CSS declaration lists", () => {
  assert.deepEqual(
    splitDelimitedSource(`color: rgb(1; 2; 3); ; margin: 0`, {
      separator: ";",
      brackets: { type: "track-depth", open: "(", close: ")" },
    }),
    ["color: rgb(1; 2; 3)", "", "margin: 0"],
  )
})

void test("source scanner rejects escapes and unclosed quotes", () => {
  assert.equal(
    splitDelimitedSource(`name: 'unterminated`, {
      separator: ",",
      brackets: { type: "reject", characters: "()[]{}" },
    }),
    undefined,
  )
  assert.equal(
    splitDelimitedSource(String.raw`name: 'a\'`, {
      separator: ",",
      brackets: { type: "reject", characters: "()[]{}" },
    }),
    undefined,
  )
})
