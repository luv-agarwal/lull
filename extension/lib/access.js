// Pure helpers for per-site access. Chrome lets an extension redirect a page to
// its own block page only on sites it has host access to, so Lull asks for
// access to exactly the sites on the list (optional host permissions), never to
// all sites. Sites without access are still blocked, with Chrome's plain page.

export const originsFor = (e) => (e.exact ? [`*://${e.d}/*`] : [`*://${e.d}/*`, `*://*.${e.d}/*`]);

export function neededOrigins(sites) {
  return [...new Set(sites.flatMap(originsFor))];
}

const patternHost = (p) => (p === '<all_urls>' ? '*' : (/^[^:]+:\/\/([^/]*)\//.exec(p) || [])[1] || null);

// Returns entry -> bool: does the granted origin list cover this entry?
export function accessChecker(origins = []) {
  const hosts = origins.map(patternHost).filter(Boolean);
  const exact = new Set(hosts.filter((h) => !h.startsWith('*')));
  const wild = hosts.filter((h) => h.startsWith('*')).map((h) => (h === '*' ? '' : h.slice(2)));
  const underWild = (h) => wild.some((w) => w === '' || h === w || h.endsWith('.' + w));
  return (e) => (exact.has(e.d) || underWild(e.d)) && (e.exact || underWild(e.d));
}
