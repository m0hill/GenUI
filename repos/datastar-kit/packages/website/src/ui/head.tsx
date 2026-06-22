import { unsafeHtml, type HtmlChild } from "datastar-kit"
import { SITE_URL } from "../constants"

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"

const FONT_PRELOADS = [
  "/fonts/geist-latin-wght-normal.woff2",
  "/fonts/geist-mono-latin-wght-normal.woff2"
] as const

const THEME_INIT =
  "(function(){try{var s=localStorage.getItem('theme');" +
  "if(s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches){" +
  "document.documentElement.classList.add('dark')}}catch(e){}})()"

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#fff"/><text x="16" y="22" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="16" font-weight="700" letter-spacing="-1" text-anchor="middle" fill="#1b55ff">DK</text></svg>`
  )

export const pageHead = (options: { description?: string; path?: string }): HtmlChild[] => [
  <meta charset="utf-8" />,
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  />,
  <meta
    name="color-scheme"
    content="light dark"
  />,
  <link
    rel="preconnect"
    href="https://cdn.jsdelivr.net"
  />,
  <link
    rel="preload"
    href="/styles.css"
    as="style"
  />,
  ...FONT_PRELOADS.map((href) => (
    <link
      rel="preload"
      href={href}
      as="font"
      type="font/woff2"
      crossorigin="anonymous"
    />
  )),
  <script>{unsafeHtml(THEME_INIT)}</script>,
  ...(options.description === undefined
    ? []
    : [
        <meta
          name="description"
          content={options.description}
        />
      ]),
  ...(options.path === undefined
    ? []
    : [
        <link
          rel="canonical"
          href={`${SITE_URL}${options.path === "/" ? "" : options.path}`}
        />
      ]),
  <link
    rel="icon"
    href={FAVICON}
  />,
  <link
    rel="stylesheet"
    href="/styles.css"
    fetchpriority="high"
  />,
  <script
    type="module"
    src={DATASTAR_RUNTIME}
  />
]
