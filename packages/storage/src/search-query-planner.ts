export type SearchMode = "recent" | "fts5-trigram" | "like";

export interface ArticleSearchPlan {
  mode: SearchMode;
  joinSql: string;
  whereSql: string;
  parameters: readonly (string | number)[];
  normalizedText?: string;
}

export interface SearchPlannerOptions {
  fts5TrigramAvailable: boolean;
}

function unicodeLength(value: string): number {
  return [...value].length;
}

function containsShortToken(value: string): boolean {
  const tokens = value.split(/\s+/u).filter(Boolean);
  return tokens.some((token) => unicodeLength(token) < 3);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function quoteFtsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Plans only the text predicate. Callers append account/source/date filters and
 * LIMIT parameters separately. Trigram FTS cannot match tokens shorter than
 * three Unicode code points, so those searches intentionally use LIKE.
 */
export function planArticleTextSearch(
  text: string | undefined,
  options: SearchPlannerOptions,
): ArticleSearchPlan {
  const normalizedText = text?.trim().normalize("NFC");
  if (!normalizedText) {
    return { mode: "recent", joinSql: "", whereSql: "1 = 1", parameters: [] };
  }

  if (options.fts5TrigramAvailable && !containsShortToken(normalizedText)) {
    return {
      mode: "fts5-trigram",
      joinSql: "JOIN article_fts ON article_fts.article_id = a.id",
      whereSql: "article_fts MATCH ?",
      parameters: [quoteFtsPhrase(normalizedText)],
      normalizedText,
    };
  }

  const pattern = `%${escapeLike(normalizedText)}%`;
  return {
    mode: "like",
    joinSql: "",
    whereSql: [
      "(a.title LIKE ? ESCAPE '\\'",
      "OR COALESCE(a.author, '') LIKE ? ESCAPE '\\'",
      "OR COALESCE(a.summary, '') LIKE ? ESCAPE '\\'",
      "OR COALESCE(a.content_markdown, '') LIKE ? ESCAPE '\\')",
    ].join(" "),
    parameters: [pattern, pattern, pattern, pattern],
    normalizedText,
  };
}
