import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConnectorError } from "../core/index.js";

const KEY_BYTES = 32;
const METADATA_KEY = "encryptedSourceUrl";
const CREDENTIAL_QUERY_KEYS = new Set([
  "access_token",
  "apikey",
  "api_key",
  "auth",
  "key",
  "secret",
  "sig",
  "signature",
  "token",
]);

function isCredentialQueryKey(key: string): boolean {
  const normalized = key.toLocaleLowerCase();
  return CREDENTIAL_QUERY_KEYS.has(normalized) ||
    /(?:^|[_-])(?:credential|jwt|pass(?:word)?|secret|sig(?:nature)?|token)(?:$|[_-])/u.test(normalized);
}

function encoded(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decoded(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function normalizeHttpsFeedUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch (cause) {
    throw new ConnectorError("INVALID_INPUT", "Invalid feed URL", { cause });
  }
  if (url.protocol !== "https:") {
    throw new ConnectorError("INVALID_INPUT", "Feed subscriptions require an HTTPS URL");
  }
  if (url.username || url.password) {
    throw new ConnectorError("INVALID_INPUT", "Feed URLs with embedded credentials are not allowed");
  }
  url.hash = "";
  return url;
}

export function publicFeedUrl(input: string): string {
  const url = normalizeHttpsFeedUrl(input);
  url.search = "";
  return url.href;
}

export function feedIdentityUrl(input: string): string {
  const url = normalizeHttpsFeedUrl(input);
  const retained = [...url.searchParams.entries()]
    .filter(([key]) => !isCredentialQueryKey(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  url.search = "";
  for (const [key, value] of retained) url.searchParams.append(key, value);
  return url.href;
}

export function protectFeedUrl(
  input: string,
  key: Uint8Array | undefined,
): { normalizedUrl: string; publicUrl: string; identityUrl: string; encryptedUrl?: string } {
  const url = normalizeHttpsFeedUrl(input);
  const normalizedUrl = url.href;
  const publicUrl = publicFeedUrl(normalizedUrl);
  const identityUrl = feedIdentityUrl(normalizedUrl);
  if (!url.search) return { normalizedUrl, publicUrl, identityUrl };
  if (!key || key.byteLength !== KEY_BYTES) {
    throw new ConnectorError(
      "INVALID_INPUT",
      "Feed URLs containing query parameters require encrypted runtime storage",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalizedUrl, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { normalizedUrl, publicUrl, identityUrl, encryptedUrl: `v1.${encoded(iv)}.${encoded(tag)}.${encoded(ciphertext)}` };
}

export function revealFeedUrl(
  subscription: { sourceUrl?: string; metadata?: Record<string, unknown> },
  key: Uint8Array | undefined,
): string | undefined {
  const encrypted = subscription.metadata?.[METADATA_KEY];
  if (typeof encrypted !== "string") return subscription.sourceUrl;
  if (!key || key.byteLength !== KEY_BYTES) {
    throw new ConnectorError("AUTH_REQUIRED", "The local feed URL encryption key is unavailable", {
      needsUserAction: true,
    });
  }
  try {
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unsupported ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", key, decoded(iv));
    decipher.setAuthTag(decoded(tag));
    return Buffer.concat([decipher.update(decoded(ciphertext)), decipher.final()]).toString("utf8");
  } catch (cause) {
    throw new ConnectorError("AUTH_REQUIRED", "The stored feed URL could not be decrypted", {
      needsUserAction: true,
      cause,
    });
  }
}

export function feedUrlMetadata(encryptedUrl: string | undefined): Record<string, unknown> {
  return encryptedUrl ? { [METADATA_KEY]: encryptedUrl, sourceUrlStorage: "aes-256-gcm" } : {};
}

export function redactSubscription<T extends { sourceUrl?: string; metadata?: Record<string, unknown> }>(item: T): T {
  const metadata = { ...item.metadata };
  delete metadata[METADATA_KEY];
  return {
    ...item,
    ...(item.sourceUrl ? { sourceUrl: publicFeedUrl(item.sourceUrl) } : {}),
    metadata,
  };
}

export async function loadFeedUrlSecretKey(dataRoot: string): Promise<Buffer> {
  const path = join(dataRoot, "feed-url.key");
  try {
    const existing = await readFile(path);
    if (existing.byteLength !== KEY_BYTES) throw new Error("Invalid feed URL key length");
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const key = randomBytes(KEY_BYTES);
  try {
    await writeFile(path, key, { mode: 0o600, flag: "wx" });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(path);
    if (existing.byteLength !== KEY_BYTES) throw new Error("Invalid feed URL key length");
    return existing;
  }
}
