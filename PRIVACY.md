# Lull privacy policy

Last updated: 23 October 2026

Lull collects nothing.

- **No network requests.** Lull never contacts any server: no analytics, no telemetry, no remote configuration, no ads, no update pings of its own (Chrome updates extensions itself).
- **Nothing runs inside web pages.** Lull has no content scripts and no access to page contents. Chrome blocks a listed site before it loads, using its built-in `declarativeNetRequest` rules.
- **Your block list and settings** are stored in `chrome.storage.sync`. If you use Chrome sync, Chrome copies them to your other signed-in Chromes through your own Google account, exactly like your bookmarks. Lull's author cannot see them.
- **Stats** (how many times a site was blocked, how many passes you took, per day for 30 days) are stored in `chrome.storage.local` on this computer only and never synced. "Clear stats" deletes them.
- **Current tab address.** When you click the Lull button or use its shortcut, Chrome lets Lull read the address of that one tab (the `activeTab` permission) so it can offer to block it. Lull does not store or send it anywhere unless you block the site.

Permissions and why: `declarativeNetRequest` (block sites), `storage` (your list and stats), `alarms` (schedules and 5-minute passes), `activeTab` (block the site you are on).

Questions: open an issue at https://github.com/luv-agarwal/lull/issues.
