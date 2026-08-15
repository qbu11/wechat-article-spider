import type {
  Account,
  Article,
  ArticleSearchQuery,
  ArticleSearchResult,
  ArticleSource,
  SourceHealth,
  Subscription,
  SyncRun,
} from "../../core/src/index.js";
import type {
  AccountRepository,
  ArticleRepository,
  RepositoryTransaction,
  SubscriptionRepository,
  SyncRepository,
  WechatRepository,
} from "./repository.js";

interface MemoryState {
  accounts: Map<string, Account>;
  articles: Map<string, Article>;
  articleSources: Map<string, ArticleSource>;
  subscriptions: Map<string, Subscription>;
  syncRuns: Map<string, SyncRun>;
  sourceHealth: Map<string, SourceHealth>;
}

function emptyState(): MemoryState {
  return {
    accounts: new Map(),
    articles: new Map(),
    articleSources: new Map(),
    subscriptions: new Map(),
    syncRuns: new Map(),
    sourceHealth: new Map(),
  };
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function compareOptionalDateDescending(a?: string, b?: string): number {
  return (b ?? "").localeCompare(a ?? "");
}

export class MemoryWechatRepository implements WechatRepository {
  private state: MemoryState;
  private transactionTail: Promise<unknown> = Promise.resolve();

  readonly accounts: AccountRepository;
  readonly articles: ArticleRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly sync: SyncRepository;

  constructor(seed?: Partial<{ accounts: Account[]; articles: Article[] }>) {
    this.state = emptyState();
    for (const account of seed?.accounts ?? []) this.state.accounts.set(account.id, copy(account));
    for (const article of seed?.articles ?? []) this.state.articles.set(article.id, copy(article));

    this.accounts = {
      upsertAccount: async (account) => {
        this.state.accounts.set(account.id, copy(account));
        return copy(account);
      },
      getAccount: async (id) => copy(this.state.accounts.get(id)),
      findAccountByIdentity: async (connectorId, externalId) => {
        const found = [...this.state.accounts.values()].find((account) =>
          account.identities.some(
            (identity) =>
              identity.connectorId === connectorId && identity.externalId === externalId,
          ),
        );
        return copy(found);
      },
      listAccounts: async () =>
        copy([...this.state.accounts.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))),
    };

    this.articles = {
      upsertArticle: async (article) => {
        this.state.articles.set(article.id, copy(article));
        return copy(article);
      },
      getArticle: async (id) => copy(this.state.articles.get(id)),
      upsertArticleSource: async (source) => {
        if (!this.state.articles.has(source.articleId)) {
          throw new Error(`Cannot attach source ${source.id}: article ${source.articleId} does not exist`);
        }
        this.state.articleSources.set(source.id, copy(source));
        return copy(source);
      },
      listArticleSources: async (articleId) =>
        copy(
          [...this.state.articleSources.values()]
            .filter((source) => source.articleId === articleId)
            .sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt)),
        ),
      searchArticles: async (query) => this.searchArticles(query),
    };

    this.subscriptions = {
      upsertSubscription: async (subscription) => {
        this.state.subscriptions.set(subscription.id, copy(subscription));
        return copy(subscription);
      },
      getSubscription: async (id) => copy(this.state.subscriptions.get(id)),
      listSubscriptions: async (options) =>
        copy(
          [...this.state.subscriptions.values()]
            .filter((item) => !options?.activeOnly || item.state === "active")
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        ),
      deleteSubscription: async (id) => this.state.subscriptions.delete(id),
    };

    this.sync = {
      upsertSyncRun: async (run) => {
        this.state.syncRuns.set(run.id, copy(run));
        return copy(run);
      },
      getSyncRun: async (id) => copy(this.state.syncRuns.get(id)),
      listSyncRuns: async (options) => {
        const limit = Math.max(0, options?.limit ?? 100);
        return copy(
          [...this.state.syncRuns.values()]
            .filter(
              (run) =>
                (!options?.connectorId || run.connectorId === options.connectorId) &&
                (!options?.subscriptionId || run.subscriptionId === options.subscriptionId),
            )
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .slice(0, limit),
        );
      },
      setSourceHealth: async (health) => {
        this.state.sourceHealth.set(health.connectorId, copy(health));
        return copy(health);
      },
      getSourceHealth: async (connectorId) => copy(this.state.sourceHealth.get(connectorId)),
      listSourceHealth: async () =>
        copy(
          [...this.state.sourceHealth.values()].sort((a, b) =>
            a.connectorId.localeCompare(b.connectorId),
          ),
        ),
    };
  }

  async transaction<T>(work: (repositories: RepositoryTransaction) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const snapshot = copy(this.state);
    try {
      return await work(this);
    } catch (error) {
      this.state = snapshot;
      throw error;
    } finally {
      release();
    }
  }

  private async searchArticles(query: ArticleSearchQuery): Promise<ArticleSearchResult[]> {
    const needle = query.text?.trim().normalize("NFC").toLocaleLowerCase();
    const limit = Math.max(0, Math.min(query.limit ?? 20, 200));
    const offset = Math.max(0, query.offset ?? 0);

    const results = [...this.state.articles.values()]
      .filter((article) => {
        if (query.accountId && article.accountId !== query.accountId) return false;
        if (query.publishedAfter && (!article.publishedAt || article.publishedAt < query.publishedAfter)) {
          return false;
        }
        if (query.publishedBefore && (!article.publishedAt || article.publishedAt > query.publishedBefore)) {
          return false;
        }

        const sources = [...this.state.articleSources.values()].filter(
          (source) => source.articleId === article.id,
        );
        if (query.connectorId && !sources.some((source) => source.connectorId === query.connectorId)) {
          return false;
        }
        if (!needle) return true;
        const haystack = [
          article.title,
          article.author,
          article.summary,
          article.contentMarkdown,
          article.contentHtml,
        ]
          .filter(Boolean)
          .join("\n")
          .normalize("NFC")
          .toLocaleLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => compareOptionalDateDescending(a.publishedAt, b.publishedAt))
      .slice(offset, offset + limit)
      .map((article) => ({
        article: copy(article),
        sources: copy(
          [...this.state.articleSources.values()].filter((source) => source.articleId === article.id),
        ),
      }));

    return results;
  }
}

export { MemoryWechatRepository as InMemoryRepository };
