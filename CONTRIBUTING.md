# Contributing

Contributions are welcome for the supported CLI-only product: Agent Skills,
local search and reading, verified feed subscriptions, explicit sync, storage,
installer safety, tests, and documentation. Please discuss broad connector or
architecture changes in an issue before implementation.

## Development setup

Requirements are Node.js 22.13 or newer and npm. Python 3.8 or newer is needed
only for the legacy compatibility suite.

```bash
npm ci
npm run validate
npm run build
npm run pack:check
```

For the legacy suite:

```bash
python -m pip install -e ".[dev]"
python -m pytest -q
```

## Pull-request expectations

- Keep the runtime CLI-only. Do not add an MCP server, daemon, hidden
  background scheduler, install lifecycle mutation, captcha bypass, or stealth
  browser behavior without an approved architectural proposal.
- Treat Sogou as best-effort discovery. Tests must use fixtures or mocks, not
  live queries or secrets.
- Persistent subscriptions must remain explicit, validated RSS/Atom/JSON Feed
  URLs. Account names are discovery metadata, not subscription endpoints.
- Preserve the single local SQLite database and idempotent migrations. New
  stored fields need migration and rollback/compatibility tests.
- Keep `sync` explicit and report degraded or user-action-required states
  honestly.
- Agent Skills must use valid Agent Skills YAML frontmatter with a folder-
  matching `name` and a concise `description`; run `npm run validate:skills`.
- Add tests for behavior changes and sanitize fixtures. Never commit cookies,
  tokens, WC01 strings, real browser profiles, private feeds, or copyrighted
  full articles.

## Release changes

The GitHub release workflow is validation-only. It has OIDC permission for npm
Trusted Publishing/provenance but contains no publish command. Do not add
`npm publish` or long-lived npm tokens in an ordinary pull request. Enabling
publication requires maintainer approval, npm trusted-publisher configuration,
and explicit review of the exact workflow identity.

By contributing, you agree that your contribution is distributed under the
repository's MIT license.
