import { XMLParser } from "fast-xml-parser";
import type { FeedFormat, FeedReader, ParsedFeed, ParsedFeedItem } from "../connectors/index.js";
import { safeFetchText } from "./http.js";

function compact<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return value;
}

function array<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return text(record["#text"] ?? record["__cdata"]);
  }
  return undefined;
}

function isoDate(value: unknown): string | undefined {
  const input = text(value)?.trim();
  if (!input) return undefined;
  const parsed = new Date(input);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function rssItem(item: Record<string, unknown>): ParsedFeedItem | undefined {
  const url = text(item.link) ?? text(item.guid);
  const title = text(item.title);
  if (!url || !title) return undefined;
  return compact({
    id: text(item.guid),
    url,
    title,
    author: text(item.author ?? item["dc:creator"]),
    summary: text(item.description),
    contentHtml: text(item["content:encoded"]),
    publishedAt: isoDate(item.pubDate),
  }) as ParsedFeedItem;
}

function atomLink(value: unknown): string | undefined {
  for (const candidate of array(value as Record<string, unknown> | Record<string, unknown>[])) {
    const href = candidate?.["@_href"];
    const rel = candidate?.["@_rel"];
    if (typeof href === "string" && (!rel || rel === "alternate")) return href;
  }
  return text(value);
}

function atomItem(item: Record<string, unknown>): ParsedFeedItem | undefined {
  const url = atomLink(item.link) ?? text(item.id);
  const title = text(item.title);
  if (!url || !title) return undefined;
  return compact({
    id: text(item.id),
    url,
    title,
    author: text((item.author as Record<string, unknown> | undefined)?.name),
    summary: text(item.summary),
    contentHtml: text(item.content),
    publishedAt: isoDate(item.published ?? item.updated),
    modifiedAt: isoDate(item.updated),
  }) as ParsedFeedItem;
}

export class DefaultFeedReader implements FeedReader {
  async read(url: string, options: { cursor?: string; limit?: number; signal?: AbortSignal }): Promise<ParsedFeed> {
    const response = await safeFetchText(url, { maxBytes: 8 * 1024 * 1024, ...(options.signal ? { signal: options.signal } : {}) });
    if (response.status < 200 || response.status >= 300) throw new Error(`Feed returned HTTP ${response.status}`);
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    return parseFeedDocument(response.body, response.contentType, response.finalUrl, limit);
  }
}

export function parseFeedDocument(body: string, contentType: string, finalUrl: string, limit = 50): ParsedFeed {
    if (contentType.includes("json") || body.trimStart().startsWith("{")) {
      const value = JSON.parse(body) as Record<string, unknown>;
      const items = array(value.items as Record<string, unknown>[]).map((item) => compact({
        id: text(item.id),
        url: text(item.url ?? item.external_url) ?? "",
        title: text(item.title) ?? "",
        author: text((array(item.authors as Record<string, unknown>[])[0] ?? {})["name"]),
        summary: text(item.summary),
        contentHtml: text(item.content_html),
        contentText: text(item.content_text),
        publishedAt: isoDate(item.date_published),
        modifiedAt: isoDate(item.date_modified),
      }) as ParsedFeedItem).filter((item) => item.url && item.title).slice(0, limit);
      const title = text(value.title);
      return { format: "json-feed", url: finalUrl, items, ...(title ? { title } : {}) };
    }
    const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: "__cdata", trimValues: true });
    const value = parser.parse(body) as Record<string, unknown>;
    const rss = value.rss as Record<string, unknown> | undefined;
    if (rss) {
      const channel = rss.channel as Record<string, unknown>;
      const items = array(channel.item as Record<string, unknown>[]).map(rssItem).filter((item): item is ParsedFeedItem => Boolean(item)).slice(0, limit);
      const title = text(channel.title);
      return { format: "rss", url: finalUrl, items, ...(title ? { title } : {}) };
    }
    const feed = value.feed as Record<string, unknown> | undefined;
    if (feed) {
      const items = array(feed.entry as Record<string, unknown>[]).map(atomItem).filter((item): item is ParsedFeedItem => Boolean(item)).slice(0, limit);
      const title = text(feed.title);
      return { format: "atom", url: finalUrl, items, ...(title ? { title } : {}) };
    }
    throw new Error("Source is not RSS, Atom, or JSON Feed.");
}

export async function detectFeedFormat(url: string, reader = new DefaultFeedReader()): Promise<FeedFormat> {
  return (await reader.read(url, { limit: 1 })).format;
}
