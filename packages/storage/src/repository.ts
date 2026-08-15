import type {
  Account,
  AccountId,
  Article,
  ArticleId,
  ArticleSearchQuery,
  ArticleSearchResult,
  ArticleSource,
  SourceHealth,
  Subscription,
  SubscriptionId,
  SyncRun,
  SyncRunId,
} from "../../core/src/index.js";

export interface AccountRepository {
  upsertAccount(account: Account): Promise<Account>;
  getAccount(id: AccountId): Promise<Account | undefined>;
  findAccountByIdentity(connectorId: string, externalId: string): Promise<Account | undefined>;
  listAccounts(): Promise<Account[]>;
}

export interface ArticleRepository {
  upsertArticle(article: Article): Promise<Article>;
  getArticle(id: ArticleId): Promise<Article | undefined>;
  upsertArticleSource(source: ArticleSource): Promise<ArticleSource>;
  listArticleSources(articleId: ArticleId): Promise<ArticleSource[]>;
  searchArticles(query: ArticleSearchQuery): Promise<ArticleSearchResult[]>;
}

export interface SubscriptionRepository {
  upsertSubscription(subscription: Subscription): Promise<Subscription>;
  getSubscription(id: SubscriptionId): Promise<Subscription | undefined>;
  listSubscriptions(options?: { activeOnly?: boolean }): Promise<Subscription[]>;
  deleteSubscription(id: SubscriptionId): Promise<boolean>;
}

export interface SyncRepository {
  upsertSyncRun(run: SyncRun): Promise<SyncRun>;
  getSyncRun(id: SyncRunId): Promise<SyncRun | undefined>;
  listSyncRuns(options?: {
    connectorId?: string;
    subscriptionId?: SubscriptionId;
    limit?: number;
  }): Promise<SyncRun[]>;
  setSourceHealth(health: SourceHealth): Promise<SourceHealth>;
  getSourceHealth(connectorId: string): Promise<SourceHealth | undefined>;
  listSourceHealth(): Promise<SourceHealth[]>;
}

export interface RepositoryTransaction {
  readonly accounts: AccountRepository;
  readonly articles: ArticleRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly sync: SyncRepository;
}

export interface WechatRepository extends RepositoryTransaction {
  transaction<T>(work: (repositories: RepositoryTransaction) => Promise<T>): Promise<T>;
}
