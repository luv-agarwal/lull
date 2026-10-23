// Tree drawings as inline SVG strings (no image files). Colours come from CSS
// variables on the page: --trunk, --leaf, --leaf-2, --soil, --fall.

const leaf = (x, y, deg, len, cls = 'lf') =>
  `<path class="${cls}" transform="translate(${x} ${y}) rotate(${deg})" d="M0 0Q${len / 2} ${-len / 3} ${len} 0Q${len / 2} ${len / 3} 0 0Z"/>`;
const circles = (list, cls) => list.map(([x, y, r]) => `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`).join('');

const STAGES = [
  // seed
  `<path class="soil" d="M44 106Q60 92 76 106Z"/><ellipse class="tk" cx="60" cy="100" rx="4.5" ry="3" transform="rotate(-20 60 100)"/>`,
  // sprout
  `<path class="soil" d="M46 106Q60 98 74 106Z"/><path class="st" d="M60 104Q60 96 61 89"/>`
    + `<g class="sway">${leaf(61, 89, -150, 11)}${leaf(61, 89, -30, 12)}</g>`,
  // sapling
  `<path class="st" d="M60 105C60 92 58 82 60 68"/><g class="sway">`
    + leaf(59.5, 90, -160, 12) + leaf(59, 82, -20, 13) + leaf(59.3, 75, -155, 12) + leaf(60, 68, -60, 12) + leaf(60, 68, -120, 11)
    + `</g>`,
  // young tree
  `<path class="tk" d="M58 105L58.6 72L61.4 72L62 105Z"/><g class="sway">`
    + circles([[50, 64, 11], [71, 63, 12]], 'lf2') + circles([[60, 57, 15], [55, 66, 9]], 'lf') + `</g>`,
  // tree
  `<path class="tk" d="M55.5 105Q57 88 57.5 66L62.5 66Q63 88 64.5 105Z"/><path class="st" d="M59 80Q66 74 72 66"/>`
    + `<g class="sway">${circles([[41, 55, 15], [79, 54, 16]], 'lf2')}${circles([[60, 43, 21], [60, 60, 16], [48, 59, 12], [72, 58, 12]], 'lf')}</g>`,
  // old tree
  `<path class="tk" d="M50 105Q55 102 55 92Q55.5 72 56 58L64 58Q64.5 72 65 92Q65 102 70 105Z"/>`
    + `<path class="st" d="M57 78Q48 70 42 60M63 74Q72 68 79 58"/>`
    + `<g class="sway">${circles([[35, 50, 17], [85, 48, 18], [60, 27, 18]], 'lf2')}`
    + `${circles([[60, 38, 23], [44, 58, 15], [76, 58, 15], [60, 60, 13]], 'lf')}`
    + circles([[50, 35, 2.2], [70, 30, 2.2], [78, 50, 2.2], [42, 52, 2.2], [63, 54, 2.2]], 'bl') + `</g>`,
];

export const STAGE_NAMES = ['Seed', 'Sprout', 'Sapling', 'Young tree', 'Tree', 'Old tree'];

export function treeSVG(stage, { fallen = false, size = 120 } = {}) {
  const s = Math.max(0, Math.min(STAGES.length - 1, stage | 0));
  return `<svg class="tree" viewBox="0 0 120 112" width="${size}" height="${Math.round(size * 112 / 120)}" role="img" aria-label="${STAGE_NAMES[s]}">`
    + `<ellipse class="gr" cx="60" cy="106" rx="42" ry="4.5"/>${STAGES[s]}`
    + (fallen ? leaf(80, 104, -14, 13, 'fall') : '') + `</svg>`;
}

// A row of small finished trees, one per tree grown to the end.
export function groveSVG(count, max = 12) {
  const n = Math.min(count, max);
  if (!n) return '';
  const w = n * 14;
  let g = '';
  for (let i = 0; i < n; i++) {
    const x = 7 + i * 14;
    g += `<rect class="tk" x="${x - 1}" y="12" width="2" height="7"/><circle class="lf" cx="${x}" cy="9" r="6"/>`;
  }
  return `<svg class="grove" viewBox="0 0 ${w} 20" width="${w}" height="20" role="img" aria-label="${count} trees in your grove">${g}</svg>`;
}
