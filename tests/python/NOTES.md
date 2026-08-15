# Python legacy migration notes

The Python package remains available during the Node/CLI migration, with these
security changes:

- Login caches are written atomically with owner-only permissions (`0600`) in
  an owner-only directory (`0700`) on POSIX systems. Existing cache files are
  hardened when read.
- `export-login` / WC01 is **not encryption**. Export is disabled unless the
  caller explicitly passes `--i-understand-this-is-not-encrypted`. Re-login on
  the destination machine is the supported path. WC01 import remains only for
  migration compatibility and writes private cache/backup files.
- Managed Chrome uses a loopback debugging address, keeps the browser sandbox
  enabled, and no longer hides automation features. Cleanup only calls
  `page.quit()` for the instance it created; it never invokes global
  `pkill chrome` or `taskkill chrome.exe`.
- Sanitized fixtures define the parser contract for normal, image, video,
  blocked, and expired pages. They contain no real account IDs, cookies, tokens,
  article text, or private URLs and can be reused by the TypeScript port.
