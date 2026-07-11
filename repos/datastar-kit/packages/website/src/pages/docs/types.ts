export interface DocHeading {
  readonly level: 2 | 3
  readonly text: string
  readonly slug: string
}

export interface DocSection {
  readonly heading: string
  readonly slug: string
  readonly text: string
}

export interface DocPage {
  readonly slug: string
  readonly path: string
  readonly title: string
  readonly description: string
  readonly html: string
  readonly markdown: string
  readonly headings: readonly DocHeading[]
  readonly sections: readonly DocSection[]
}
