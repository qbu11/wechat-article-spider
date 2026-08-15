/**
 * Dependency-free JSON Schema documents for persistence boundaries, CLI input
 * validation, and generated documentation. Runtime adapters may compile these
 * with Ajv or another JSON Schema 2020-12 implementation.
 */
const id = { type: "string", minLength: 1 } as const;
const isoDateTime = { type: "string", format: "date-time" } as const;
const metadata = { type: "object", additionalProperties: true } as const;

export const accountSchema = {
  $id: "https://wechat-agent.local/schemas/account.json",
  type: "object",
  additionalProperties: false,
  required: ["id", "displayName", "identities", "createdAt", "updatedAt"],
  properties: {
    id,
    displayName: id,
    description: { type: "string" },
    avatarUrl: { type: "string", format: "uri" },
    identities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["connectorId", "externalId"],
        properties: {
          connectorId: id,
          externalId: id,
          kind: {
            enum: ["wechat-biz", "wechat-fakeid", "feed-url", "handle", "other"],
          },
        },
      },
    },
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    metadata,
  },
} as const;

export const articleSchema = {
  $id: "https://wechat-agent.local/schemas/article.json",
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "canonicalUrl", "createdAt", "updatedAt"],
  properties: {
    id,
    accountId: id,
    title: { type: "string" },
    author: { type: "string" },
    summary: { type: "string" },
    contentHtml: { type: "string" },
    contentMarkdown: { type: "string" },
    publishedAt: isoDateTime,
    canonicalUrl: { type: "string", format: "uri" },
    contentHash: { type: "string" },
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    metadata,
  },
} as const;

export const articleSourceSchema = {
  $id: "https://wechat-agent.local/schemas/article-source.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "articleId",
    "connectorId",
    "connectorKind",
    "sourceUrl",
    "discoveredAt",
  ],
  properties: {
    id,
    articleId: id,
    connectorId: id,
    connectorKind: id,
    externalId: id,
    sourceUrl: { type: "string", format: "uri" },
    discoveredAt: isoDateTime,
    fetchedAt: isoDateTime,
    publishedAt: isoDateTime,
    metadata,
  },
} as const;

export const subscriptionSchema = {
  $id: "https://wechat-agent.local/schemas/subscription.json",
  type: "object",
  additionalProperties: false,
  required: ["id", "connectorId", "state", "createdAt", "updatedAt"],
  properties: {
    id,
    accountId: id,
    connectorId: id,
    externalAccountId: id,
    sourceUrl: { type: "string", format: "uri" },
    label: { type: "string" },
    state: { enum: ["active", "paused", "needs-user-action", "disabled"] },
    cursor: { type: "string" },
    schedule: {
      type: "object",
      additionalProperties: false,
      required: ["intervalMinutes"],
      properties: {
        intervalMinutes: { type: "integer", minimum: 1 },
        jitterMinutes: { type: "integer", minimum: 0 },
      },
    },
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    lastSyncedAt: isoDateTime,
    metadata,
  },
} as const;

export const syncRunSchema = {
  $id: "https://wechat-agent.local/schemas/sync-run.json",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "connectorId",
    "status",
    "startedAt",
    "articlesDiscovered",
    "articlesStored",
  ],
  properties: {
    id,
    connectorId: id,
    subscriptionId: id,
    status: {
      enum: [
        "queued",
        "running",
        "succeeded",
        "partially-succeeded",
        "failed",
        "cancelled",
        "needs-user-action",
      ],
    },
    startedAt: isoDateTime,
    completedAt: isoDateTime,
    cursorBefore: { type: "string" },
    cursorAfter: { type: "string" },
    articlesDiscovered: { type: "integer", minimum: 0 },
    articlesStored: { type: "integer", minimum: 0 },
    errorCode: { type: "string" },
    errorMessage: { type: "string" },
    metadata,
  },
} as const;

export const sourceHealthSchema = {
  $id: "https://wechat-agent.local/schemas/source-health.json",
  type: "object",
  additionalProperties: false,
  required: ["connectorId", "state", "checkedAt", "consecutiveFailures"],
  properties: {
    connectorId: id,
    state: {
      enum: ["healthy", "degraded", "unavailable", "needs-user-action", "unknown"],
    },
    checkedAt: isoDateTime,
    consecutiveFailures: { type: "integer", minimum: 0 },
    retryAfter: isoDateTime,
    reasonCode: { type: "string" },
    message: { type: "string" },
    latencyMs: { type: "number", minimum: 0 },
    metadata,
  },
} as const;

export const domainSchemas = {
  account: accountSchema,
  article: articleSchema,
  articleSource: articleSourceSchema,
  subscription: subscriptionSchema,
  syncRun: syncRunSchema,
  sourceHealth: sourceHealthSchema,
} as const;
