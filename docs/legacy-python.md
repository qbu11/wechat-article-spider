# Legacy Python implementation

The Python package is retained for migration compatibility and fixture-based
parser regression tests. It is not required by the npx package and is not the
supported Node CLI runtime.

## Reliability boundary

The legacy flow can use a browser login and private WeChat backend behavior.
Those endpoints can change, reject requests, or return frequency controls, so
the implementation must not be presented as a durable public API. It does not
provide a reliable persistent-subscription guarantee.

The supported Node subscription workflow accepts a user-provided, validated
RSS, Atom, or JSON Feed and refreshes it only through explicit
`wechat-agent sync`. Sogou remains best-effort discovery, not a subscription
backend.

## Credential migration

Legacy login caches contain reusable tokens and cookies. On POSIX systems they
are now written atomically with an owner-only file mode (`0600`) inside an
owner-only application directory (`0700`). Existing cache files are hardened
when loaded.

WC01 is **not encryption**. It is zlib compression, a CRC integrity check, and
URL-safe Base64; anyone with the string can decode the token and cookies.
Generation is disabled by default. The compatibility export requires the
explicit flag below, but the recommended migration is to scan and authenticate
again on the destination device.

```bash
# Discouraged compatibility escape hatch; output is plaintext-equivalent.
wechat-spider export-login --i-understand-this-is-not-encrypted
```

Do not pass WC01 through chat, shell history, CI output, tickets, or public
issues. Legacy import writes both the active cache and any backup with private
permissions.

## Browser safety changes

The managed Chrome debugging address is loopback-only. The legacy code no
longer sets wildcard remote origins, disables Chrome's sandbox by default,
hides automation features, or terminates every Chrome process by name. It calls
`page.quit()` only for a browser instance it created and preserves the profile
if clean shutdown fails.

## Parser fixtures

Sanitized golden fixtures under `tests/fixtures/` cover normal, image, video,
access-blocked, and deleted/expired pages. They contain no real credentials,
account identifiers, private URLs, or copied full articles. Both legacy and
future parser changes should preserve this contract and add sanitized cases for
new page shapes.

Run the compatibility suite with:

```bash
python -m pip install -e ".[dev]"
python -m pytest -q
```
