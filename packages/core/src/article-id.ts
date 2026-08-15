import { createHash } from "node:crypto";

export interface WechatArticleCoordinates {
  biz: string;
  mid: string;
  idx: string;
}

export interface StableArticleIdentity {
  id: string;
  canonicalUrl: string;
  strategy: "wechat-coordinates" | "canonical-url";
  coordinates?: WechatArticleCoordinates;
}

const TRACKING_PARAMETERS = new Set([
  "chksm",
  "clicktime",
  "enterid",
  "from",
  "isappinstalled",
  "scene",
  "sessionid",
  "subscene",
  "version",
]);

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createStableId(prefix: string, ...parts: string[]): string {
  if (!/^[a-z][a-z0-9-]*$/u.test(prefix)) {
    throw new TypeError("Stable ID prefix must start with a lowercase letter and contain only a-z, 0-9, or '-'");
  }
  return `${prefix}_${digest(parts.join("\u0000"))}`;
}

export function normalizeUrl(input: string | URL): URL {
  const url = input instanceof URL ? new URL(input.href) : new URL(input);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  const isWechatArticle = url.hostname === "mp.weixin.qq.com";
  for (const key of [...url.searchParams.keys()]) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.startsWith("utm_") ||
      (isWechatArticle && TRACKING_PARAMETERS.has(lowerKey))
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url;
}

export function extractWechatArticleCoordinates(
  input: string | URL,
): WechatArticleCoordinates | undefined {
  const url = input instanceof URL ? input : new URL(input);
  if (url.hostname.toLowerCase() !== "mp.weixin.qq.com") return undefined;

  const biz = url.searchParams.get("__biz")?.trim();
  const mid = url.searchParams.get("mid")?.trim();
  const idx = url.searchParams.get("idx")?.trim();
  if (!biz || !mid || !idx) return undefined;
  return { biz, mid, idx };
}

export function deriveStableArticleIdentity(input: string | URL): StableArticleIdentity {
  const normalized = normalizeUrl(input);
  const coordinates = extractWechatArticleCoordinates(normalized);

  if (coordinates) {
    const coordinateKey = `${coordinates.biz}\u0000${coordinates.mid}\u0000${coordinates.idx}`;
    const canonical = new URL("https://mp.weixin.qq.com/s");
    canonical.searchParams.set("__biz", coordinates.biz);
    canonical.searchParams.set("mid", coordinates.mid);
    canonical.searchParams.set("idx", coordinates.idx);
    return {
      id: createStableId("wx", coordinateKey),
      canonicalUrl: canonical.href,
      strategy: "wechat-coordinates",
      coordinates,
    };
  }

  return {
    id: createStableId("url", normalized.href),
    canonicalUrl: normalized.href,
    strategy: "canonical-url",
  };
}

export function hashArticleContent(content: string): string {
  return `sha256:${digest(content.normalize("NFC"))}`;
}
