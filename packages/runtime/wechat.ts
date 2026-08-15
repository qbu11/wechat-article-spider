import { load } from "cheerio";
import { ConnectorError } from "../core/index.js";
import type { FetchedPage, ParsedWechatPage, WechatPageFetcher, WechatPageParser } from "../connectors/index.js";
import { safeFetchText } from "./http.js";

const WECHAT_HOSTS = new Set(["mp.weixin.qq.com", "weixin.sogou.com"]);

export class DefaultWechatFetcher implements WechatPageFetcher {
  async fetch(url: string, options: { signal?: AbortSignal }): Promise<FetchedPage> {
    const response = await safeFetchText(url, {
      allowedHosts: WECHAT_HOSTS,
      maxBytes: 8 * 1024 * 1024,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      requestedUrl: response.requestedUrl,
      finalUrl: response.finalUrl,
      status: response.status,
      html: response.body,
    };
  }
}

function meta($: ReturnType<typeof load>, selector: string): string | undefined {
  return $(selector).attr("content")?.trim() || undefined;
}

export class DefaultWechatParser implements WechatPageParser {
  parse(page: FetchedPage): ParsedWechatPage {
    const $ = load(page.html);
    const allText = $.root().text().replaceAll(/\s+/g, " ");
    if (/环境异常|访问过于频繁|请输入验证码|操作频繁/.test(allText)) {
      throw new ConnectorError("RATE_LIMITED", "WeChat returned a verification or rate-limit page", {
        retryable: true,
        needsUserAction: /验证码/.test(allText),
      });
    }
    if (/内容已被发布者删除|此内容因违规无法查看|该内容已无法查看/.test(allText)) {
      throw new ConnectorError("NOT_FOUND", "The WeChat article is deleted or unavailable");
    }
    const content = $("#js_content, .rich_media_content, #js_image_desc, #js_video_content, .video_content").first();
    content.find("script,style,noscript").remove();
    content.find("*").each((_, element) => {
      for (const attribute of Object.keys(element.attribs ?? {})) {
        if (attribute.toLowerCase().startsWith("on")) $(element).removeAttr(attribute);
      }
      for (const attribute of ["href", "src"]) {
        const value = $(element).attr(attribute);
        if (value?.trim().toLowerCase().startsWith("javascript:")) $(element).removeAttr(attribute);
      }
    });
    const title = $("#activity-name").first().text().trim() || meta($, 'meta[property="og:title"]') || $("title").text().trim();
    const author = meta($, 'meta[name="author"]') || $("#js_name").first().text().trim() || undefined;
    const summary = meta($, 'meta[name="description"]') || meta($, 'meta[property="og:description"]');
    const accountName = $("#js_name").first().text().trim() || meta($, 'meta[property="og:site_name"]');
    const timestamp = page.html.match(/\bct\s*=\s*["'](\d{9,13})["']/)?.[1];
    const publishedAt = timestamp
      ? new Date(Number(timestamp) * (timestamp.length === 13 ? 1 : 1000)).toISOString()
      : undefined;
    if (!title || content.length === 0) throw new ConnectorError("PARSE_ERROR", "Article title or body was not found");
    const cover = meta($, 'meta[property="og:image"]');
    return {
      title,
      ...(author ? { author } : {}),
      ...(summary ? { summary } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(content.html() ? { contentHtml: content.html()! } : {}),
      ...(accountName ? { accountName } : {}),
      metadata: {
        ...(cover ? { cover } : {}),
        untrustedContent: true,
      },
    };
  }
}
