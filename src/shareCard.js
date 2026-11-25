// The picture behind "Share this game": a square score card drawn on a canvas, so it needs no server and works offline.
import { LEAGUE } from './data/leagues.js';
import { liveColor } from './data/espn.js';
import { statusLabel, fmtDate, fmtTime } from './ui.jsx';

const W = 1080, H = 1080;
const FONT = "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif";
const lum = (c) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c || '');
  if (!m) return 0.2;
  const n = parseInt(m[1], 16);
  const v = [n >> 16 & 255, n >> 8 & 255, n & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
// Shrinks a line of text until it fits the width.
function fit(c, text, weight, size, max) {
  let s = size;
  for (; s > 26; s -= 2) { c.font = `italic ${weight} ${s}px ${FONT}`; if (c.measureText(text).width <= max) break; }
  return s;
}

export async function gameCard(g, lg) {
  try { await Promise.all([document.fonts.load(`italic 900 60px Archivo`), document.fonts.load(`800 40px Archivo`)]); } catch { /* the system font will do */ }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#15100C'; c.fillRect(0, 0, W, H);

  // Racing stripes top and bottom, like the link preview.
  const stripes = (y) => { [['#22D3D6', 0], ['#F8F2E7', 12], ['#8B5CF6', 24]].forEach(([col, dy]) => { c.fillStyle = col; c.fillRect(0, y + dy, W, 6); }); };
  stripes(52); stripes(H - 82);

  c.textBaseline = 'alphabetic';
  // Wordmark.
  c.textAlign = 'center';
  c.font = `italic 900 54px ${FONT}`;
  c.fillStyle = '#6E3AB5'; c.fillText('FUMBLEROOSKI', W / 2 + 4, 174 + 4);
  c.fillStyle = '#F8F2E7'; c.fillText('FUMBLEROOSKI', W / 2, 174);

  // League and status.
  const L = LEAGUE[lg] || {};
  const live = g.state === 'live', fin = g.state === 'final', pre = g.state === 'pre';
  const status = (fin ? statusLabel(g) : live ? statusLabel(g) : pre ? (g.tbd ? fmtDate(g.date) : `${fmtDate(g.date)} · ${fmtTime(g.date)}`) : statusLabel(g)).toUpperCase();
  const tag = `${(L.short || L.name || '').toUpperCase()}  ·  ${status}`;
  c.font = `italic 900 40px ${FONT}`;
  c.fillStyle = live ? '#FF3D7F' : '#F5C04A';
  c.fillText(tag, W / 2, 262);

  // One row per team: color tile with the abbreviation, the name, and the score.
  const aw = Number(g.away.score), hm = Number(g.home.score);
  const lead = fin && aw !== hm ? (aw > hm ? 'away' : 'home') : null;
  const rows = [['away', 330], ['home', 600]];
  rows.forEach(([sd, y]) => {
    const t = g[sd];
    const dim = lead && lead !== sd;
    const bg = liveColor(t);
    c.save();
    c.globalAlpha = dim ? 0.55 : 1;
    // Row plate.
    c.fillStyle = '#211812'; rr(c, 60, y, W - 120, 230, 36); c.fill();
    c.strokeStyle = 'rgba(248,242,231,0.12)'; c.lineWidth = 2; rr(c, 60, y, W - 120, 230, 36); c.stroke();
    // Tile.
    c.fillStyle = bg; rr(c, 92, y + 30, 170, 170, 40); c.fill();
    c.fillStyle = lum(bg) > 0.33 ? '#0C1124' : '#FFFFFF';
    c.textAlign = 'center';
    const ab = String(t.abbr || '');
    c.font = `italic 900 ${ab.length > 3 ? 48 : 62}px ${FONT}`;
    c.fillText(ab, 177, y + 133);
    // Name (with a ranking when the team has one).
    c.textAlign = 'left';
    const nm = (t.rank && t.rank <= 25 ? `${t.rank} ` : '') + t.name;
    const sz = fit(c, nm, 900, 64, 400);
    c.fillStyle = '#F8F2E7';
    c.font = `italic 900 ${sz}px ${FONT}`;
    c.fillText(nm, 290, y + 118);
    if (t.record) { c.font = `800 32px ${FONT}`; c.fillStyle = '#AC9A82'; c.fillText(t.record, 290, y + 168); }
    // Score.
    c.textAlign = 'right';
    c.font = `italic 900 150px ${FONT}`;
    c.fillStyle = lead === sd || live ? '#FFBE2E' : '#F8F2E7';
    c.fillText(pre || g.state === 'off' ? '' : String(t.score ?? ''), W - 100, y + 160);
    c.restore();
  });

  // Footer.
  c.textAlign = 'center';
  c.font = `italic 900 46px ${FONT}`;
  c.fillStyle = '#F8F2E7';
  c.fillText('fumblerooski.app', W / 2, H - 165);
  c.font = `800 30px ${FONT}`;
  c.fillStyle = '#AC9A82';
  c.fillText('PURE SPORTS  ·  NO ODDS  ·  NO ADS', W / 2, H - 120);

  return new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
}
