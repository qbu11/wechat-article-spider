import type { ArticleSearchResult } from "../core/index.js";

export type ArticleQueryIntent = "keyword-search" | "account-window";
export type ArticleQueryScope = "local" | "global" | "hybrid";

export interface ArticleQueryRequest {
  intent?: ArticleQueryIntent;
  keywords?: string;
  account?: string;
  after?: string;
  before?: string;
  scope: ArticleQueryScope;
  limit: number;
}

export interface FastArticleJson {
  id: string;
  title: string;
  account: string | null;
  publishedAt: string | null;
  summary: string | null;
  url: string;
  originalUrl: string | null;
  discoveryUrl: string | null;
  linkKind: "original" | "discovery";
  contentAvailable: boolean;
  provenance: Array<{ connector: string; kind: string; url: string }>;
}

function normalized(value: string | undefined): string | undefined {
  const result = value?.replaceAll(/\s+/g, " ").trim();
  return result || undefined;
}

export function inferArticleQueryIntent(request: ArticleQueryRequest): ArticleQueryIntent {
  if (request.intent) {
    if (request.intent === "account-window" && !normalized(request.account)) {
      throw new Error("account-window intent requires --account");
    }
    if (request.intent === "keyword-search" && !normalized(request.keywords)) {
      throw new Error("keyword-search intent requires --keywords");
    }
    return request.intent;
  }
  if (normalized(request.account)) return "account-window";
  if (normalized(request.keywords)) return "keyword-search";
  throw new Error("query requires --keywords or --account");
}

export function parseDateBoundary(value: string | undefined, edge: "after" | "before"): string | undefined {
  const input = normalized(value);
  if (!input) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const parsed = new Date(dateOnly ? `${input}T${edge === "after" ? "00:00:00.000" : "23:59:59.999"}Z` : input);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid --${edge} date: ${value}`);
  return parsed.toISOString();
}

function hostname(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLocaleLowerCase();
  } catch {
    return undefined;
  }
}

function accountName(result: ArticleSearchResult): string | null {
  const values = [
    result.article.metadata?.accountName,
    ...result.sources.flatMap((source) => [source.metadata?.accountName, source.metadata?.feedTitle]),
  ];
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

export function toFastArticleJson(result: ArticleSearchResult): FastArticleJson {
  const originalSource = result.sources.find((source) => hostname(source.sourceUrl) !== "weixin.sogou.com");
  const discoverySource = result.sources.find((source) => hostname(source.sourceUrl) === "weixin.sogou.com");
  const canonicalIsDiscovery = hostname(result.article.canonicalUrl) === "weixin.sogou.com";
  const originalUrl = originalSource?.sourceUrl ?? (canonicalIsDiscovery ? null : result.article.canonicalUrl);
  const discoveryUrl = discoverySource?.sourceUrl ?? (canonicalIsDiscovery ? result.article.canonicalUrl : null);
  const url = originalUrl ?? discoveryUrl;
  if (!url) throw new Error(`Article ${result.article.id} has no usable URL`);
  return {
    id: result.article.id,
    title: result.article.title,
    account: accountName(result),
    publishedAt: result.article.publishedAt ?? null,
    summary: result.article.summary ?? null,
    url,
    originalUrl,
    discoveryUrl,
    linkKind: originalUrl ? "original" : "discovery",
    contentAvailable: Boolean(result.article.contentMarkdown || result.article.contentHtml),
    provenance: result.sources.map((source) => ({
      connector: source.connectorId,
      kind: source.connectorKind,
      url: source.sourceUrl,
    })),
  };
}

export function createFastQueryEnvelope(
  request: ArticleQueryRequest,
  results: ArticleSearchResult[],
  elapsedMs: number,
  connectorWarnings: string[] = [],
) {
  const intent = inferArticleQueryIntent(request);
  const articles = results.map(toFastArticleJson);
  const discoveryOnlyCount = articles.filter((article) => article.linkKind === "discovery").length;
  const warnings = [...connectorWarnings];
  if (discoveryOnlyCount > 0) {
    warnings.push(`${discoveryOnlyCount} result(s) expose a discovery URL because the original WeChat URL was not safely resolvable.`);
  }
  return {
    intent: {
      kind: intent,
      keywords: normalized(request.keywords) ?? null,
      account: normalized(request.account) ?? null,
      after: request.after ?? null,
      before: request.before ?? null,
    },
    mode: "fast-links",
    scope: request.scope,
    coverage: request.scope === "local" ? "local-index" : "best-effort-discovery",
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    count: articles.length,
    articles,
    warnings,
  };
}
