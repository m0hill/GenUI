import { micromark } from "micromark"

/** Renders untrusted model Markdown without embedded HTML or dangerous URL protocols. */
export const renderMarkdown = (markdown: string): string =>
  micromark(markdown, {
    allowDangerousHtml: false,
    allowDangerousProtocol: false,
  })
