import type { DatastarAttributes, DatastarAttributeValue } from "./ds/attribute-types.js"
import type { HtmlChild, HtmlPropValue } from "./html.js"

/**
 * A known literal union that still accepts any other string while keeping autocomplete.
 */
type Loose<Known extends string> = Known | (string & {})

type HtmlAttributeValue = HtmlPropValue | HtmlChild | readonly HtmlChild[] | DatastarAttributeValue

type AriaBoolean = boolean | "true" | "false" | undefined

/**
 * WAI-ARIA attributes accepted by every intrinsic JSX element.
 *
 * Unrecognized `aria-*` attributes are accepted through the template signature escape hatch.
 */
export interface AriaAttributes {
  "aria-activedescendant"?: string | undefined
  "aria-atomic"?: AriaBoolean
  "aria-autocomplete"?: "none" | "inline" | "list" | "both" | undefined
  "aria-braillelabel"?: string | undefined
  "aria-brailleroledescription"?: string | undefined
  "aria-busy"?: AriaBoolean
  "aria-checked"?: boolean | "true" | "false" | "mixed" | undefined
  "aria-colcount"?: number | string | undefined
  "aria-colindex"?: number | string | undefined
  "aria-colindextext"?: string | undefined
  "aria-colspan"?: number | string | undefined
  "aria-controls"?: string | undefined
  "aria-current"?:
    | boolean
    | Loose<"true" | "false" | "page" | "step" | "location" | "date" | "time">
    | undefined
  "aria-describedby"?: string | undefined
  "aria-description"?: string | undefined
  "aria-details"?: string | undefined
  "aria-disabled"?: AriaBoolean
  "aria-errormessage"?: string | undefined
  "aria-expanded"?: AriaBoolean
  "aria-flowto"?: string | undefined
  "aria-haspopup"?:
    | boolean
    | Loose<"true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog">
    | undefined
  "aria-hidden"?: AriaBoolean
  "aria-invalid"?: boolean | Loose<"true" | "false" | "grammar" | "spelling"> | undefined
  "aria-keyshortcuts"?: string | undefined
  "aria-label"?: string | undefined
  "aria-labelledby"?: string | undefined
  "aria-level"?: number | string | undefined
  "aria-live"?: "off" | "polite" | "assertive" | undefined
  "aria-modal"?: AriaBoolean
  "aria-multiline"?: AriaBoolean
  "aria-multiselectable"?: AriaBoolean
  "aria-orientation"?: "horizontal" | "vertical" | undefined
  "aria-owns"?: string | undefined
  "aria-placeholder"?: string | undefined
  "aria-posinset"?: number | string | undefined
  "aria-pressed"?: boolean | "true" | "false" | "mixed" | undefined
  "aria-readonly"?: AriaBoolean
  "aria-relevant"?: string | undefined
  "aria-required"?: AriaBoolean
  "aria-roledescription"?: string | undefined
  "aria-rowcount"?: number | string | undefined
  "aria-rowindex"?: number | string | undefined
  "aria-rowindextext"?: string | undefined
  "aria-rowspan"?: number | string | undefined
  "aria-selected"?: AriaBoolean
  "aria-setsize"?: number | string | undefined
  "aria-sort"?: "none" | "ascending" | "descending" | "other" | undefined
  "aria-valuemax"?: number | string | undefined
  "aria-valuemin"?: number | string | undefined
  "aria-valuenow"?: number | string | undefined
  "aria-valuetext"?: string | undefined

  /** Escape hatch: any other `aria-*` attribute. */
  [name: `aria-${string}`]: HtmlPropValue
}

/** WAI-ARIA role values, with autocomplete for the standard roles. */
export type AriaRole = Loose<
  | "alert"
  | "alertdialog"
  | "application"
  | "article"
  | "banner"
  | "button"
  | "cell"
  | "checkbox"
  | "columnheader"
  | "combobox"
  | "complementary"
  | "contentinfo"
  | "definition"
  | "dialog"
  | "directory"
  | "document"
  | "feed"
  | "figure"
  | "form"
  | "grid"
  | "gridcell"
  | "group"
  | "heading"
  | "img"
  | "link"
  | "list"
  | "listbox"
  | "listitem"
  | "log"
  | "main"
  | "marquee"
  | "math"
  | "menu"
  | "menubar"
  | "menuitem"
  | "menuitemcheckbox"
  | "menuitemradio"
  | "meter"
  | "navigation"
  | "none"
  | "note"
  | "option"
  | "presentation"
  | "progressbar"
  | "radio"
  | "radiogroup"
  | "region"
  | "row"
  | "rowgroup"
  | "rowheader"
  | "scrollbar"
  | "search"
  | "searchbox"
  | "separator"
  | "slider"
  | "spinbutton"
  | "status"
  | "switch"
  | "tab"
  | "table"
  | "tablist"
  | "tabpanel"
  | "term"
  | "textbox"
  | "timer"
  | "toolbar"
  | "tooltip"
  | "tree"
  | "treegrid"
  | "treeitem"
>

type ReferrerPolicy =
  | ""
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url"
  | undefined

type CrossOrigin = "" | "anonymous" | "use-credentials" | undefined

type Target = Loose<"_self" | "_blank" | "_parent" | "_top"> | undefined

type FormEnctype =
  | "application/x-www-form-urlencoded"
  | "multipart/form-data"
  | "text/plain"
  | undefined

type FormMethod = Loose<"get" | "post" | "dialog"> | undefined

type AutocompleteValue = Loose<
  | "on"
  | "off"
  | "name"
  | "given-name"
  | "family-name"
  | "nickname"
  | "email"
  | "username"
  | "new-password"
  | "current-password"
  | "one-time-code"
  | "organization"
  | "street-address"
  | "country"
  | "postal-code"
  | "cc-name"
  | "cc-number"
  | "cc-exp"
  | "cc-csc"
  | "bday"
  | "sex"
  | "tel"
  | "url"
  | "photo"
>

/**
 * Global HTML attributes accepted by every intrinsic JSX element, including Datastar attributes.
 */
export interface HtmlGlobalAttributes extends DatastarAttributes, AriaAttributes {
  /** Escape hatch for custom, vendor, and future HTML attributes. */
  [attribute: string]: HtmlAttributeValue

  /** JSX list key consumed by the compiler/runtime boundary; never rendered. */
  key?: string | number | undefined
  /** Element children. */
  children?: HtmlChild | readonly HtmlChild[] | undefined

  accesskey?: string | undefined
  autocapitalize?: "off" | "none" | "on" | "sentences" | "words" | "characters" | undefined
  autocorrect?: "on" | "off" | undefined
  autofocus?: boolean | undefined
  /** HTML `class` attribute. */
  class?: string | undefined
  /** Alias for `class`; normalized by the JSX runtime. */
  className?: string | undefined
  contenteditable?: boolean | "true" | "false" | "plaintext-only" | undefined
  dir?: "ltr" | "rtl" | "auto" | undefined
  draggable?: boolean | "true" | "false" | undefined
  enterkeyhint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send" | undefined
  exportparts?: string | undefined
  hidden?: boolean | "hidden" | "until-found" | undefined
  id?: string | undefined
  inert?: boolean | undefined
  inputmode?:
    | "none"
    | "text"
    | "tel"
    | "url"
    | "email"
    | "numeric"
    | "decimal"
    | "search"
    | undefined
  is?: string | undefined
  itemid?: string | undefined
  itemprop?: string | undefined
  itemref?: string | undefined
  itemscope?: boolean | undefined
  itemtype?: string | undefined
  lang?: string | undefined
  nonce?: string | undefined
  part?: string | undefined
  popover?: boolean | "auto" | "manual" | "hint" | undefined
  role?: AriaRole | undefined
  slot?: string | undefined
  spellcheck?: boolean | "true" | "false" | undefined
  /** Inline CSS rendered as the `style` attribute string. */
  style?: string | undefined
  tabindex?: number | string | undefined
  title?: string | undefined
  translate?: "yes" | "no" | undefined
  writingsuggestions?: boolean | "true" | "false" | undefined
}

/** Global attributes for void elements, which cannot have children. */
export interface HtmlVoidGlobalAttributes extends HtmlGlobalAttributes {
  children?: never
}

export interface AnchorHtmlAttributes extends HtmlGlobalAttributes {
  download?: string | boolean | undefined
  href?: string | undefined
  hreflang?: string | undefined
  ping?: string | undefined
  referrerpolicy?: ReferrerPolicy
  rel?: string | undefined
  target?: Target
  type?: string | undefined
}

export interface AreaHtmlAttributes extends HtmlVoidGlobalAttributes {
  alt?: string | undefined
  coords?: string | undefined
  download?: string | boolean | undefined
  href?: string | undefined
  ping?: string | undefined
  referrerpolicy?: ReferrerPolicy
  rel?: string | undefined
  shape?: "rect" | "circle" | "poly" | "default" | undefined
  target?: Target
}

export interface AudioHtmlAttributes extends HtmlGlobalAttributes {
  autoplay?: boolean | undefined
  controls?: boolean | undefined
  controlslist?: string | undefined
  crossorigin?: CrossOrigin
  loop?: boolean | undefined
  muted?: boolean | undefined
  preload?: "" | "none" | "metadata" | "auto" | undefined
  src?: string | undefined
}

export interface BaseHtmlAttributes extends HtmlVoidGlobalAttributes {
  href?: string | undefined
  target?: Target
}

export interface BlockquoteHtmlAttributes extends HtmlGlobalAttributes {
  cite?: string | undefined
}

export interface ButtonHtmlAttributes extends HtmlGlobalAttributes {
  command?: string | undefined
  commandfor?: string | undefined
  disabled?: boolean | undefined
  form?: string | undefined
  formaction?: string | undefined
  formenctype?: FormEnctype
  formmethod?: FormMethod
  formnovalidate?: boolean | undefined
  formtarget?: Target
  name?: string | undefined
  popovertarget?: string | undefined
  popovertargetaction?: "toggle" | "show" | "hide" | undefined
  type?: "button" | "submit" | "reset" | undefined
  value?: string | number | undefined
}

export interface CanvasHtmlAttributes extends HtmlGlobalAttributes {
  height?: number | string | undefined
  width?: number | string | undefined
}

export interface ColHtmlAttributes extends HtmlVoidGlobalAttributes {
  span?: number | string | undefined
}

export interface ColgroupHtmlAttributes extends HtmlGlobalAttributes {
  span?: number | string | undefined
}

export interface DataHtmlAttributes extends HtmlGlobalAttributes {
  value?: string | number | undefined
}

export interface DetailsHtmlAttributes extends HtmlGlobalAttributes {
  name?: string | undefined
  open?: boolean | undefined
}

export interface DialogHtmlAttributes extends HtmlGlobalAttributes {
  closedby?: "any" | "closerequest" | "none" | undefined
  open?: boolean | undefined
}

export interface EmbedHtmlAttributes extends HtmlVoidGlobalAttributes {
  height?: number | string | undefined
  src?: string | undefined
  type?: string | undefined
  width?: number | string | undefined
}

export interface FieldsetHtmlAttributes extends HtmlGlobalAttributes {
  disabled?: boolean | undefined
  form?: string | undefined
  name?: string | undefined
}

export interface FormHtmlAttributes extends HtmlGlobalAttributes {
  "accept-charset"?: string | undefined
  action?: string | undefined
  autocomplete?: "on" | "off" | undefined
  enctype?: FormEnctype
  method?: FormMethod
  name?: string | undefined
  novalidate?: boolean | undefined
  rel?: string | undefined
  target?: Target
}

export interface HtmlHtmlAttributes extends HtmlGlobalAttributes {
  xmlns?: string | undefined
}

export interface IframeHtmlAttributes extends HtmlGlobalAttributes {
  allow?: string | undefined
  allowfullscreen?: boolean | undefined
  height?: number | string | undefined
  loading?: "eager" | "lazy" | undefined
  name?: string | undefined
  referrerpolicy?: ReferrerPolicy
  sandbox?: string | undefined
  src?: string | undefined
  srcdoc?: string | undefined
  width?: number | string | undefined
}

export interface ImgHtmlAttributes extends HtmlVoidGlobalAttributes {
  alt?: string | undefined
  crossorigin?: CrossOrigin
  decoding?: "sync" | "async" | "auto" | undefined
  elementtiming?: string | undefined
  fetchpriority?: "high" | "low" | "auto" | undefined
  height?: number | string | undefined
  ismap?: boolean | undefined
  loading?: "eager" | "lazy" | undefined
  referrerpolicy?: ReferrerPolicy
  sizes?: string | undefined
  src?: string | undefined
  srcset?: string | undefined
  usemap?: string | undefined
  width?: number | string | undefined
}

export interface InputHtmlAttributes extends HtmlVoidGlobalAttributes {
  accept?: string | undefined
  alt?: string | undefined
  autocomplete?: AutocompleteValue | undefined
  capture?: boolean | "user" | "environment" | undefined
  checked?: boolean | undefined
  dirname?: string | undefined
  disabled?: boolean | undefined
  form?: string | undefined
  formaction?: string | undefined
  formenctype?: FormEnctype
  formmethod?: FormMethod
  formnovalidate?: boolean | undefined
  formtarget?: Target
  height?: number | string | undefined
  list?: string | undefined
  max?: number | string | undefined
  maxlength?: number | string | undefined
  min?: number | string | undefined
  minlength?: number | string | undefined
  multiple?: boolean | undefined
  name?: string | undefined
  pattern?: string | undefined
  placeholder?: string | undefined
  popovertarget?: string | undefined
  popovertargetaction?: "toggle" | "show" | "hide" | undefined
  readonly?: boolean | undefined
  required?: boolean | undefined
  size?: number | string | undefined
  src?: string | undefined
  step?: number | string | undefined
  type?:
    | Loose<
        | "button"
        | "checkbox"
        | "color"
        | "date"
        | "datetime-local"
        | "email"
        | "file"
        | "hidden"
        | "image"
        | "month"
        | "number"
        | "password"
        | "radio"
        | "range"
        | "reset"
        | "search"
        | "submit"
        | "tel"
        | "text"
        | "time"
        | "url"
        | "week"
      >
    | undefined
  value?: string | number | undefined
  width?: number | string | undefined
}

export interface ModHtmlAttributes extends HtmlGlobalAttributes {
  cite?: string | undefined
  datetime?: string | undefined
}

export interface LabelHtmlAttributes extends HtmlGlobalAttributes {
  for?: string | undefined
  /** Alias for `for`; normalized by the JSX runtime. */
  htmlFor?: string | undefined
}

export interface LiHtmlAttributes extends HtmlGlobalAttributes {
  value?: number | string | undefined
}

export interface LinkHtmlAttributes extends HtmlVoidGlobalAttributes {
  as?: string | undefined
  blocking?: string | undefined
  crossorigin?: CrossOrigin
  disabled?: boolean | undefined
  fetchpriority?: "high" | "low" | "auto" | undefined
  href?: string | undefined
  hreflang?: string | undefined
  imagesizes?: string | undefined
  imagesrcset?: string | undefined
  integrity?: string | undefined
  media?: string | undefined
  referrerpolicy?: ReferrerPolicy
  rel?:
    | Loose<
        | "alternate"
        | "author"
        | "canonical"
        | "dns-prefetch"
        | "expect"
        | "help"
        | "icon"
        | "license"
        | "manifest"
        | "modulepreload"
        | "next"
        | "pingback"
        | "preconnect"
        | "prefetch"
        | "preload"
        | "prev"
        | "search"
        | "stylesheet"
      >
    | undefined
  sizes?: string | undefined
  type?: string | undefined
}

export interface MapHtmlAttributes extends HtmlGlobalAttributes {
  name?: string | undefined
}

export interface MetaHtmlAttributes extends HtmlVoidGlobalAttributes {
  charset?: Loose<"utf-8"> | undefined
  content?: string | undefined
  "http-equiv"?:
    | Loose<
        "content-security-policy" | "content-type" | "default-style" | "refresh" | "x-ua-compatible"
      >
    | undefined
  media?: string | undefined
  name?:
    | Loose<
        | "application-name"
        | "author"
        | "color-scheme"
        | "description"
        | "generator"
        | "keywords"
        | "referrer"
        | "robots"
        | "theme-color"
        | "viewport"
      >
    | undefined
}

export interface MeterHtmlAttributes extends HtmlGlobalAttributes {
  form?: string | undefined
  high?: number | string | undefined
  low?: number | string | undefined
  max?: number | string | undefined
  min?: number | string | undefined
  optimum?: number | string | undefined
  value?: number | string | undefined
}

export interface ObjectHtmlAttributes extends HtmlGlobalAttributes {
  data?: string | undefined
  form?: string | undefined
  height?: number | string | undefined
  name?: string | undefined
  type?: string | undefined
  width?: number | string | undefined
}

export interface OlHtmlAttributes extends HtmlGlobalAttributes {
  reversed?: boolean | undefined
  start?: number | string | undefined
  type?: "1" | "a" | "A" | "i" | "I" | undefined
}

export interface OptgroupHtmlAttributes extends HtmlGlobalAttributes {
  disabled?: boolean | undefined
  label?: string | undefined
}

export interface OptionHtmlAttributes extends HtmlGlobalAttributes {
  disabled?: boolean | undefined
  label?: string | undefined
  selected?: boolean | undefined
  value?: string | number | undefined
}

export interface OutputHtmlAttributes extends HtmlGlobalAttributes {
  for?: string | undefined
  /** Alias for `for`; normalized by the JSX runtime. */
  htmlFor?: string | undefined
  form?: string | undefined
  name?: string | undefined
}

export interface ProgressHtmlAttributes extends HtmlGlobalAttributes {
  max?: number | string | undefined
  value?: number | string | undefined
}

export interface QuoteHtmlAttributes extends HtmlGlobalAttributes {
  cite?: string | undefined
}

export interface ScriptHtmlAttributes extends HtmlGlobalAttributes {
  async?: boolean | undefined
  blocking?: string | undefined
  crossorigin?: CrossOrigin
  defer?: boolean | undefined
  fetchpriority?: "high" | "low" | "auto" | undefined
  integrity?: string | undefined
  nomodule?: boolean | undefined
  referrerpolicy?: ReferrerPolicy
  src?: string | undefined
  type?: Loose<"module" | "importmap" | "speculationrules" | "text/javascript"> | undefined
}

export interface SelectHtmlAttributes extends HtmlGlobalAttributes {
  autocomplete?: AutocompleteValue | undefined
  disabled?: boolean | undefined
  form?: string | undefined
  multiple?: boolean | undefined
  name?: string | undefined
  required?: boolean | undefined
  size?: number | string | undefined
}

export interface SlotHtmlAttributes extends HtmlGlobalAttributes {
  name?: string | undefined
}

export interface SourceHtmlAttributes extends HtmlVoidGlobalAttributes {
  height?: number | string | undefined
  media?: string | undefined
  sizes?: string | undefined
  src?: string | undefined
  srcset?: string | undefined
  type?: string | undefined
  width?: number | string | undefined
}

export interface StyleHtmlAttributes extends HtmlGlobalAttributes {
  blocking?: string | undefined
  media?: string | undefined
}

export interface TdHtmlAttributes extends HtmlGlobalAttributes {
  colspan?: number | string | undefined
  headers?: string | undefined
  rowspan?: number | string | undefined
}

export interface TextareaHtmlAttributes extends HtmlGlobalAttributes {
  autocomplete?: AutocompleteValue | undefined
  cols?: number | string | undefined
  dirname?: string | undefined
  disabled?: boolean | undefined
  form?: string | undefined
  maxlength?: number | string | undefined
  minlength?: number | string | undefined
  name?: string | undefined
  placeholder?: string | undefined
  readonly?: boolean | undefined
  required?: boolean | undefined
  rows?: number | string | undefined
  wrap?: "hard" | "soft" | undefined
}

export interface ThHtmlAttributes extends HtmlGlobalAttributes {
  abbr?: string | undefined
  colspan?: number | string | undefined
  headers?: string | undefined
  rowspan?: number | string | undefined
  scope?: "row" | "col" | "rowgroup" | "colgroup" | undefined
}

export interface TimeHtmlAttributes extends HtmlGlobalAttributes {
  datetime?: string | undefined
}

export interface TrackHtmlAttributes extends HtmlVoidGlobalAttributes {
  default?: boolean | undefined
  kind?: "subtitles" | "captions" | "descriptions" | "chapters" | "metadata" | undefined
  label?: string | undefined
  src?: string | undefined
  srclang?: string | undefined
}

export interface VideoHtmlAttributes extends HtmlGlobalAttributes {
  autoplay?: boolean | undefined
  controls?: boolean | undefined
  controlslist?: string | undefined
  crossorigin?: CrossOrigin
  disablepictureinpicture?: boolean | undefined
  disableremoteplayback?: boolean | undefined
  height?: number | string | undefined
  loop?: boolean | undefined
  muted?: boolean | undefined
  playsinline?: boolean | undefined
  poster?: string | undefined
  preload?: "" | "none" | "metadata" | "auto" | undefined
  src?: string | undefined
  width?: number | string | undefined
}

/**
 * Loosely typed props for SVG elements: global and Datastar attributes are typed, and any other
 * attribute accepts a serializable value.
 */
export interface SvgElementAttributes extends HtmlGlobalAttributes {
  [attribute: string]: HtmlAttributeValue
}

/**
 * Intrinsic HTML and SVG elements with typed attributes, used by `JSX.IntrinsicElements`.
 */
export interface HtmlElements {
  a: AnchorHtmlAttributes
  abbr: HtmlGlobalAttributes
  address: HtmlGlobalAttributes
  area: AreaHtmlAttributes
  article: HtmlGlobalAttributes
  aside: HtmlGlobalAttributes
  audio: AudioHtmlAttributes
  b: HtmlGlobalAttributes
  base: BaseHtmlAttributes
  bdi: HtmlGlobalAttributes
  bdo: HtmlGlobalAttributes
  blockquote: BlockquoteHtmlAttributes
  body: HtmlGlobalAttributes
  br: HtmlVoidGlobalAttributes
  button: ButtonHtmlAttributes
  canvas: CanvasHtmlAttributes
  caption: HtmlGlobalAttributes
  cite: HtmlGlobalAttributes
  code: HtmlGlobalAttributes
  col: ColHtmlAttributes
  colgroup: ColgroupHtmlAttributes
  data: DataHtmlAttributes
  datalist: HtmlGlobalAttributes
  dd: HtmlGlobalAttributes
  del: ModHtmlAttributes
  details: DetailsHtmlAttributes
  dfn: HtmlGlobalAttributes
  dialog: DialogHtmlAttributes
  div: HtmlGlobalAttributes
  dl: HtmlGlobalAttributes
  dt: HtmlGlobalAttributes
  em: HtmlGlobalAttributes
  embed: EmbedHtmlAttributes
  fieldset: FieldsetHtmlAttributes
  figcaption: HtmlGlobalAttributes
  figure: HtmlGlobalAttributes
  footer: HtmlGlobalAttributes
  form: FormHtmlAttributes
  h1: HtmlGlobalAttributes
  h2: HtmlGlobalAttributes
  h3: HtmlGlobalAttributes
  h4: HtmlGlobalAttributes
  h5: HtmlGlobalAttributes
  h6: HtmlGlobalAttributes
  head: HtmlGlobalAttributes
  header: HtmlGlobalAttributes
  hgroup: HtmlGlobalAttributes
  hr: HtmlVoidGlobalAttributes
  html: HtmlHtmlAttributes
  i: HtmlGlobalAttributes
  iframe: IframeHtmlAttributes
  img: ImgHtmlAttributes
  input: InputHtmlAttributes
  ins: ModHtmlAttributes
  kbd: HtmlGlobalAttributes
  label: LabelHtmlAttributes
  legend: HtmlGlobalAttributes
  li: LiHtmlAttributes
  link: LinkHtmlAttributes
  main: HtmlGlobalAttributes
  map: MapHtmlAttributes
  mark: HtmlGlobalAttributes
  menu: HtmlGlobalAttributes
  meta: MetaHtmlAttributes
  meter: MeterHtmlAttributes
  nav: HtmlGlobalAttributes
  noscript: HtmlGlobalAttributes
  object: ObjectHtmlAttributes
  ol: OlHtmlAttributes
  optgroup: OptgroupHtmlAttributes
  option: OptionHtmlAttributes
  output: OutputHtmlAttributes
  p: HtmlGlobalAttributes
  picture: HtmlGlobalAttributes
  pre: HtmlGlobalAttributes
  progress: ProgressHtmlAttributes
  q: QuoteHtmlAttributes
  rp: HtmlGlobalAttributes
  rt: HtmlGlobalAttributes
  ruby: HtmlGlobalAttributes
  s: HtmlGlobalAttributes
  samp: HtmlGlobalAttributes
  script: ScriptHtmlAttributes
  search: HtmlGlobalAttributes
  section: HtmlGlobalAttributes
  select: SelectHtmlAttributes
  slot: SlotHtmlAttributes
  small: HtmlGlobalAttributes
  source: SourceHtmlAttributes
  span: HtmlGlobalAttributes
  strong: HtmlGlobalAttributes
  style: StyleHtmlAttributes
  sub: HtmlGlobalAttributes
  summary: HtmlGlobalAttributes
  sup: HtmlGlobalAttributes
  table: HtmlGlobalAttributes
  tbody: HtmlGlobalAttributes
  td: TdHtmlAttributes
  template: HtmlGlobalAttributes
  textarea: TextareaHtmlAttributes
  tfoot: HtmlGlobalAttributes
  th: ThHtmlAttributes
  thead: HtmlGlobalAttributes
  time: TimeHtmlAttributes
  title: HtmlGlobalAttributes
  tr: HtmlGlobalAttributes
  track: TrackHtmlAttributes
  u: HtmlGlobalAttributes
  ul: HtmlGlobalAttributes
  var: HtmlGlobalAttributes
  video: VideoHtmlAttributes
  wbr: HtmlVoidGlobalAttributes

  circle: SvgElementAttributes
  clipPath: SvgElementAttributes
  defs: SvgElementAttributes
  desc: SvgElementAttributes
  ellipse: SvgElementAttributes
  filter: SvgElementAttributes
  foreignObject: SvgElementAttributes
  g: SvgElementAttributes
  image: SvgElementAttributes
  line: SvgElementAttributes
  linearGradient: SvgElementAttributes
  marker: SvgElementAttributes
  mask: SvgElementAttributes
  path: SvgElementAttributes
  pattern: SvgElementAttributes
  polygon: SvgElementAttributes
  polyline: SvgElementAttributes
  radialGradient: SvgElementAttributes
  rect: SvgElementAttributes
  stop: SvgElementAttributes
  svg: SvgElementAttributes
  symbol: SvgElementAttributes
  text: SvgElementAttributes
  textPath: SvgElementAttributes
  tspan: SvgElementAttributes
  use: SvgElementAttributes
  view: SvgElementAttributes
}
