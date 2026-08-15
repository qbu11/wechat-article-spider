export type AccountId = string;
export type ArticleId = string;
export type ArticleSourceId = string;
export type SubscriptionId = string;
export type SyncRunId = string;

export type ConnectorKind =
  | "direct-wechat"
  | "sogou"
  | "weread"
  | "mp-console-legacy"
  | "rss"
  | "atom"
  | "json-feed"
  | "official-own-account"
  | (string & {});

export type IsoDateTime = string;

export interface AccountIdentity {
  connectorId: string;
  externalId: string;
  kind?: "wechat-biz" | "wechat-fakeid" | "feed-url" | "handle" | "other";
}

export interface Account {
  id: AccountId;
  displayName: string;
  description?: string;
  avatarUrl?: string;
  identities: AccountIdentity[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  metadata?: Record<string, unknown>;
}

export interface Article {
  id: ArticleId;
  accountId?: AccountId;
  title: string;
  author?: string;
  summary?: string;
  contentHtml?: string;
  contentMarkdown?: string;
  publishedAt?: IsoDateTime;
  canonicalUrl: string;
  contentHash?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  metadata?: Record<string, unknown>;
}

export interface ArticleSource {
  id: ArticleSourceId;
  articleId: ArticleId;
  connectorId: string;
  connectorKind: ConnectorKind;
  externalId?: string;
  sourceUrl: string;
  discoveredAt: IsoDateTime;
  fetchedAt?: IsoDateTime;
  publishedAt?: IsoDateTime;
  metadata?: Record<string, unknown>;
}

export interface Subscription {
  id: SubscriptionId;
  accountId?: AccountId;
  connectorId: string;
  externalAccountId?: string;
  sourceUrl?: string;
  label?: string;
  state: "active" | "paused" | "needs-user-action" | "disabled";
  cursor?: string;
  schedule?: {
    intervalMinutes: number;
    jitterMinutes?: number;
  };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastSyncedAt?: IsoDateTime;
  metadata?: Record<string, unknown>;
}

export type SyncRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partially-succeeded"
  | "failed"
  | "cancelled"
  | "needs-user-action";

export interface SyncRun {
  id: SyncRunId;
  connectorId: string;
  subscriptionId?: SubscriptionId;
  status: SyncRunStatus;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  cursorBefore?: string;
  cursorAfter?: string;
  articlesDiscovered: number;
  articlesStored: number;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export type SourceHealthState =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "needs-user-action"
  | "unknown";

export interface SourceHealth {
  connectorId: string;
  state: SourceHealthState;
  checkedAt: IsoDateTime;
  consecutiveFailures: number;
  retryAfter?: IsoDateTime;
  reasonCode?: string;
  message?: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ArticleSearchQuery {
  text?: string;
  accountId?: AccountId;
  connectorId?: string;
  publishedAfter?: IsoDateTime;
  publishedBefore?: IsoDateTime;
  limit?: number;
  offset?: number;
}

export interface ArticleSearchResult {
  article: Article;
  sources: ArticleSource[];
  score?: number;
}
