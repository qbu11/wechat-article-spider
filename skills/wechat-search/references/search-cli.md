# Search CLI reference

Use the installed executable by default:

```bash
wechat-agent search --type articles --query "AI agent" --scope hybrid --limit 10 --json
```

If `wechat-agent` is not on `PATH`, first try the exact npm version:

```bash
npx -y @qbu11/wechat-agent-kit@0.1.0 search --type articles --query "AI agent" --scope hybrid --limit 10 --json
```

Only when npm reports `E404` or explicitly says that this package/version is unpublished, retry the same command from the fixed Git tag:

```bash
npx -y github:qbu11/wechat-article-spider#v0.1.0 search --type articles --query "AI agent" --scope hybrid --limit 10 --json
```

The GitHub fallback is slower on its first run but can be cached by npm. Do not use it for authentication, connectivity, integrity, or runtime failures; report those errors instead. Never replace `0.1.0` with `latest`, and never use `main` or `master`.

## Article search

Supported arguments:

- `--type articles`, required for article results.
- `--query <text>`, required.
- `--scope local|global|hybrid`, default `hybrid`.
- `--limit <number>`, normally 10–20.
- `--json`, always include for agent use.

## Account search

```bash
wechat-agent search --type accounts --query "人民日报" --limit 10 --json
```

Do not choose between similarly named accounts without enough evidence. Prefer a stable account identifier, display name, alias or description, and source provenance. Account search does not discover or guarantee a subscribable feed URL; never pass an account identifier to `subscribe`.

## Search by account display name

```bash
wechat-agent search --type articles --query "<account display name>" --limit 20 --scope hybrid --json
```

This performs ordinary text search. It is not an exact account filter and does not guarantee newest-first order.

## JSON contract

On success, stdout contains `{ "success": true, "data": [...] }`. Article search data is an array of article results with their source records. Account search data is an array of account records.

On failure, stderr contains `{ "success": false, "error": "..." }` and the process exits nonzero. Stdout may be empty. Do not parse unrelated stderr text as article data.

A successful response does not prove complete coverage. Results are limited to the selected local index, network discovery source, or their hybrid merge.
