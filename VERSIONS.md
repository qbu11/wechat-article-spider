# Version status

## Supported Agent package

`@qbu11/wechat-agent-kit` 0.1.x is the supported integration for agents. It
contains three standard Agent Skills and the `wechat-agent` JSON CLI. Search,
direct reading, and Feed subscriptions share one local SQLite file and update
only when a command is invoked.

## Legacy Python package

`wechat-article-spider` 1.x remains for users who explicitly need the older
QR-login workflow against the WeChat administration platform. It is tested for
compatibility but is not required by the Node package. See
[`docs/legacy-python.md`](docs/legacy-python.md).

Release tags use `v<node-package-version>`, beginning with `v0.1.0`.
