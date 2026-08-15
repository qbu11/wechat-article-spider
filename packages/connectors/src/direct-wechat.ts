import {
  ConnectorError,
  createStableId,
  deriveStableArticleIdentity,
  extractWechatArticleCoordinates,
  hashArticleContent,
  throwIfAborted,
  type ConnectorContext,
  type DiscoveredArticle,
  type SourceConnector,
} from "../../core/src/index.js";

export interface WechatArticleUrl {
  url: URL;
  canonicalUrl: string;
  biz?: string;
  mid?: string;
  idx?: string;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  html: string;
}

export interface WechatPageFetcher {
  fetch(url: string, options: { signal?: AbortSignal }): Promise<FetchedPage>;
}

export interface ParsedWechatPage {
  title: string;
  author?: string;
  summary?: string;
  publishedAt?: string;
  contentHtml?: string;
  accountName?: string;
  metadata?: Record<string, unknown>;
}

export interface WechatPageParser {
  parse(page: FetchedPage): Promise<ParsedWechatPage> | ParsedWechatPage;
}

export function parseWechatArticleUrl(input: string | URL): WechatArticleUrl {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch (cause) {
    throw new ConnectorError("INVALID_INPUT", "Invalid article URL", { cause });
  }

  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "mp.weixin.qq.com") {
    throw new ConnectorError(
      "INVALID_INPUT",
      "Direct WeChat connector accepts only https://mp.weixin.qq.com article URLs",
    );
  }
  if (url.pathname !== "/s" && !url.pathname.startsWith("/s/")) {
    throw new ConnectorError("INVALID_INPUT", "URL is not a WeChat article path");
  }

  const identity = deriveStableArticleIdentity(url);
  const coordinates = extractWechatArticleCoordinates(url);
  return {
    url,
    canonicalUrl: identity.canonicalUrl,
    ...(coordinates
      ? { biz: coordinates.biz, mid: coordinates.mid, idx: coordinates.idx }
      : {}),
  };
}

export class DirectWechatConnector implements SourceConnector {
  readonly id: string;
  readonly kind = "direct-wechat" as const;
  readonly capabilities = new Set(["article-read", "full-content"] as const);

  constructor(
    private readonly fetcher: WechatPageFetcher,
    private readonly parser: WechatPageParser,
    options: { id?: string } = {},
  ) {
    this.id = options.id ?? "direct-wechat";
  }

  async health(context: ConnectorContext) {
    return {
      connectorId: this.id,
      state: "unknown" as const,
      checkedAt: context.now().toISOString(),
      consecutiveFailures: 0,
      message: "Direct URL connector is evaluated per requested article",
    };
  }

  async readArticle(url: string, context: ConnectorContext): Promise<DiscoveredArticle> {
    throwIfAborted(context);
    const parsedUrl = parseWechatArticleUrl(url);
    const page = await this.fetcher.fetch(parsedUrl.url.href, {
      ...(context.signal ? { signal: context.signal } : {}),
    });
    throwIfAborted(context);

    if (page.status === 404) throw new ConnectorError("NOT_FOUND", "WeChat article was not found");
    if (page.status === 429) {
      throw new ConnectorError("RATE_LIMITED", "WeChat temporarily rate-limited this request", {
        retryable: true,
      });
    }
    if (page.status < 200 || page.status >= 300) {
      throw new ConnectorError("SOURCE_UNAVAILABLE", `WeChat returned HTTP ${page.status}`, {
        retryable: page.status >= 500,
      });
    }

    // Redirects must not turn the injected fetcher into an SSRF primitive.
    const finalUrl = parseWechatArticleUrl(page.finalUrl);
    const identity = deriveStableArticleIdentity(finalUrl.url);
    const parsed = await this.parser.parse(page);
    if (!parsed.title.trim()) {
      throw new ConnectorError("PARSE_ERROR", "WeChat page did not contain an article title");
    }

    const now = context.now().toISOString();
    const contentForHash = parsed.contentHtml ?? parsed.summary ?? parsed.title;
    return {
      article: {
        id: identity.id,
        title: parsed.title.trim(),
        canonicalUrl: identity.canonicalUrl,
        contentHash: hashArticleContent(contentForHash),
        createdAt: now,
        updatedAt: now,
        ...(parsed.author?.trim() ? { author: parsed.author.trim() } : {}),
        ...(parsed.summary?.trim() ? { summary: parsed.summary.trim() } : {}),
        ...(parsed.contentHtml !== undefined ? { contentHtml: parsed.contentHtml } : {}),
        ...(parsed.publishedAt ? { publishedAt: parsed.publishedAt } : {}),
        ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
      },
      source: {
        id: createStableId("source", this.id, identity.id, page.finalUrl),
        articleId: identity.id,
        connectorId: this.id,
        connectorKind: this.kind,
        sourceUrl: page.finalUrl,
        discoveredAt: now,
        fetchedAt: now,
        ...(identity.coordinates
          ? {
              externalId: `${identity.coordinates.biz}:${identity.coordinates.mid}:${identity.coordinates.idx}`,
            }
          : {}),
        ...(parsed.publishedAt ? { publishedAt: parsed.publishedAt } : {}),
        ...(parsed.accountName ? { metadata: { accountName: parsed.accountName } } : {}),
      },
    };
  }
}
