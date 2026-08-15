# Article CLI reference

Use the installed executable by default:

```bash
wechat-agent read --url "https://mp.weixin.qq.com/s/example" --content full --json
```

If `wechat-agent` is not on `PATH`, first try the exact npm version:

```bash
npx -y @qbu11/wechat-agent-kit@0.2.0 read --url "https://mp.weixin.qq.com/s/example" --content full --json
```

Only when npm reports `E404` or explicitly says that this package/version is unpublished, retry the same command from the fixed Git tag:

```bash
npx -y github:qbu11/wechat-article-spider#v0.2.0 read --url "https://mp.weixin.qq.com/s/example" --content full --json
```

The GitHub fallback is slower on its first run but can be cached by npm. Do not use it for authentication, connectivity, integrity, or runtime failures; report those errors instead. Never replace `0.2.0` with `latest`, and never use `main` or `master`.

## Arguments

- `--url <url>`, optional when `--article-id` is supplied; accept only supported WeChat article hosts.
- `--article-id <id>`, optional when `--url` is supplied.
- `--content metadata|excerpt|full`, choose the least data necessary.
- `--json`, always include for agent use.

Supply exactly one of `--url` and `--article-id` in normal use.

## JSON contract

On success, stdout contains `success: true` and `data` with `article` and `sources`. Article fields may include:

- article identifier and canonical URL;
- title, optional account identifier, author, summary, and publication/update times;
- normalized HTML or Markdown when `--content full` is used;
- an excerpt when `--content excerpt` is used;
- source records with connector, source URL, and discovery/fetch timestamps.

On failure, stderr contains `{ "success": false, "error": "..." }` and the process exits nonzero. Stdout may be empty.

## Completeness rules

- With `--content full`, summarize only the body actually returned.
- With `--content excerpt`, state that analysis covers an excerpt.
- With `--content metadata`, do not infer the article's argument from its title or metadata.
- When retrieval fails, report the error and original URL; do not seek unauthorized copies.

Images, video, audio, mini-program embeds, comments, and dynamic modules may be absent from normalized Markdown. Mention omissions when they affect the requested analysis.
