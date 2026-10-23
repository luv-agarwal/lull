# Lull — calm site blocker for Chrome

Block distracting sites with focus schedules and a gentle 5-minute pass.
Lull adds nothing to the pages you visit: Chrome itself stops a listed site
before it loads (`declarativeNetRequest`) and shows Lull's own quiet page.

- **Sites**: add one or paste many; each blocks its subdomains too, or only one exact host.
- **Block page**: the site, your own reason, a short calm line, and a 5-minute pass you get by holding a button for 3 seconds.
- **A tree that grows while you stay away** (see below).
- **Schedules**: "Always", or named focus windows per weekday (for example 09:00–13:00 Mon–Fri). Outside a window the rule is removed, not bypassed.
- **Exceptions**: keep `music.youtube.com` while `youtube.com` is blocked.
- **Toolbar button and shortcut** (Alt+Shift+B) block the site you are on. The badge shows ON or OFF.
- **Stats**: blocks per site for the last 7 days, stored on this computer only.
- **Strict mode** (off by default): no pass; removing or loosening anything waits 60 seconds.
- **Import / export** as plain text. Your list follows you through Chrome sync.

## Your tree

Every day without a pass, a small tree on the block page grows: seed, sprout (day 1),
sapling (day 3), young tree (day 7), tree (day 14), old tree (day 30).

1. A day with no pass grows the tree by one day.
2. Your first pass of the week costs one leaf. The tree still grows that day.
3. Any other day with a pass, the tree rests: no growth, no loss.
4. A hard day (3 or more passes, or the third day in a row with a pass) takes it back to the top of the stage below, so one clear day restores it. It never goes below a sapling.
5. At day 30 the tree joins your grove and a new seed starts. Nothing removes a tree from the grove.

Why it works this way: a full reset after one slip makes people give up ("what the hell"),
so a slip costs a leaf or a pause, never the tree. Visiting the block page earns nothing,
so the urge itself is never rewarded, and the block page shows no pass counts. A day
settles at local midnight from the passes Lull already counts; nothing runs in the
background and nothing leaves your computer. Turn the tree or the quotes off in settings;
a switched-off tree waits where it is.

Under the tree: your own reason (settings → Block page), then one of 40 calm prompts and
public-domain lines (Marcus Aurelius, Seneca, Thoreau, proverbs), never the same twice in a row.

## Install

From the Chrome Web Store: _link coming soon_.

Load it unpacked (for development, or before the store listing is live):

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin Lull from the puzzle-piece menu. The settings page opens on first install.

When you add sites, Chrome asks once to let Lull show its page on those sites.
If you decline, the sites are still blocked, with Chrome's plain error page.

## Privacy

No network requests, no analytics, no remote config, no content scripts. See [PRIVACY.md](PRIVACY.md).

| Permission | Why |
| --- | --- |
| `declarativeNetRequest` | Block listed sites inside Chrome |
| `storage` | Your list, settings and local stats |
| `alarms` | Schedule edges and the end of a pass |
| `activeTab` | Read the current tab's address when you click Lull or press the shortcut |
| optional host access, per site | Redirect a blocked site to Lull's block page; asked only for sites you add, and given back when you remove them |

## How it works

- The service worker turns your list into a handful of dynamic rules (one redirect rule per 1,000 sites, one small rule per exact host, one allow rule for exceptions) and swaps them in with a single `updateDynamicRules` call. It runs only on events: install, start-up, a storage change, an alarm, a message or the shortcut.
- The redirect keeps the full address after `#`, so the block page can show it and return to it after a pass.
- A pass is a short-lived session `allow` rule with a higher priority, removed by a `chrome.alarms` alarm.

## Performance (measured 2026-10-23, Chrome 155, MacBook)

| Budget | Measured |
| --- | --- |
| Service worker idle between events | stops after ~30 s idle (checked) |
| Block page < 50 KB | 35.7 KB total (HTML, CSS, JS incl. tree and quotes, icon); no task over 50 ms, load 33 ms |
| Rule rebuild < 50 ms for 500 sites | 1.4 ms to build, 21 ms including Chrome applying the rules |
| 500-site settings page without jank | no task over 50 ms; first render 31 ms, full re-render 15 ms, filter 14 ms |

## Development

No build step and no dependencies. Needs Node 20+ for the tests.

```sh
npm test                 # unit tests: rule builder, schedules, import/export, storage encoding
npm run verify           # end-to-end in a throwaway headless Chrome profile (~3 min)
sh scripts/pack.sh       # dist/lull-<version>.zip for the Chrome Web Store
```

`scripts/verify-chrome.mjs` never touches your own Chrome: it starts a separate
headless Chrome with a temporary profile over a pipe, serves fake `*.test` sites
locally, and deletes the profile afterwards.

Icon source: `extension/icons/icon.svg` (PNGs rendered with ImageMagick).

## Licence

MIT
