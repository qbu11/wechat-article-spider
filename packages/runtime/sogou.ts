import { load } from "cheerio";
import { ConnectorError, createStableId, type Article, type ArticleSource } from "../core/index.js";
import { safeFetchText } from "./http.js";

export interface SogouResult {
  article: Article;
  source: ArticleSource;
}

function normalizeIdentityPart(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().normalize("NFC").toLocaleLowerCase();
}

/** Parse Sogou markup without making a network request. */
export function parseSogouResults(
  html: string,
  options: { limit?: number; now?: Date } = {},
): SogouResult[] {
  const $ = load(html);
  const now = (options.now ?? new Date()).toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const results: SogouResult[] = [];
  $("ul.news-list li").each((_, element) => {
    if (results.length >= limit) return;
    const anchor = $(element).find(".txt-box h3 a").first();
    const href = anchor.attr("href");
    const title = anchor.text().replaceAll(/\s+/g, " ").trim();
    if (!href || !title) return;
    const parsedSourceUrl = new URL(href, "https://weixin.sogou.com");
    if (parsedSourceUrl.protocol !== "https:" || parsedSourceUrl.username || parsedSourceUrl.password) return;
    const sourceHost = parsedSourceUrl.hostname.toLocaleLowerCase();
    const allowedSogouRedirect = sourceHost === "weixin.sogou.com";
    const allowedDirectWechat = sourceHost === "mp.weixin.qq.com" &&
      (parsedSourceUrl.pathname === "/s" || parsedSourceUrl.pathname.startsWith("/s/"));
    if (!allowedSogouRedirect && !allowedDirectWechat) return;
    const sourceUrl = parsedSourceUrl.href;
    const accountName = $(element).find(".s-p .all-time-y2, .account").first().text().trim();
    const summary = $(element).find(".txt-info").first().text().replaceAll(/\s+/g, " ").trim();
    const publication = $(element).find("time, .s-p .s2, .s-p .time, .s2").first();
    const rawPublication = [
      publication.attr("datetime"),
      publication.attr("data-time"),
      publication.text(),
      publication.html(),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ");
    const unixTimestamp = rawPublication.match(/timeConvert\(\s*['\"]?(\d{8,})/i)?.[1];
    const explicitPublication = unixTimestamp ?? publication.attr("datetime") ?? publication.attr("data-time") ?? "";
    const publicationHint = normalizeIdentityPart(explicitPublication);
    const publicationNumber = Number(explicitPublication);
    const publishedAt = explicitPublication
      ? new Date(
          Number.isFinite(publicationNumber) && /^\d+$/.test(explicitPublication)
            ? publicationNumber * (explicitPublication.length >= 13 ? 1 : 1000)
            : explicitPublication,
        )
      : undefined;
    const publishedAtIso = publishedAt && !Number.isNaN(publishedAt.valueOf()) ? publishedAt.toISOString() : undefined;
    const stableParts = [
      normalizeIdentityPart(accountName),
      normalizeIdentityPart(title),
      publicationHint || normalizeIdentityPart(summary),
    ];
    const id = createStableId("article", "sogou", ...stableParts);
    results.push({
      article: {
        id,
        title,
        ...(summary ? { summary } : {}),
        canonicalUrl: sourceUrl,
        ...(publishedAtIso ? { publishedAt: publishedAtIso } : {}),
        createdAt: now,
        updatedAt: now,
        metadata: {
          accountName,
          discoveryOnly: true,
          ...(publicationHint ? { publicationHint } : {}),
        },
      },
      source: {
        id: createStableId("source", "sogou", ...stableParts),
        articleId: id,
        connectorId: "sogou",
        connectorKind: "sogou",
        sourceUrl,
        discoveredAt: now,
        ...(publishedAtIso ? { publishedAt: publishedAtIso } : {}),
        metadata: { accountName, ...(publicationHint ? { publicationHint } : {}) },
      },
    });
  });
  return results;
}

export async function searchSogou(query: string, limit = 10): Promise<SogouResult[]> {
  const url = new URL("https://weixin.sogou.com/weixin");
  url.searchParams.set("type", "2");
  url.searchParams.set("query", query);
  url.searchParams.set("ie", "utf8");
  const response = await safeFetchText(url.href, { allowedHosts: new Set(["weixin.sogou.com"]), maxBytes: 3 * 1024 * 1024 });
  if (response.status !== 200) {
    throw new ConnectorError("SOURCE_UNAVAILABLE", `Sogou WeChat search returned HTTP ${response.status}`, {
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  if (/请输入验证码|antispider|访问过于频繁/.test(response.body)) {
    throw new ConnectorError("CAPTCHA_REQUIRED", "Sogou requires browser verification. Complete the captcha manually and retry later.", {
      retryable: true,
      needsUserAction: true,
    });
  }
  return parseSogouResults(response.body, { limit });
}
