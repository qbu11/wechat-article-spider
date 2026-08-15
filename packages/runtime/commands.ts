import { openRuntime } from "./service.js";

export interface RuntimeCommandInput {
  positionals: string[];
  values: ReadonlyMap<string, string>;
  flags: ReadonlySet<string>;
}

function integer(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Expected a positive integer, received: ${value}`);
  return parsed;
}

function required(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message);
  return value.trim();
}

export async function runRuntimeCommand(command: string, input: RuntimeCommandInput) {
  const runtime = await openRuntime();
  try {
    let data: unknown;
    switch (command) {
      case "search": {
        const query = required(input.values.get("--query") ?? input.positionals.join(" "), "search requires --query");
        const type = input.values.get("--type") ?? "articles";
        const limit = integer(input.values.get("--limit"), 10);
        if (type === "accounts") data = await runtime.service.searchAccounts(query, limit);
        else if (type === "articles") {
          const scope = (input.values.get("--scope") ?? "hybrid") as "local" | "global" | "hybrid";
          if (!["local", "global", "hybrid"].includes(scope)) throw new Error(`Unsupported search scope: ${scope}`);
          data = await runtime.service.searchArticles(query, { scope, limit });
        } else throw new Error(`Unsupported search type: ${type}`);
        break;
      }
      case "read": {
        const articleId = input.values.get("--article-id");
        const url = input.values.get("--url") ?? input.positionals[0];
        data = await runtime.service.readArticle({ ...(articleId ? { articleId } : {}), ...(url ? { url } : {}) });
        const level = input.values.get("--content") ?? "full";
        if (level !== "full" && data && typeof data === "object" && "article" in data) {
          const result = data as { article: Record<string, unknown>; sources: unknown };
          const article = { ...result.article };
          delete article.contentHtml;
          delete article.contentMarkdown;
          if (level === "excerpt" && typeof result.article.contentMarkdown === "string") {
            article.excerpt = result.article.contentMarkdown.slice(0, 800);
          }
          data = { article, sources: result.sources };
        }
        break;
      }
      case "subscribe":
        data = await runtime.service.subscribeFeed(
          required(input.values.get("--feed-url") ?? input.positionals[0], "subscribe requires --feed-url"),
          input.values.get("--label"),
        );
        break;
      case "unsubscribe":
        data = { removed: await runtime.service.unsubscribe(required(input.values.get("--subscription-id") ?? input.positionals[0], "unsubscribe requires --subscription-id")) };
        break;
      case "list":
        data = await runtime.service.listSubscriptions();
        break;
      case "sync":
        data = await runtime.service.sync(input.values.get("--subscription-id") ?? input.positionals[0]);
        break;
      case "status":
        data = await runtime.service.status(runtime.databasePath);
        break;
      default:
        throw new Error(`Unsupported runtime command: ${command}`);
    }
    return { success: true, data };
  } finally {
    runtime.close();
  }
}
