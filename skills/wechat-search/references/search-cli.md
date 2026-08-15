# Search CLI reference

Use the exact npm package through `npx` by default; do not assume a global executable:

```bash
npx -y @qbu11/wechat-agent-kit@0.2.1 query --keywords "AI agent" --scope hybrid --limit 10 --json
```

Only when npm reports `E404` or explicitly says that this package/version is unpublished, retry the same command from the fixed Git tag:

```bash
npx -y github:qbu11/wechat-article-spider#v0.2.1 query --keywords "AI agent" --scope hybrid --limit 10 --json
```

The GitHub fallback is slower on its first run but can be cached by npm. Do not use it for authentication, connectivity, integrity, or runtime failures; report those errors instead. Never replace `0.2.1` with `latest`, and never use `main` or `master`.

## Intent decision table

| User request | Intent | Required flags |
|---|---|---|
| “搜索大模型相关文章” | `keyword-search` | `--keywords` |
| “虎嗅APP 最近一周发了什么” | `account-window` | `--account --after --before` |
| “虎嗅APP 8 月关于机器人文章” | `account-window` | `--account --keywords --after --before` |
| “帮我找虎嗅这个公众号” | account discovery | `search --type accounts --query` |

The presence of a named publisher plus a request for its posts wins over topic search. The CLI also emits the resolved intent so the agent can verify its routing.

## Fast article query

Supported arguments:

- `--keywords <text>`, required for `keyword-search`, optional inside an account window.
- `--account <exact display name>`, required for `account-window`.
- `--after <YYYY-MM-DD or ISO timestamp>`, inclusive lower publication boundary.
- `--before <YYYY-MM-DD or ISO timestamp>`, inclusive upper publication boundary.
- `--intent keyword-search|account-window`, optional assertion; normally infer from the flags.
- `--scope local|global|hybrid`, default `hybrid`.
- `--limit <number>`, normally 10–20.
- `--json`, always include for agent use.

Examples:

```bash
npx -y @qbu11/wechat-agent-kit@0.2.1 query --keywords "大模型" --scope hybrid --limit 10 --json
npx -y @qbu11/wechat-agent-kit@0.2.1 query --account "虎嗅APP" --after 2026-08-01 --before 2026-08-15 --scope hybrid --limit 20 --json
npx -y @qbu11/wechat-agent-kit@0.2.1 query --account "虎嗅APP" --keywords "机器人" --after 2026-08-01 --before 2026-08-15 --json
```

Date-only boundaries are inclusive UTC calendar days. Convert relative dates into explicit dates before calling the CLI when the user expects another timezone.

Remote `account-window` coverage is best-effort and may be empty even when the publisher has posted. Do not translate an empty remote result into “no articles.” A verified Feed synchronized into the local index is the durable path for repeatable publisher windows.

## Account search

```bash
npx -y @qbu11/wechat-agent-kit@0.2.1 search --type accounts --query "人民日报" --limit 10 --json
```

Do not choose between similarly named accounts without enough evidence. Prefer a stable account identifier, display name, alias or description, and source provenance. Account search does not discover or guarantee a subscribable feed URL; never pass an account identifier to `subscribe`.

## JSON contract

Fast query success uses this envelope:

```json
{
  "success": true,
  "data": {
    "intent": { "kind": "keyword-search", "keywords": "大模型", "account": null, "after": null, "before": null },
    "mode": "fast-links",
    "scope": "hybrid",
    "coverage": "best-effort-discovery",
    "elapsedMs": 120,
    "count": 1,
    "articles": [{
      "id": "article_example",
      "title": "示例",
      "account": "示例号",
      "publishedAt": "2026-08-15T08:00:00.000Z",
      "summary": "摘要",
      "url": "https://mp.weixin.qq.com/s/example",
      "originalUrl": "https://mp.weixin.qq.com/s/example",
      "discoveryUrl": null,
      "linkKind": "original",
      "contentAvailable": false,
      "provenance": []
    }],
    "warnings": []
  }
}
```

`url` is the best immediately usable link. Treat `originalUrl` as an original WeChat article link only when its hostname is exactly `mp.weixin.qq.com`. A Sogou redirect or any other host belongs in discovery provenance, uses `linkKind: "discovery"`, and must not be described as an original link. Full article bodies are deliberately absent from fast query responses.

Account discovery success remains `{ "success": true, "data": [...] }` with account records.

On failure, stderr contains `{ "success": false, "error": "..." }` and the process exits nonzero. Stdout may be empty. Do not parse unrelated stderr text as article data.

A successful response does not prove complete coverage. Results are limited to the selected local index, network discovery source, or their hybrid merge. An account-window applies exact normalized account-name and publication-time filtering to the metadata that sources provide.
