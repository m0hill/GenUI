import assert from "node:assert/strict"
import test from "node:test"
import { renderMarkdown } from "./markdown.js"

void test("Markdown renders common block and inline syntax", () => {
  const html = renderMarkdown("## Answer\n\nUse **bold** text.\n\n- one\n- two\n\n`code`")

  assert.match(html, /<h2>Answer<\/h2>/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<ul>/)
  assert.match(html, /<code>code<\/code>/)
})

void test("Markdown encodes raw HTML and removes dangerous protocols", () => {
  const html = renderMarkdown('<script>alert("xss")</script>\n\n[bad](javascript:alert(1))')

  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /javascript:/)
})

void test("incomplete streaming Markdown remains renderable", () => {
  assert.equal(renderMarkdown("**partial"), "<p>**partial</p>")
  assert.equal(renderMarkdown("**complete**"), "<p><strong>complete</strong></p>")
})
