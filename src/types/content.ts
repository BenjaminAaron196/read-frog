export interface WebPageContext {
  webTitle: string
  webDescription?: string
  webContent?: string
  webSummary?: string
}

export interface WebPagePromptContext {
  /**
   * The page the context describes. The content script is the only side that can
   * read it, and the genre classifier needs it - a path often names the genre
   * when the title does not.
   */
  url?: string | null
  webTitle?: string | null
  webDescription?: string | null
  webContent?: string | null
  webSummary?: string | null
  /** Sentences around the selection; only the selection toolbar has them. */
  paragraphs?: string | null
}

export interface SubtitlePromptContext {
  /** The video's URL, for the genre classifier. */
  url?: string | null
  webTitle?: string | null
  webDescription?: string | null
  videoSummary?: string | null
}
