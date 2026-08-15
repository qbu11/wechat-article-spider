import type {
  Account,
  Article,
  ArticleSource,
  ConnectorKind,
  SourceHealth,
} from "./domain.js";

export type ConnectorCapability =
  | "account-search"
  | "article-search"
  | "article-read"
  | "article-list"
  | "persistent-sync"
  | "full-content"
  | "authenticated";

export type ConnectorErrorCode =
  | "AUTH_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "RATE_LIMITED"
  | "SOURCE_UNAVAILABLE"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "UNSUPPORTED"
  | "NETWORK_ERROR"
  | "PARSE_ERROR"
  | "ABORTED"
  | (string & {});

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly retryable: boolean;
  readonly retryAfter: Date | undefined;
  readonly needsUserAction: boolean;
  readonly cause: unknown;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      retryAfter?: Date;
      needsUserAction?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.needsUserAction = options.needsUserAction ?? false;
    this.cause = options.cause;
  }
}

export interface ConnectorContext {
  signal?: AbortSignal;
  now: () => Date;
  getSecret?: (key: string) => Promise<string | undefined>;
  reportProgress?: (event: ConnectorProgressEvent) => void;
}

export interface ConnectorProgressEvent {
  phase: "discover" | "fetch" | "parse" | "store";
  completed?: number;
  total?: number;
  message?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface DiscoveredArticle {
  article: Article;
  source: ArticleSource;
}

export interface AccountSearchRequest {
  query: string;
  limit?: number;
  cursor?: string;
}

export interface ArticleSearchRequest {
  query: string;
  accountExternalId?: string;
  limit?: number;
  cursor?: string;
}

export interface ArticleListRequest {
  accountExternalId?: string;
  sourceUrl?: string;
  cursor?: string;
  limit?: number;
}

export interface SourceConnector {
  readonly id: string;
  readonly kind: ConnectorKind;
  readonly capabilities: ReadonlySet<ConnectorCapability>;

  health(context: ConnectorContext): Promise<SourceHealth>;
  searchAccounts?(
    request: AccountSearchRequest,
    context: ConnectorContext,
  ): Promise<Page<Account>>;
  searchArticles?(
    request: ArticleSearchRequest,
    context: ConnectorContext,
  ): Promise<Page<DiscoveredArticle>>;
  readArticle?(url: string, context: ConnectorContext): Promise<DiscoveredArticle>;
  listArticles?(
    request: ArticleListRequest,
    context: ConnectorContext,
  ): Promise<Page<DiscoveredArticle>>;
}

export function assertConnectorCapability(
  connector: SourceConnector,
  capability: ConnectorCapability,
): void {
  if (!connector.capabilities.has(capability)) {
    throw new ConnectorError(
      "UNSUPPORTED",
      `Connector ${connector.id} does not support ${capability}`,
    );
  }
}

export function throwIfAborted(context: ConnectorContext): void {
  if (context.signal?.aborted) {
    throw new ConnectorError("ABORTED", "Connector operation was aborted", {
      cause: context.signal.reason,
    });
  }
}
