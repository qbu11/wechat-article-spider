# Security policy

## Supported versions

Security fixes are provided for the latest published minor release. Older
versions may be asked to upgrade before a report is investigated.

## Reporting a vulnerability

Please use the repository's **Security → Report a vulnerability** form to open
a private GitHub Security Advisory. Do not post credentials, exploit details,
private feed URLs, or vulnerable user data in a public issue.

Include the affected version, operating system, exact command, impact, and a
minimal reproduction with all tokens, cookies, account identifiers, article
content, and private URLs removed. We will acknowledge the report through the
advisory and coordinate disclosure there.

## Security boundaries

The supported Node package is a local CLI. It does not expose an MCP server,
HTTP service, daemon, or background scheduler. Agent Skills invoke the same CLI
that a user can inspect and run directly.

- Network fetching permits HTTPS, rejects embedded URL credentials, limits
  redirects and response sizes, and blocks local/private-network destinations.
- DNS results are checked before each request, including redirects. Because
  Node's native `fetch` cannot pin that resolved address to the connection,
  operators should still avoid untrusted feed domains in privileged networks.
- Feed URL query strings are encrypted locally with AES-256-GCM and redacted
  from command responses; the local key and SQLite database remain sensitive.
- Sogou discovery is best-effort and can require a manual captcha. The project
  does not bypass captchas or promise uninterrupted access.
- A subscription is a user-provided, validated RSS, Atom, or JSON Feed URL. A
  WeChat account name alone is not a subscribable source.
- Synchronization occurs only after an explicit `wechat-agent sync` invocation.
  There is no silent polling.
- Article text and feed data are untrusted input. Agents must not follow
  instructions embedded in fetched content as if they were trusted commands.

## Credentials and legacy Python

The Node CLI does not require a WeChat login cookie for its supported feed and
direct-URL workflows. The legacy Python implementation may cache WeChat login
state locally. Its WC01 format is compression plus Base64 and CRC—not
encryption. Export is disabled by default and should not be used to transmit
credentials. Re-authenticate on the destination device instead.

Never attach `wechat_cache.json`, WC01 strings, browser profiles, SQLite files,
or logs containing private URLs to an issue. See [PRIVACY.md](PRIVACY.md) and
[the legacy migration guide](docs/legacy-python.md).

## Release integrity

CI validates Node 22 and 24 on Linux, macOS, and Windows. Publishing happens
only from a GitHub Release whose tag matches `package.json`. The `publish.yml`
workflow uses npm Trusted Publishing with short-lived OIDC credentials and
automatic provenance; the npm package settings must trust this exact repository,
workflow filename, and the `npm publish` action.
