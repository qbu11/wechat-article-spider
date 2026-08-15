import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_LIMIT = 5 * 1024 * 1024;

export interface SafeFetchOptions {
  allowedHosts?: ReadonlySet<string>;
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  allowHttp?: boolean;
  signal?: AbortSignal;
  lookupAddresses?: (hostname: string) => Promise<readonly { address: string }[]>;
}

export interface SafeResponse {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLocaleLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const firstHextet = normalized.match(/^([0-9a-f]{1,4})(?::|$)/u)?.[1];
  if (firstHextet && (Number.parseInt(firstHextet, 16) & 0xffc0) === 0xfe80) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  if (normalized.startsWith("::ffff:") && !mapped) {
    const hexadecimal = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
    if (hexadecimal) {
      const high = Number.parseInt(hexadecimal[1]!, 16);
      const low = Number.parseInt(hexadecimal[2]!, 16);
      return isPrivateAddress(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
    }
  }
  const parts = (mapped ?? normalized).split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function validateUrl(url: URL, options: SafeFetchOptions): Promise<void> {
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed.");
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    throw new Error("Only HTTPS sources are allowed.");
  }
  const host = url.hostname.toLowerCase();
  if (options.allowedHosts && !options.allowedHosts.has(host)) {
    throw new Error(`Host is not allowed: ${host}`);
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local network hosts are not allowed.");
  }
  if (isIP(host) && isPrivateAddress(host)) throw new Error("Private network addresses are not allowed.");
  const addresses = options.lookupAddresses
    ? await options.lookupAddresses(host)
    : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new Error("Source resolves to a private or unavailable network address.");
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds the ${maxBytes} byte limit.`);
    }
    text += decoder.decode(result.value, { stream: true });
  }
  return text + decoder.decode();
}

export async function safeFetchText(input: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const requestedUrl = new URL(input).href;
  let current = new URL(requestedUrl);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await validateUrl(current, options);
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        "user-agent": "wechat-agent-kit/0.2 (+https://github.com/qbu11/wechat-article-spider)",
        accept: "text/html,application/rss+xml,application/atom+xml,application/feed+json,application/json;q=0.9,*/*;q=0.5",
        ...options.headers,
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} did not include a location.`);
      current = new URL(location, current);
      continue;
    }
    return {
      requestedUrl,
      finalUrl: current.href,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await readLimited(response, options.maxBytes ?? DEFAULT_LIMIT),
    };
  }
  throw new Error("Too many redirects.");
}
