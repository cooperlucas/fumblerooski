// Team colors for charts. Raw team colors are often too dark for a navy background (navy, black, forest green),
// and two teams can share nearly the same color, so chart lines get a brightened, clearly different pair.

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));
export const lum = (hex) => {
  const c = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const toHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const fromHsl = ([h, s, l]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};
// Raise lightness (keeping the hue and its punch) until the color stands out on the app's navy panels.
// Lightening this way keeps scarlet red and navy blue, where mixing with white would turn them pink and gray.
export function brighten(color, min = 0.15) {
  if (!isHex(color)) return String(color || '').replace(/(\d+)%\)$/, '64%)') || '#F5F5F7'; // hsl fallback colors
  if (lum(color) >= min) return color.toUpperCase(); // already reads on navy: leave it exactly as the team has it
  let [h, s, l] = toHsl(rgb(color));
  if (s > 0.08) s = Math.max(s, 0.6);
  let out = toHex(fromHsl([h, s, l]));
  for (let i = 0; i < 40 && lum(out) < min; i++) { l = Math.min(0.92, l + 0.02); out = toHex(fromHsl([h, s, l])); }
  return out;
}
const dist = (a, b) => (isHex(a) && isHex(b) ? Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i])) : 999);
const TOO_CLOSE = 95;

// Each side gets { main, second }: the line is the team's primary color, its drop shadow the team's secondary.
// If the two primaries look alike, the away team flips to its secondary for the line.
function pair(team) {
  const main = brighten(team.color);
  let second = isHex(team.color2) ? team.color2.toUpperCase() : null;
  if (!second || dist(second, main) < 70) second = lum(main) > 0.45 ? '#0C1124' : '#F5F5F7'; // no real second color: plain contrast
  return { main, second };
}
export function chartColors(away, home) {
  const h = pair(home);
  let a = pair(away);
  if (dist(a.main, h.main) < TOO_CLOSE) {
    const flipped = { main: brighten(a.second), second: brighten(away.color) };
    a = dist(flipped.main, h.main) >= TOO_CLOSE ? flipped : { main: '#F5F5F7', second: brighten(away.color) };
  }
  return { away: a, home: h };
}
export const inkOn = (color) => (isHex(color) && lum(color) < 0.32 ? '#FFFFFF' : '#0C1124');
