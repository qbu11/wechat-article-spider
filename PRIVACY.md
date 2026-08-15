# Privacy

wechat-agent-kit is local-first and has no project-operated analytics or
telemetry. Running a command can still send data to the source selected by the
user.

## Data stored locally

The Node CLI automatically creates one SQLite file named
`wechat-agent.sqlite` in the platform application-data directory:

- macOS: `~/Library/Application Support/wechat-agent-kit/`
- Linux: `$XDG_DATA_HOME/wechat-agent-kit/` or
  `~/.local/share/wechat-agent-kit/`
- Windows: `%APPDATA%\wechat-agent-kit\`

`WECHAT_AGENT_DATA_DIR` can override this location. The database contains
indexed article metadata/content, source URLs, subscriptions, cursors, source
health, and sync history. Skill installation also records an ownership
manifest and may retain backups under the same application-data directory.
There is no remote project database or automatic upload.

## Network disclosures

- A global or hybrid search sends the search terms to Sogou WeChat Search.
  Sogou is an independent third party; results are best-effort and may be
  blocked, changed, or gated by a captcha.
- Reading a direct article URL contacts `mp.weixin.qq.com`. Following a Sogou
  result may contact both Sogou and WeChat.
- Adding or synchronizing a subscription contacts the exact user-supplied feed
  host. Supported persistent sources are validated RSS, Atom, and JSON Feed
  URLs only.
- DNS resolvers, network operators, GitHub/npm during installation, and source
  hosts may process connection metadata under their own policies.

Subscriptions do not update in the background. Network access happens when a
user or agent explicitly runs commands such as `search`, `read`, `subscribe`,
or `sync`. An external scheduler configured by the user is outside this
project's control.

## Sensitive data

Avoid putting secrets or private intranet URLs into feed URLs, labels, search
queries, issue reports, and logs. URLs containing embedded credentials are
rejected, and local/private-network feed targets are blocked.

The legacy Python cache can contain reusable WeChat cookies and tokens. WC01 is
not encrypted: anyone with the string may recover the credentials. Legacy
exports are disabled by default; scan again on each destination instead. See
[docs/legacy-python.md](docs/legacy-python.md).

## Deletion and backups

`wechat-agent uninstall` removes only unmodified Skill files tracked by its
ownership manifest. It intentionally preserves user-modified files, the local
SQLite database, and backups. To erase local article/subscription data, first
stop all CLI invocations and then delete the application-data directory shown
above. Review it before deletion; recovery depends on the user's own backups.
