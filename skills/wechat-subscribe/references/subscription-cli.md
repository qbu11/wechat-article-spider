# Subscription CLI reference

Use `wechat-agent` by default. If it is not on `PATH`, first replace only the executable portion with the exact npm version:

```bash
npx -y @qbu11/wechat-agent-kit@0.1.0 <command> ... --json
```

Only when npm reports `E404` or explicitly says that this package/version is unpublished, retry the same command from the fixed Git tag:

```bash
npx -y github:qbu11/wechat-article-spider#v0.1.0 <command> ... --json
```

The GitHub fallback is slower on its first run but can be cached by npm. Do not use it for authentication, connectivity, integrity, or runtime failures; report those errors instead. Never use an unpinned package version, `main`, or `master` during an agent-run workflow.

## Supported subscription sources

Subscriptions accept only verified HTTPS feeds in one of these formats:

- RSS 2.0;
- Atom;
- JSON Feed.

An account name or account identifier is not a subscription source. Do not guess feed URLs or describe unstable account scraping as persistent subscription support.

The CLI must fetch within its network-safety policy, follow only safe redirects, enforce response limits, parse a supported feed, and reject HTML, malformed documents, unsupported formats, or unsafe destinations before storing a subscription.

## Commands

### Subscribe

```bash
wechat-agent subscribe --feed-url "https://example.com/wechat.xml" --label "Example account" --json
```

`--feed-url` is required. `--label` is optional user-facing metadata. Successful output contains the stored subscription, including its identifier, normalized source URL, label when supplied, and detected format in metadata.

### Unsubscribe

```bash
wechat-agent unsubscribe --subscription-id "<id>" --json
```

Unsubscribing stops future explicit synchronization; it does not imply deletion of indexed articles. Never pass a cached-data deletion option without separate explicit confirmation.

### List

```bash
wechat-agent list --json
```

The command returns all stored subscriptions. Each record may include its identifier, source URL, label, detected format in metadata, state, and last successful sync.

### Synchronize

```bash
wechat-agent sync --subscription-id "<id>" --json
```

Omit `--subscription-id` only for an explicit request to synchronize all active subscriptions. Output is an array of sync runs with status and discovered/stored article counts.

No internal scheduling is implied. A subscription changes only when `sync` runs. If the user wants periodic updates, explain that they may configure their operating system, CI service, or another external automation system to invoke the same pinned command. Do not create that automation without explicit authorization.

### Status

```bash
wechat-agent status --json
```

Use status to distinguish database readiness, feed health, recent sync runs, and article freshness. Do not report automatic update state because this package updates only through explicit `sync` calls.

### View indexed posts

After sync, search the local index using known article or publisher metadata:

```bash
wechat-agent search --type articles --query "<publisher or topic>" --scope local --limit 20 --json
```

Do not interpret an empty result as proof of no publications when the feed is stale or incomplete.

## JSON contract

On success, stdout contains JSON with `success: true` and `data`. On failure, stderr contains `{ "success": false, "error": "..." }`, stdout may be empty, and the process exits nonzero.

## Confirmation matrix

| Action | Confirmation rule |
| --- | --- |
| Subscribe one explicitly supplied feed URL | Explicit request is sufficient; CLI still validates it |
| Subscribe by account name or identifier | Unsupported; require a feed URL |
| Unsubscribe one explicitly named subscription | Explicit request is sufficient; restate outcome |
| Bulk subscribe/unsubscribe or replace a set | Show exact changes and ask |
| Configure an external scheduled task | Explain command, frequency, and environment; ask first |
| Delete cached articles or credentials | Separate explicit confirmation required |
| Targeted sync requested by user | Proceed once |
| Broad or repeated sync inferred by agent | Ask first |

When output reports required user action or a retry time, explain it and stop that source. Never automate around an access challenge.
