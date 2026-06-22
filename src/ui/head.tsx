import { unsafeHtml, type HtmlChild } from "datastar-kit";

const DATASTAR_RUNTIME =
  "https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js";

const THEME_INIT =
  "(function(){try{var s=localStorage.getItem('theme');" +
  "if(s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches){" +
  "document.documentElement.classList.add('dark')}}catch(e){}})()";

/** Shared <head> for every full-page render. */
export const pageHead: HtmlChild[] = [
  <meta name="color-scheme" content="light dark" />,
  <script>{unsafeHtml(THEME_INIT)}</script>,
  <link
    rel="preload"
    href="/public/fonts/geist-latin-wght-normal.woff2"
    as="font"
    type="font/woff2"
    crossorigin="anonymous"
  />,
  <link
    rel="preload"
    href="/public/fonts/geist-mono-latin-wght-normal.woff2"
    as="font"
    type="font/woff2"
    crossorigin="anonymous"
  />,
  <link rel="stylesheet" href="/public/styles.css" />,
  <script type="module" src={DATASTAR_RUNTIME} />,
];
