import {
  ConnectorError,
  createStableId,
  deriveStableArticleIdentity,
  hashArticleContent,
  normalizeUrl,
  throwIfAborted,
  type ArticleListRequest,
  type ConnectorContext,
  type DiscoveredArticle,
  type Page,
  type SourceConnector,
} from "../../core/src/index.js";

export type FeedFormat = "rss" | "atom" | "json-feed";

export interface ParsedFeedItem {
  id?: string;
  url: string;
  title: string;
  author?: string;
  summary?: string;
  contentHtml?: string;
  contentText?: string;
  publishedAt?: string;
  modifiedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedFeed {
  format: FeedFormat;
  url: string;
  title?: string;
  items: ParsedFeedItem[];
  nextCursor?: string;
}

export interface FeedReader {
  read(
    url: string,
    options: { cursor?: string; limit?: number; signal?: AbortSignal },
  ): Promise<ParsedFeed>;
}

export function mapFeedItem(
  feed: Pick<ParsedFeed, "format" | "url" | "title">,
  item: ParsedFeedItem,
  connectorId: string,
  now: Date,
): DiscoveredArticle {
  let parsedItemUrl: URL;
  try {
    parsedItemUrl = new URL(item.url);
  } catch (cause) {
    throw new ConnectorError("PARSE_ERROR", "Feed item has an invalid URL", { cause });
  }
  if (parsedItemUrl.protocol !== "https:") {
    throw new ConnectorError("PARSE_ERROR", "Feed item URL must use HTTPS");
  }
  if (parsedItemUrl.username || parsedItemUrl.password) {
    throw new ConnectorError("PARSE_ERROR", "Feed item URL must not contain embedded credentials");
  }
  let identity;
  try {
    identity = deriveStableArticleIdentity(parsedItemUrl);
  } catch (cause) {
    throw new ConnectorError("PARSE_ERROR", "Feed item has an invalid URL", { cause });
  }

  const title = item.title.trim();
  if (!title) throw new ConnectorError("PARSE_ERROR", "Feed item has no title");
  const timestamp = now.toISOString();
  const sourceUrl = normalizeUrl(item.url).href;
  const contentHtml = item.contentHtml?.trim() ? item.contentHtml : undefined;
  const contentMarkdown = item.contentText?.trim() ? item.contentText : undefined;
  const content = contentHtml ?? contentMarkdown ?? item.summary?.trim() ?? title;

  return {
    article: {
      id: identity.id,
      title,
      canonicalUrl: identity.canonicalUrl,
      contentHash: hashArticleContent(content),
      createdAt: timestamp,
      updatedAt: item.modifiedAt ?? timestamp,
      ...(item.author?.trim() ? { author: item.author.trim() } : {}),
      ...(item.summary?.trim() ? { summary: item.summary.trim() } : {}),
      ...(contentHtml ? { contentHtml } : {}),
      ...(contentMarkdown ? { contentMarkdown } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      ...(item.metadata ? { metadata: item.metadata } : {}),
    },
    source: {
      id: createStableId("source", connectorId, feed.url, item.id ?? sourceUrl),
      articleId: identity.id,
      connectorId,
      connectorKind: feed.format,
      sourceUrl,
      discoveredAt: timestamp,
      ...(item.id ? { externalId: item.id } : {}),
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
      ...(feed.title ? { metadata: { feedTitle: feed.title } } : {}),
    },
  };
}

export class FeedConnector implements SourceConnector {
  readonly id: string;
  readonly kind: FeedFormat;
  readonly capabilities = new Set(["article-list", "persistent-sync"] as const);

  constructor(
    private readonly sourceUrl: string,
    private readonly format: FeedFormat,
    private readonly reader: FeedReader,
    options: { id?: string } = {},
  ) {
    this.id = options.id ?? `feed-${createStableId("source", sourceUrl).slice(-12)}`;
    this.kind = format;
  }

  async health(context: ConnectorContext) {
    return {
      connectorId: this.id,
      state: "unknown" as const,
      checkedAt: context.now().toISOString(),
      consecutiveFailures: 0,
      message: "Feed health is evaluated during synchronization",
    };
  }

  async listArticles(
    request: ArticleListRequest,
    context: ConnectorContext,
  ): Promise<Page<DiscoveredArticle>> {
    throwIfAborted(context);
    const requestedUrl = request.sourceUrl ?? this.sourceUrl;
    if (requestedUrl !== this.sourceUrl) {
      throw new ConnectorError("INVALID_INPUT", "Feed connector source URL cannot be overridden");
    }
    const feed = await this.reader.read(this.sourceUrl, {
      ...(request.cursor ? { cursor: request.cursor } : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    throwIfAborted(context);
    if (feed.format !== this.format) {
      throw new ConnectorError(
        "PARSE_ERROR",
        `Expected ${this.format} but reader returned ${feed.format}`,
      );
    }
    return {
      items: feed.items.map((item) => mapFeedItem(feed, item, this.id, context.now())),
      ...(feed.nextCursor ? { nextCursor: feed.nextCursor } : {}),
    };
  }
}
