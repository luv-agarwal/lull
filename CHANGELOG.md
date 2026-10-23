# Changelog

## 1.0.0 — 2026-10-23

First release.

- Block sites and all their subdomains, or one exact host. Paste many at once.
- Calm block page with a configurable line and a 5-minute pass (hold 3 s).
- Focus schedules per weekday; outside them the block rules are removed.
- Exceptions (for example `music.youtube.com` inside a blocked `youtube.com`).
- Toolbar button and shortcut (Alt+Shift+B) to block the current site; ON/OFF badge.
- Local stats for the last 7 days.
- Optional strict mode: no pass, 60-second wait before loosening anything.
- Import and export as plain text. List syncs through Chrome sync.
- No content scripts, no network requests, no dependencies.
