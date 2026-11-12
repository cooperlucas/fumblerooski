// The only file that knows what the scores feed looks like.
// Everything else in the app reads the plain shapes this file returns (Game, Team, Standings...),
// so swapping in a licensed feed later means rewriting this one adapter, not the screens.
//
// Feed: ESPN's public site API. It is unofficial and its terms do not cover commercial use,
// so treat it as private-beta only.

import { LEAGUE, LEAGUES } from './leagues.js';
import { scrub, cleanText } from './guard.js';
import { COLLEGE_COLORS, PRO_COLORS } from './teamColors.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const V2 = 'https://site.api.espn.com/apis/v2/sports';
const COMMON = 'https://site.web.api.espn.com/apis/common/v3/sports'; // player pages
const SEARCH = 'https://site.web.api.espn.com/apis/common/v3/search';

export class FeedError extends Error {
  constructor(message, status) { super(message); this.name = 'FeedError'; this.status = status; }
}

let fetcher = async (url) => {
  let res;
  try { res = await fetch(url, { headers: { accept: 'application/json' } }); }
  catch (e) { throw new FeedError('Could not reach the scores feed. Check your connection.', 0); } // offline, or the browser blocked the request
  if (!res.ok) throw new FeedError(`The scores feed answered with an error (${res.status}).`, res.status);
  return res.json();
};
// Demo mode and tests swap the network for fixtures here.
export function setFetcher(fn) { fetcher = fn; }

function url(base, lg, path, params) {
  const L = LEAGUE[lg];
  if (!L) throw new FeedError(`Unknown league: ${lg}`, 0);
  const q = new URLSearchParams(params || {}).toString();
  return `${base}/${L.sport}/${L.slug}${path}${q ? '?' + q : ''}`;
}
const get = async (u) => scrub(await fetcher(u));

/* ---------- small helpers ---------- */
const hexOk = (h) => /^[0-9a-f]{6}$/i.test(String(h || ''));
const lum = (h) => {
  const n = parseInt(h, 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
// No known color (mostly small colleges the feed barely describes): a plain slate chip, not a made-up team color.
// Kept as an hsl() string on purpose: anything not starting with # reads as "stand-in" to the color lookups.
function hashColor() { return 'hsl(226 20% 36%)'; }
// A team chip needs a color that shows up on a navy screen with white letters.
export function teamColor(color, alt, seed) {
  const a = hexOk(color) ? color : null, b = hexOk(alt) ? alt : null;
  const usable = (h) => h && lum(h) > 0.012 && lum(h) < 0.7; // silver and gold are fine (chips switch to dark letters); near-white is not
  if (usable(a)) return '#' + a.toUpperCase();
  if (usable(b)) return '#' + b.toUpperCase();
  if (a && lum(a) <= 0.012) return '#2B3352'; // near-black team color: lift it off the background
  return hashColor(seed || 'team');
}

// Standings and a few other reads leave team colors out, so remember every real color we see
// (scoreboards, team lists, game pages) and fill the gaps from that. Kept on the device between visits.
const book = new Map(); // 'lg:id' -> [color, alt]
let bookLoaded = false, bookTimer = null;
const hasStore = () => typeof localStorage !== 'undefined';
function loadBook() {
  if (bookLoaded) return; bookLoaded = true;
  if (!hasStore()) return;
  try { const o = JSON.parse(localStorage.getItem('fr.colors.v1') || '{}'); for (const k of Object.keys(o)) if (!book.has(k)) book.set(k, o[k]); } catch { /* carry on without it */ }
}
// Screens listen here so chips repaint the moment a real color is learned, whichever screen asked for it.
const colorSubs = new Set(); let colorPing = null;
export function onColors(fn) { colorSubs.add(fn); return () => colorSubs.delete(fn); }
function learn(key, color, alt) {
  const old = book.get(key);
  if (old && old[0] === color && old[1] === alt) return;
  book.set(key, [color, alt]);
  if (colorSubs.size && !colorPing) colorPing = setTimeout(() => { colorPing = null; colorSubs.forEach((f) => f()); }, 60);
  if (!hasStore() || bookTimer) return;
  bookTimer = setTimeout(() => { bookTimer = null; try { localStorage.setItem('fr.colors.v1', JSON.stringify(Object.fromEntries(book))); } catch { /* full or private mode */ } }, 800);
}
// A school has the same id in every college sport, so a color learned in one covers the others.
const COLLEGE = LEAGUES.filter((l) => l.college).map((l) => l.id);
// Colors that ship with the app: the fallback when the feed has not told us a team's colors yet.
function builtIn(lg, id, abbr) {
  const v = LEAGUE[lg]?.college ? COLLEGE_COLORS[id] : (PRO_COLORS[lg]?.[id] || PRO_COLORS[lg]?.[String(abbr || '').toUpperCase()]);
  return v ? [v.slice(0, 6), v.length >= 12 ? v.slice(6, 12) : null] : null;
}
function bookGet(lg, id, abbr) {
  loadBook();
  let k = book.get(`${lg}:${id}`);
  if (!k && LEAGUE[lg]?.college) for (const o of COLLEGE) { k = book.get(`${o}:${id}`); if (k) break; }
  return k || builtIn(lg, id, abbr);
}
const knowsColor = (t, lg) => hexOk(t?.color) || !!bookGet(lg, t?.id, t?.abbreviation);
// Teams saved earlier (search index, pinned teams) may carry a stand-in color: use the real one once we know it.
export function liveColor(team) {
  if (!team || /^#/.test(team.color || '')) return team?.color;
  const k = team.id && team.lg ? bookGet(team.lg, team.id, team.abbr) : null;
  return k ? teamColor(k[0], k[1], team.name) : team.color;
}
// Look up real colors for teams still showing a stand-in (a few team reads, remembered for good). True if any were learned.
const colorBusy = new Set(), colorFails = new Map();
export async function ensureColors(teams, cap = 12, pool = 2) {
  const need = [];
  for (const t of teams || []) {
    const key = `${t?.lg}:${t?.id}`;
    if (!t?.id || !LEAGUE[t.lg] || /^#/.test(t.color || '') || bookGet(t.lg, t.id, t.abbr) || colorBusy.has(key) || (colorFails.get(key) || 0) >= 2) continue;
    colorBusy.add(key); need.push([key, t]);
    if (need.length >= cap) break;
  }
  if (!need.length) return false;
  let next = 0, got = false;
  const worker = async () => {
    while (next < need.length) {
      const [key, t] = need[next++];
      try {
        const d = await get(url(SITE, t.lg, `/teams/${encodeURIComponent(t.id)}`));
        normTeam(d.team?.id ? d.team : { ...(d.team || {}), id: t.id }, t.lg);
        if (bookGet(t.lg, t.id, t.abbr)) got = true; else colorFails.set(key, 2); // the feed has no color for this team
      } catch { colorFails.set(key, (colorFails.get(key) || 0) + 1); } // a failed read gets one more try later
      colorBusy.delete(key);
    }
  };
  await Promise.all(Array.from({ length: Math.min(pool, need.length) }, worker));
  return got;
}

// The second color. When the chip had to use the alternate (primary is black or white), the primary is the second.
function second(color, alt) {
  const a = hexOk(color) ? '#' + String(color).toUpperCase() : null, b = hexOk(alt) ? '#' + String(alt).toUpperCase() : null;
  return a && b && teamColor(color, alt, 'x') === b ? a : b;
}
// Teams whose feed colors are not what they wear. [primary, secondary]
const COLOR_FIX = { 'nba:24': ['c4ced4', '000000'] }; // Spurs: silver and black

export function normTeam(t, lg) {
  t = t || {};
  if (t.id != null && COLOR_FIX[`${lg}:${t.id}`]) { const [c, a] = COLOR_FIX[`${lg}:${t.id}`]; t = { ...t, color: c, alternateColor: a }; }
  if (t.id != null) {
    const key = `${lg}:${t.id}`;
    if (hexOk(t.color)) learn(key, String(t.color), hexOk(t.alternateColor) ? String(t.alternateColor) : null);
    else { const k = bookGet(lg, t.id, t.abbreviation); if (k) t = { ...t, color: k[0], alternateColor: k[1] }; }
  }
  // Game pages do not send the short name, so build it: schools go by place ("Virginia Tech"), pros by nickname ("Bills").
  const name = t.shortDisplayName || (LEAGUE[lg]?.college ? t.location : t.name) || t.displayName || t.name || t.location || 'TBD';
  const abbr = String(t.abbreviation || name).toUpperCase().slice(0, 4);
  return {
    id: String(t.id ?? ''), lg,
    name, full: t.displayName || name, abbr,
    color: teamColor(t.color, t.alternateColor, (t.displayName || name) + lg),
    color2: second(t.color, t.alternateColor),
  };
}

const scoreOf = (c) => {
  const s = c?.score;
  if (s == null) return '';
  if (typeof s === 'object') return String(s.displayValue ?? s.value ?? '');
  return String(s);
};
const recordOf = (c) => {
  const r = c?.records?.[0] || (Array.isArray(c?.record) ? c.record[0] : null);
  return r ? String(r.summary || r.displayValue || '') : (typeof c?.record === 'string' ? c.record : '');
};

function normSide(c, lg) {
  const rank = Number(c?.curatedRank?.current ?? c?.rank) || null; // the game page's header calls it rank
  return {
    ...normTeam(c?.team, lg),
    score: scoreOf(c),
    record: recordOf(c),
    winner: c?.winner === true,
    rank: rank && rank <= 25 ? rank : null,
    lines: (c?.linescores || []).map((l) => String(l.displayValue ?? l.value ?? '')),
  };
}

const OFF = /POSTPONED|CANCEL|SUSPENDED|DELAYED|FORFEIT|ABANDONED/;

// One game, the same shape no matter which endpoint it came from.
// Where to watch. The scoreboard has geoBroadcasts and the game summary has the same shape under broadcasts;
// older payloads use { market, names }. National TV comes first, then national streaming, then each team's local channel.
// Men's college hoops plays halves: "18:40 - 1st" reads "18:40 - 1H".
const halves0 = (lg, t) => (LEAGUE[lg]?.periods === 2 && LEAGUE[lg]?.sport === 'basketball' ? t.replace(/\b1st( Half)?\b/i, '1H').replace(/\b2nd( Half)?\b/i, '2H') : t);
// Breaks read the way a broadcast calls them: the end of the 2nd quarter (or 1st half) is Halftime,
// the end of a hockey period is an intermission.
// How long a league's halftime or intermission usually runs, in minutes. TV can stretch it, so this is a target.
export const BREAK_MIN = { nfl: 13.5, cfb: 20, nba: 15, wnba: 15, ncaam: 15, ncaaw: 15, nhl: 18, epl: 15, mls: 15 };
// The break this game is in right now, and when play should be back: { name, until } or null.
export function breakClock(lg, game, lastWall) {
  if (!game || game.state !== 'live' || !lastWall) return null;
  const t = String(game.statusText || '');
  const name = /halftime/i.test(t) ? 'Halftime' : /intermission/i.test(t) ? t : null;
  const min = BREAK_MIN[lg];
  if (!name || !min) return null;
  const next = /halftime/i.test(t) ? (LEAGUE[lg]?.sport === 'hockey' ? '' : '2nd half') : /1st/i.test(t) ? '2nd period' : /2nd/i.test(t) ? '3rd period' : 'Play';
  return { name, next: next || 'Play', until: lastWall + min * 60000 };
}
export function breakName(lg, t) {
  const L = LEAGUE[lg] || {};
  if (/^end of (the )?(2nd( quarter)?|q2)$/i.test(t) && L.periods === 4) return 'Halftime';
  if (/^end of (the )?1st half$|^end of 1h$/i.test(t) && L.periods === 2 && L.sport === 'basketball') return 'Halftime';
  const hk = /^end of (the )?(1st|2nd)( period)?$/i.exec(t);
  if (hk && L.sport === 'hockey') return `${hk[2]} Intermission`;
  return t;
}
const halves = (lg, t) => halves0(lg, breakName(lg, t));
export function normTv(comp) {
  const list = [];
  for (const b of (comp?.geoBroadcasts?.length ? comp.geoBroadcasts : comp?.broadcasts) || []) {
    if (b?.media && /radio/i.test(String(b.type?.shortName || ''))) continue; // TV and streaming only
    if (b?.media) list.push({ name: b.media.shortName || b.media.name, market: String(b.market?.type || b.market || '').toLowerCase(), stream: /stream/i.test(String(b.type?.shortName || '')) });
    else for (const n of b?.names || []) list.push({ name: n, market: String(b?.market || '').toLowerCase(), stream: false });
  }
  const clean = list.map((x) => ({ ...x, name: cleanText(x.name || '') })).filter((x) => x.name);
  const pick = (m, stream) => [...new Set(clean.filter((x) => x.market === m && x.stream === stream).map((x) => x.name))];
  const national = [...pick('national', false), ...pick('national', true)];
  return { national, home: pick('home', false), away: pick('away', false) };
}

// Red zone = the team with the ball is inside the other side's 20. The feed's own flag sometimes lingers
// after a change of possession (Akron at its own 16 flagged red), so read the spot when it is there.
function redZoneOf(comp) {
  const st = comp.situation || {};
  const m = /^(\S+)\s+(\d+)$/.exec(cleanText(st.possessionText || ''));
  const has = (comp.competitors || []).find((c) => String(c.team?.id) === String(st.possession ?? ''));
  if (m && has?.team?.abbreviation) return m[1].toUpperCase() !== String(has.team.abbreviation).toUpperCase() && +m[2] <= 20;
  return st.isRedZone === true;
}
export function normEvent(ev, lg) {
  const comp = ev?.competitions?.[0] || ev || {};
  const cs = comp.competitors || [];
  const homeC = cs.find((c) => c.homeAway === 'home') || cs[1] || {};
  const awayC = cs.find((c) => c.homeAway === 'away') || cs[0] || {};
  const st = comp.status || ev?.status || {};
  const type = st.type || {};
  let state = type.state === 'in' ? 'live' : type.state === 'post' ? 'final' : 'pre';
  if (OFF.test(String(type.name || ''))) state = 'off';
  const date = comp.date || ev?.date || null;
  return {
    id: String(ev?.id ?? comp.id ?? ''), lg, date, state,
    // Short label from the feed ("Final/OT", "4:12 - 3rd", "Halftime"). Screens format kickoff times themselves.
    statusText: halves(lg, cleanText(type.shortDetail || type.detail || type.description || '')),
    // The feed gives undecided kickoff times a placeholder clock time; flag them so screens say TBD.
    tbd: state === 'pre' && (comp.timeValid === false || ev?.timeValid === false || /\bTBD\b/i.test(String(type.shortDetail || type.detail || ''))),
    period: st.period || 0,
    clock: st.displayClock || '',
    home: normSide(homeC, lg),
    away: normSide(awayC, lg),
    note: cleanText(comp.notes?.[0]?.headline || ''),
    tv: normTv(comp),
    neutral: comp.neutralSite === true,
    // Live football: which team has the ball, and whether they are inside the 20.
    poss: state === 'live' && LEAGUE[lg]?.sport === 'football' ? String(comp.situation?.possession ?? '') : '',
    redZone: state === 'live' && redZoneOf(comp),
    // Down, distance and ball spot ("2nd & 7", "AKR 41"). Blank between plays like kickoffs and extra points.
    down: state === 'live' && LEAGUE[lg]?.sport === 'football' && Number(comp.situation?.down) > 0 ? cleanText(comp.situation?.shortDownDistanceText || '') : '',
    spot: state === 'live' && LEAGUE[lg]?.sport === 'football' && Number(comp.situation?.down) > 0 ? cleanText(comp.situation?.possessionText || '') : '',
  };
}

/* ---------- scoreboard ---------- */
// day: 'YYYYMMDD' or undefined for the feed's current slate.
// day: 'YYYYMMDD'. week: { week, type, year } for football's week-by-week slates.
export async function getScoreboard(lg, day, week) {
  const L = LEAGUE[lg];
  const wk = week ? { week: String(week.week), seasontype: String(week.type), ...(week.year ? { dates: String(week.year) } : {}) } : {};
  const data = await get(url(SITE, lg, '/scoreboard', { ...(L.params || {}), ...(day ? { dates: day } : {}), ...wk }));
  const games = (data.events || []).map((e) => normEvent(e, lg)).filter((g) => g.id && g.home.id && g.away.id);
  const Lg = data.leagues?.[0] || {};
  const cal = Lg.calendar || [];
  // Football's calendar is weeks; everyone else's is the list of dates that have games (used for the calendar dots).
  const weeks = Lg.calendarType === 'list' ? cal.flatMap((t) => (t.entries || []).map((e) => ({ week: Number(e.value), type: Number(t.value), label: cleanText(e.label || ''), detail: cleanText(e.detail || ''), start: e.startDate, end: e.endDate })))
    .filter((w) => w.week && w.type !== 4 && (w.type !== 1 || L.sport === 'football' && !L.college)) : null;
  const dates = Lg.calendarType === 'day' ? cal.map((x) => String(x).slice(0, 10)) : null;
  return {
    lg, games, season: Lg.season?.type?.name || '',
    year: Number(data.season?.year || Lg.season?.year) || null,
    weeks, dates,
    current: weeks ? { week: Number(data.week?.number) || null, type: Number(data.season?.type) || null } : { day: data.day?.date || null },
  };
}

/* ---------- NBA Cup: group standings, worked out from the schedule (the feed has no Cup table) ---------- */
// rankCupGroup: order one group's teams by the Cup's own tiebreakers: record, then head-to-head among the
// tied teams, then point differential, then points scored. games: finished group games among these teams.
export function rankCupGroup(ids, games) {
  const row = (id) => {
    let w = 0, l = 0, pf = 0, pa = 0;
    games.forEach((g) => {
      const me = g.away.id === id ? g.away : g.home.id === id ? g.home : null;
      if (!me) return;
      const them = me === g.away ? g.home : g.away;
      const a = Number(me.score), b = Number(them.score);
      pf += a; pa += b; if (a > b) w++; else l++;
    });
    return { id, w, l, pf, pa, pd: pf - pa };
  };
  const rows = ids.map(row);
  const pct = (r) => (r.w + r.l ? r.w / (r.w + r.l) : 0);
  const h2h = (id, tied) => games.filter((g) => tied.includes(g.away.id) && tied.includes(g.home.id) && (g.away.id === id || g.home.id === id))
    .filter((g) => { const me = g.away.id === id ? g.away : g.home, them = me === g.away ? g.home : g.away; return Number(me.score) > Number(them.score); }).length;
  // Record means winning percentage (teams can have played different numbers of games mid-way through).
  const byPct = new Map();
  rows.forEach((r) => { const k = pct(r).toFixed(4); byPct.set(k, [...(byPct.get(k) || []), r]); });
  return [...byPct.keys()].sort((a, b) => b - a).flatMap((k) => {
    const tied = byPct.get(k), ids2 = tied.map((r) => r.id);
    return tied.length < 2 ? tied : [...tied].sort((a, b) => h2h(b.id, ids2) - h2h(a.id, ids2) || b.pd - a.pd || b.pf - a.pf);
  });
}
// Official NBA Cup groups by year (from the NBA's announcement); keys are conference + letter.
const CUP_GROUPS = {
  2026: {
    EastA: ['DET', 'TOR', 'ORL', 'MIL', 'BKN'], EastB: ['NY', 'CLE', 'PHI', 'MIA', 'IND'], EastC: ['BOS', 'ATL', 'CHA', 'CHI', 'WSH'],
    WestA: ['DEN', 'HOU', 'PHX', 'DAL', 'UTAH'], WestB: ['OKC', 'MIN', 'LAC', 'NO', 'MEM'], WestC: ['SA', 'LAL', 'POR', 'GS', 'SAC'],
  },
};
// The whole Cup group stage: six groups of five, from the season's group games. Null when there are none.
export async function getNbaCup() {
  const lg = 'nba';
  const sb = await getScoreboard(lg);
  const dates = (sb.dates || []).filter(Boolean);
  if (!dates.length) return null;
  const y0 = Number(dates[0].slice(0, 4));
  const inWindow = dates.filter((d) => { const [y, m, dd] = d.split('-').map(Number); return y === y0 && (m === 10 || m === 11 || (m === 12 && dd <= 3)); });
  const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const games = new Map();
  const scan = async (list) => {
    const queue = [...list];
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        try { (await getScoreboard(lg, d.replace(/-/g, ''))).games.filter((g) => /nba cup.*group/i.test(g.note || '')).forEach((g) => games.set(g.id, g)); } catch { /* skip that night */ }
      }
    }));
  };
  // Group games are on Tuesday, Wednesday and Friday nights; look there first, then the other nights if any are missing.
  const likely = inWindow.filter((d) => [2, 3, 5].includes(dow(d)));
  await scan(likely);
  if (games.size && games.size < 60) await scan(inWindow.filter((d) => !likely.includes(d)));
  if (!games.size) return null;
  const list = [...games.values()];
  // Groups: teams joined by a group game end up together.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); };
  list.forEach((g) => { add(g.away.id); add(g.home.id); parent.set(find(g.away.id), find(g.home.id)); });
  const groups = new Map();
  for (const id of parent.keys()) groups.set(find(id), [...(groups.get(find(id)) || []), id]);
  const teamOf = new Map(list.flatMap((g) => [[g.away.id, g.away], [g.home.id, g.home]]));
  let confOf = new Map();
  try { (await getStandings(lg)).groups.forEach((gr) => gr.rows.forEach((r) => confOf.set(r.team.id, /east/i.test(gr.name) ? 'East' : /west/i.test(gr.name) ? 'West' : ''))); } catch { confOf = new Map(); }
  const done = list.filter((g) => g.state === 'final');
  const out = [...groups.values()].map((ids) => {
    const ranked = rankCupGroup(ids, done.filter((g) => ids.includes(g.away.id) && ids.includes(g.home.id)));
    const conf = confOf.get(ids[0]) || '';
    return { conf, ids, rows: ranked.map((r) => ({ ...r, team: teamOf.get(r.id) })) };
  });
  // Stable order: East then West, groups by their alphabetically first team.
  const first = (g) => [...g.rows.map((r) => r.team.name)].sort()[0];
  out.sort((a, b) => (a.conf === b.conf ? first(a).localeCompare(first(b)) : a.conf === 'East' ? -1 : 1));
  // The official group letters (the feed does not carry them), by Cup year. A year not listed gets numbers instead.
  const letters = CUP_GROUPS[y0];
  const letterOf = (g) => { const abbrs = new Set(g.rows.map((r) => String(r.team.abbr).toUpperCase())); return letters ? Object.keys(letters).find((k) => letters[k].some((a) => abbrs.has(a))) : null; };
  out.forEach((g) => { g.letter = letterOf(g); });
  if (out.every((g) => g.letter)) out.sort((a, b) => (a.conf === b.conf ? a.letter.localeCompare(b.letter) : a.conf === 'East' ? -1 : 1));
  const n = {};
  out.forEach((g) => { n[g.conf] = (n[g.conf] || 0) + 1; g.name = `${g.conf ? g.conf + ' · ' : ''}Group ${g.letter ? g.letter.slice(-1) : n[g.conf]}`; });
  // Who is in line for the knockout round: each group's leader, plus the best second-place team in each conference.
  out.forEach((g) => { if (g.rows[0]?.w + g.rows[0]?.l > 0) g.rows[0].tag = 'lead'; });
  ['East', 'West'].forEach((c) => {
    const seconds = out.filter((g) => g.conf === c && g.rows[1] && g.rows[1].w + g.rows[1].l > 0).map((g) => g.rows[1]);
    seconds.sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l) || b.pd - a.pd || b.pf - a.pf);
    if (seconds[0]) seconds[0].tag = 'wild';
  });
  const last = list.map((g) => String(g.date)).sort().pop();
  return { groups: out, played: done.length, total: list.length, last };
}

/* ---------- standings ---------- */
const stat = (entry, ...names) => {
  for (const n of names) {
    const s = (entry.stats || []).find((x) => x.name === n || x.type === n || x.abbreviation === n);
    if (s) return String(s.displayValue ?? s.summary ?? s.value ?? '');
  }
  return '';
};
// Hockey records come as "13-4-1, 27 PTS"; points have their own column, so keep just the record.
const recOnly = (r) => String(r || '').replace(/,\s*-?\d+\s*pts?$/i, '');
function overallOf(entry) {
  const o = recOnly(stat(entry, 'overall', 'total'));
  if (o) return o;
  const w = stat(entry, 'wins'), l = stat(entry, 'losses');
  if (!w && !l) return '';
  const t = stat(entry, 'ties', 'otLosses', 'draws');
  return [w || '0', l || '0', ...(t && t !== '0' ? [t] : [])].join('-');
}
function col2Of(entry, L) {
  if (L.sport === 'hockey' || L.sport === 'soccer') return ['PTS', stat(entry, 'points')];
  if (L.college) {
    // Conference record ("5-1"). Other stats mention "conference" too (games behind), so insist on a W-L value.
    const val = (x) => String(x.displayValue ?? x.summary ?? '');
    const isRec = (x) => /^\d+-\d+(-\d+)?$/.test(val(x));
    const all = entry.stats || [];
    const conf = all.find((x) => /^vs\.?\s*conf/i.test(x.name || x.type || '') && isRec(x))
      || all.find((x) => [x.name, x.displayName, x.type, x.shortDisplayName, x.abbreviation].some((n) => /conf/i.test(n || '')) && isRec(x));
    return ['CONF', conf ? val(conf) : ''];
  }
  return ['STREAK', stat(entry, 'streak')];
}
// Short names for standings headers: "American Football Conference" does not fit on a phone.
const GROUP_SHORT = {
  'american football conference': 'AFC', 'national football conference': 'NFC',
  'american league': 'AL', 'national league': 'NL',
  'atlantic coast conference': 'ACC', 'southeastern conference': 'SEC', 'mid-american conference': 'MAC',
  'american athletic conference': 'American', 'conference usa': 'CUSA', 'fbs independents': 'Independents',
  'eastern conference': 'East', 'western conference': 'West',
};
export function shortGroup(name) {
  const n = String(name || '').trim();
  const hit = GROUP_SHORT[n.toLowerCase()];
  if (hit) return hit;
  return n.replace(/^American Football Conference/i, 'AFC').replace(/^National Football Conference/i, 'NFC')
    .replace(/^American League/i, 'AL').replace(/^National League/i, 'NL')
    .replace(/\s+(Conference|Division)$/i, '');
}

function standingGroups(data, lg) {
  const L = LEAGUE[lg];
  const groups = [];
  // College conferences sometimes come split (SEC East / West, MAC East / West): fold those into one conference table.
  const all = (node) => [...(node.standings?.entries || []), ...(node.children || []).flatMap(all)];
  // The feed lists college teams by overall record; their conference finish is the "playoffSeed" stat.
  const seedOf = (e) => Number((e.stats || []).find((x) => x.type === 'playoffseed' || (x.name === 'playoffSeed' && !String(x.type || '').includes('_')))?.value ?? NaN);
  const recPct = (r) => { const [w = 0, l = 0, t = 0] = String(r || '').split('-').map(Number); const g = w + l + t; return g ? (w + t / 2) / g : -1; };
  const bySeed = (a, b) => (Number.isFinite(a.seed) && Number.isFinite(b.seed) ? a.seed - b.seed : 0) || recPct(b.col2) - recPct(a.col2) || recPct(b.overall) - recPct(a.overall);
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object') return;
    if (L.college && depth === 1 && !node.standings?.entries?.length && (node.children || []).some((c) => c.standings?.entries?.length)) {
      // Keep the divisions as sections inside the one conference table (East first, then West, as the feed orders them).
      const full = node.name || node.abbreviation || L.name;
      const confName = shortGroup(full);
      const subs = (node.children || []).filter((c) => c.standings?.entries?.length).map((c) => ({
        name: shortGroup(String(c.name || c.abbreviation || '')).replace(new RegExp('^' + confName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–]\\s*', 'i'), '').replace(/^.*\s[-–]\s/, ''),
        rows: all(c).map((e) => { const [, v] = col2Of(e, L); return { team: normTeam(e.team, lg), overall: overallOf(e), col2: v, seed: seedOf(e) }; })
          .sort(bySeed),
      }));
      const rows = subs.flatMap((x) => x.rows);
      if (rows.length) groups.push({ name: confName, full, col2Label: 'CONF', rows, subs });
      return;
    }
    const entries = node.standings?.entries;
    if (Array.isArray(entries) && entries.length) {
      let label = 'REC';
      const rows = entries.map((e) => {
        const [lab, v] = col2Of(e, L); label = lab;
        return { team: normTeam(e.team, lg), overall: overallOf(e), col2: v, seed: seedOf(e) };
      });
      // College always; pros when every team has a seed (the NBA feed sometimes lists a division worst to first).
      if (L.college || rows.every((r) => Number.isFinite(r.seed))) rows.sort(bySeed);
      const full = node.name || node.abbreviation || L.name;
      groups.push({ name: shortGroup(full), full, col2Label: label, rows });
    }
    (node.children || []).forEach((c) => walk(c, depth + 1));
  };
  walk(data);
  return groups;
}
const entryTeams = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  (node.standings?.entries || []).forEach((e) => out.push(e.team));
  (node.children || []).forEach((c) => entryTeams(c, out));
  return out;
};
// Pro leagues come grouped by conference; asking one level deeper gives divisions. Offer both when both exist.
// College divisions. The first is the default view. Group ids are the feed's; where unsure, several are tried in turn.
export const DIVISIONS = {
  cfb: [{ id: 'fbs', label: 'FBS', groups: [] }, { id: 'fcs', label: 'FCS', groups: ['81'] }, { id: 'd2', label: 'D-II', groups: ['57'] }, { id: 'd3', label: 'D-III', groups: ['58'] }],
  // College hoops: the feed only has Division I standings (checked live), so no dropdown there.
};
// Divisions whose teams the feed covers in full (rosters, player pages).
export const FULL_DIVISIONS = { cfb: ['fbs', 'fcs'], ncaam: ['d1'], ncaaw: ['d1'] };
const groupWorks = new Map(); // 'lg:div' -> the group id that answered
async function divisionRead(lg, div, season) {
  const d = (DIVISIONS[lg] || []).find((x) => x.id === div);
  const yr = season ? { season: String(season) } : {};
  if (!d || !d.groups.length) return get(url(V2, lg, '/standings', yr));
  const tries = groupWorks.has(`${lg}:${div}`) ? [groupWorks.get(`${lg}:${div}`)] : d.groups;
  for (const g of tries) {
    try {
      const data = await get(url(V2, lg, '/standings', { group: g, ...yr }));
      if (entryTeams(data).length) { groupWorks.set(`${lg}:${div}`, g); return data; }
    } catch { /* try the next id */ }
  }
  return { children: [] }; // the feed has no standings for this division
}
// season: the feed's season year (basketball and hockey count the year a season ends: 2027 = 2026-27). Empty = current.
export async function getStandings(lg, div, season) {
  const L = LEAGUE[lg];
  const yr = season ? { season: String(season) } : {};
  const [conf, div3] = await Promise.allSettled([
    L.college ? divisionRead(lg, div, season) : get(url(V2, lg, '/standings', yr)),
    L.college ? Promise.reject(new Error('skip')) : get(url(V2, lg, '/standings', { level: '3', ...yr })),
  ]);
  if (conf.status !== 'fulfilled') throw conf.reason;
  // Standings rows usually carry no team colors: pull the team list once so the chips are the real colors.
  if (entryTeams(conf.value).some((t) => !knowsColor(t, lg))) { try { await listTeams(lg); } catch { /* chips fall back */ } }
  const groups = standingGroups(conf.value, lg);
  const divisions = div3.status === 'fulfilled' ? standingGroups(div3.value, lg) : [];
  const views = divisions.length > groups.length
    ? [{ id: 'division', label: 'Division', groups: divisions }, { id: 'conference', label: groups.length > 1 ? 'Conference' : 'League', groups }]
    : [{ id: 'conference', label: 'Conference', groups }];
  // Seasons the feed keeps, newest first, for the year picker.
  const seasons = (conf.value.seasons || []).map((x) => ({ year: Number(x.year), label: String(x.seasonYears && L.sport !== 'football' && L.sport !== 'baseball' ? x.seasonYears : x.year) }))
    .filter((x) => x.year).sort((a, b) => b.year - a.year).slice(0, 15);
  return { lg, groups, views, seasons, season: Number(conf.value.children?.[0]?.standings?.season || conf.value.season?.year) || seasons[0]?.year || null };
}

/* ---------- teams ---------- */
// The feed's team list is flaky from browsers (the big-limit request can be refused), so try smaller asks,
// then fall back to the teams inside standings, which is a read we know works.
// The same data is served from a second address; some phones get the first one refused for this read.
const SITE_ALT = 'https://site.web.api.espn.com/apis/site/v2/sports';
let teamsParams = [[SITE, { limit: '1000' }], [SITE_ALT, { limit: '1000' }], [SITE_ALT, { limit: '400' }], [SITE, { limit: '400' }], [SITE_ALT, {}], [SITE, {}]];
const listMemo = new Map();
export function listTeams(lg) {
  if (!listMemo.has(lg)) {
    const p = (async () => {
      let lastErr = null;
      for (const params of teamsParams) {
        try {
          const [base, q] = params;
          const data = await get(url(base, lg, '/teams', q));
          const list = data.sports?.[0]?.leagues?.[0]?.teams || data.teams || [];
          const teams = list.map((x) => normTeam(x.team || x, lg)).filter((t) => t.id);
          if (teams.length) {
            teamsParams = [params, ...teamsParams.filter((q) => q !== params)]; // start with what worked next time
            teams.source = 'team list';
            return teams;
          }
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new FeedError('The team list came back empty.', 0);
    })();
    listMemo.set(lg, p);
    p.catch(() => listMemo.delete(lg)); // a failed read can be retried later
  }
  return listMemo.get(lg);
}
// Every team in a college league's lower divisions, from their standings (the only list of them we can reach).
export async function getDivisionTeams(lg) {
  const out = [], seen = new Set();
  for (const d of (DIVISIONS[lg] || []).slice(1)) {
    try {
      (await getStandings(lg, d.id)).groups.forEach((g) => g.rows.forEach((r) => { if (r.team.id && !seen.has(r.team.id)) { seen.add(r.team.id); out.push({ ...r.team, div: d.label }); } }));
    } catch { /* that division stays unsearchable */ }
  }
  return out;
}
export async function getTeams(lg) {
  let lastErr = null;
  try { return await listTeams(lg); } catch (e) { lastErr = e; }
  try {
    const seen = new Set();
    const teams = (await getStandings(lg)).groups.flatMap((g) => g.rows.map((r) => r.team)).filter((t) => t.id && !seen.has(t.id) && seen.add(t.id));
    if (teams.length) { teams.source = 'standings'; return teams; }
  } catch (e) { lastErr = lastErr || e; }
  if (lastErr) throw lastErr;
  return [];
}

// season: the feed's season year (empty = current). Postseason games (bowls, playoffs, tournaments) are a separate read.
export async function getTeam(lg, id, season) {
  const yr = season ? { season: String(season) } : {};
  const tid = encodeURIComponent(id);
  const [info, sched, post] = await Promise.allSettled([
    get(url(SITE, lg, `/teams/${tid}`)),
    get(url(SITE, lg, `/teams/${tid}/schedule`, yr)),
    get(url(SITE, lg, `/teams/${tid}/schedule`, { ...yr, seasontype: '3' })),
  ]);
  if (info.status === 'rejected' && sched.status === 'rejected') throw info.reason;
  // Once a season is over, the feed's default schedule is its postseason, which is empty for a team that missed it
  // (the Mets in November). Ask for the regular season by name then.
  if (sched.status === 'fulfilled' && Number(sched.value.season?.type) === 3) {
    try { const reg = await get(url(SITE, lg, `/teams/${tid}/schedule`, { ...yr, seasontype: '2' })); if (reg.events?.length) sched.value = { ...reg, season: sched.value.season, requestedSeason: sched.value.requestedSeason }; } catch { /* keep what we have */ }
  }
  const t = info.status === 'fulfilled' ? (info.value.team || {}) : (sched.value.team || {});
  const record = t.record?.items?.[0]?.summary || t.recordSummary || '';
  // The team read has no poll rank, but its next game carries the ranking the feed shows on scoreboards.
  const me = (t.nextEvent?.[0]?.competitions?.[0]?.competitors || []).find((c) => String(c.team?.id ?? c.id) === String(t.id ?? id));
  const rankNow = Number(me?.curatedRank?.current ?? me?.rank) || null;
  const seen = new Set();
  const events = [...(sched.status === 'fulfilled' ? (sched.value.events || []) : []), ...(post.status === 'fulfilled' ? (post.value.events || []) : [])]
    .filter((e) => e?.id && !seen.has(e.id) && seen.add(e.id));
  const schedule = events.map((e) => normEvent(e, lg)).filter((g) => g.id).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const current = Number(sched.status === 'fulfilled' && (sched.value.season?.year || sched.value.requestedSeason?.year)) || null;
  const shown = Number(sched.status === 'fulfilled' && sched.value.requestedSeason?.year) || current;
  // A past season: the team read only knows today's record, so count that season's from its finished games.
  let pastRecord = '';
  if (season && shown && season !== current) {
    let w = 0, l = 0, tie = 0;
    schedule.filter((g) => g.state === 'final').forEach((g) => {
      const mine = g.home.id === String(id) ? g.home : g.away, them = mine === g.home ? g.away : g.home;
      const a = Number(mine.score), b = Number(them.score);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return;
      if (a > b) w++; else if (a < b) l++; else tie++;
    });
    pastRecord = w + l + tie ? [w, l, ...(tie ? [tie] : [])].join('-') : '';
  }
  return {
    team: normTeam(t.id ? t : { ...t, id }, lg),
    record: String((season && season !== current ? pastRecord : record) || ''),
    rank: !season || season === current ? (rankNow && rankNow <= 25 ? rankNow : null) : null,
    // "20th in Div II/III" pools hundreds of schools and says little; keep it only for a top-25 spot.
    standing: season && season !== current ? '' : (() => { const v = cleanText(t.standingSummary || ''); const n = parseInt(v, 10); return /div(ision)?\.?\s*(ii|iii|2|3)\b/i.test(v) && !(n <= 25) ? '' : v; })(),
    schedule,
    scheduleMissing: sched.status === 'rejected',
    season: shown, currentSeason: current,
  };
}

/* ---------- one team's season stats and leaders ---------- */
// The feed sends dozens of team stats per group; these are the ones worth a glance, per sport.
const TEAM_STATS = {
  football: [['Offense', [['passing', 'totalPointsPerGame', 'Points / game'], ['passing', 'yardsPerGame', 'Yards / game'], ['passing', 'passingYardsPerGame', 'Pass yds / game'], ['rushing', 'rushingYardsPerGame', 'Rush yds / game'], ['passing', 'completionPct', 'Comp %'], ['rushing', 'yardsPerRushAttempt', 'Yds / rush'], ['passing', 'passingTouchdowns', 'Pass TD'], ['rushing', 'rushingTouchdowns', 'Rush TD']]],
    ['Defense', [['defensive', 'sacks', 'Sacks'], ['defensive', 'tacklesForLoss', 'TFL'], ['defensiveInterceptions', 'interceptions', 'INT'], ['general', 'fumblesRecovered', 'Fumbles rec'], ['defensive', 'passesDefended', 'Passes def']]],
    ['Situational', [['miscellaneous', 'thirdDownConvPct', '3rd down %'], ['miscellaneous', 'fourthDownConvPct', '4th down %'], ['miscellaneous', 'redzoneScoringPct', 'Red zone %'], ['miscellaneous', 'turnOverDifferential', 'TO margin'], ['miscellaneous', 'totalPenaltyYards', 'Penalty yds'], ['kicking', 'fieldGoalPct', 'FG %']]]],
  basketball: [['Offense', [['offensive', 'avgPoints', 'Points'], ['offensive', 'fieldGoalPct', 'FG %'], ['offensive', 'threePointFieldGoalPct', '3PT %'], ['offensive', 'freeThrowPct', 'FT %'], ['offensive', 'avgAssists', 'Assists'], ['offensive', 'avgTurnovers', 'Turnovers']]],
    ['Defense & boards', [['general', 'avgRebounds', 'Rebounds'], ['offensive', 'avgOffensiveRebounds', 'Off reb'], ['defensive', 'avgSteals', 'Steals'], ['defensive', 'avgBlocks', 'Blocks']]]],
  hockey: [['Offense', [['offensive', 'goals', 'Goals'], ['offensive', 'assists', 'Assists'], ['offensive', 'shootingPct', 'Shooting %'], ['offensive', 'powerPlayGoals', 'PP goals'], ['offensive', 'faceoffPercent', 'Faceoff %']]],
    ['Goaltending', [['defensive', 'avgGoalsAgainst', 'GAA'], ['defensive', 'savePct', 'Save %'], ['defensive', 'saves', 'Saves'], ['penalties', 'penaltyMinutes', 'PIM']]]],
  baseball: [['Batting', [['batting', 'avg', 'AVG'], ['batting', 'OPS', 'OPS'], ['batting', 'homeRuns', 'HR'], ['batting', 'runs', 'Runs'], ['batting', 'stolenBases', 'SB']]],
    ['Pitching', [['pitching', 'ERA', 'ERA'], ['pitching', 'WHIP', 'WHIP'], ['pitching', 'strikeouts', 'Strikeouts'], ['pitching', 'saves', 'Saves'], ['fielding', 'errors', 'Errors']]]],
};
export async function getTeamStatsFor(lg, id, season) {
  const L = LEAGUE[lg];
  const yr = season ? { season: String(season) } : {};
  const [st, ro] = await Promise.allSettled([
    get(url(SITE, lg, `/teams/${encodeURIComponent(id)}/statistics`, yr)),
    getRoster(lg, id),
  ]);
  const cats = st.status === 'fulfilled' ? (st.value.results?.stats?.categories || []) : [];
  const find = (c, n) => cats.find((x) => x.name === c)?.stats?.find((x) => x.name === n);
  const groups = (TEAM_STATS[L.sport] || []).map(([title, list]) => ({
    title,
    items: list.map(([c, n, label]) => { const x = find(c, n); if (!x) return null; const r = Number(x.rank) || Number(/^\d+/.exec(String(x.rankDisplayValue || ''))?.[0]) || 0;
      return { label, value: String(x.displayValue ?? ''), rank: r > 0 && r <= 150 ? r : 0 }; }).filter((x) => x && x.value),
  })).filter((g) => g.items.length);
  // Team leaders live in the feed's core service; its athletes are links, so names come from the roster.
  const year = Number(season || st.value?.requestedSeason?.year || st.value?.season?.year) || null;
  const who = new Map();
  if (ro.status === 'fulfilled') ro.value.groups.forEach((g) => g.players.forEach((p) => who.set(p.id, p)));
  let leaders = [];
  if (year) {
    try {
      const d = await get(`https://sports.core.api.espn.com/v2/sports/${L.sport}/leagues/${L.slug}/seasons/${year}/types/2/teams/${encodeURIComponent(id)}/leaders?lang=en&region=us`);
      const skip = /leader$|rating|^PER$|minutes|fouls|offensiveRebounds|defensiveRebounds/i;
      // Players who have moved on are not on today's roster: look those few up one by one.
      const ids = [...new Set((d.categories || []).filter((c) => !skip.test(c.name)).flatMap((c) => (c.leaders || []).slice(0, 3).map((l) => /athletes\/(\d+)/.exec(String(l.athlete?.$ref || ''))?.[1]).filter(Boolean)))];
      await Promise.allSettled(ids.filter((x) => !who.has(x)).slice(0, 30).map(async (x) => {
        const a = (await get(url(COMMON, lg, `/athletes/${x}`))).athlete || {};
        if (a.displayName) who.set(x, { id: x, name: cleanText(a.displayName), pos: a.position?.abbreviation || '', jersey: a.jersey ? String(a.jersey) : '' });
      }));
      leaders = (d.categories || []).filter((c) => !skip.test(c.name)).map((c) => {
        const top = (c.leaders || []).slice(0, 3).map((l) => {
          const pid = /athletes\/(\d+)/.exec(String(l.athlete?.$ref || ''))?.[1] || '';
          const p = who.get(pid);
          const n = Number(l.value); const dv = String(l.displayValue || ''); const whole = /double|triple/i.test(c.name) && Number.isFinite(n); // counts, not averages
          const v = whole ? String(Math.round(n)) : /^-?[\d.,]+$/.test(dv) ? dv : Number.isFinite(n) ? (Number.isInteger(n) ? n.toLocaleString('en-US') : (Math.round(n * 10) / 10).toString()) : dv;
          return { id: pid, name: p?.name || '', pos: p?.pos || '', jersey: p?.jersey || '', value: v, detail: whole ? '' : cleanText(l.displayValue || '') };
        }).filter((x) => x.name);
        const title = cleanText(c.displayName || c.name).replace(/^Average\s+/i, '').replace(/^(Average )?3-Point Field Goals Made( Per Game)?$/i, '3-Pointers Made Per Game').replace(/Field Goal Percentage/i, 'FG %').replace(/Free Throw Percentage/i, 'FT %').replace(/^Double Double$/i, 'Double-doubles');
        return { key: c.name, title, rows: top };
      }).filter((c) => c.rows.length);
    } catch { /* stats only */ }
  }
  return { groups, leaders };
}

// Every team's current overall record in a league, from the standings (all college divisions). id -> '8-1'
export async function getRecords(lg) {
  const divs = LEAGUE[lg]?.college ? (DIVISIONS[lg] || [{ id: undefined }]).map((d) => d.id) : [undefined];
  const out = {};
  const res = await Promise.allSettled(divs.map((d) => getStandings(lg, d)));
  res.forEach((r) => { if (r.status === 'fulfilled') r.value.groups.forEach((g) => g.rows.forEach((x) => { if (x.overall && !out[x.team.id]) out[x.team.id] = x.overall; })); });
  return out;
}

// Short team names (Minnesota, not Minnesota Timberwolves) by id, from the standings. Last-five lists only carry full names.
export async function getTeamNames(lg) {
  const out = {};
  try { (await getStandings(lg, DIVISIONS[lg]?.[0]?.id)).groups.forEach((g) => g.rows.forEach((r) => { out[r.team.id] = r.team.name; })); } catch { /* full names then */ }
  return out;
}

/* ---------- players ---------- */
const expOf = (a) => {
  const e = a?.experience;
  if (!e) return '';
  if (e.abbreviation) return String(e.abbreviation);
  if (e.displayValue) return String(e.displayValue);
  return e.years == null ? '' : e.years === 0 ? 'Rookie' : `${e.years} yr`;
};
function normPlayerLite(a, lg) {
  return {
    id: String(a?.id ?? ''), lg,
    name: cleanText(a?.displayName || a?.fullName || a?.shortName || ''),
    jersey: a?.jersey != null ? String(a.jersey) : '',
    pos: a?.position?.abbreviation || '',
    cls: expOf(a),
    ht: a?.displayHeight || '', wt: a?.displayWeight || '',
  };
}
const byJersey = (x, y) => (parseInt(x.jersey, 10) || 999) - (parseInt(y.jersey, 10) || 999) || x.name.localeCompare(y.name);
const GROUP_TITLE = { offense: 'Offense', defense: 'Defense', specialteam: 'Special Teams', specialteams: 'Special Teams', injuredreserveorout: 'Injured', practicesquad: 'Practice Squad' };

// A team's roster. Football comes grouped (offense, defense, special teams); most other sports come as one list.
export async function getRoster(lg, teamId) {
  const data = await get(url(SITE, lg, `/teams/${encodeURIComponent(teamId)}/roster`));
  const raw = data.athletes || [];
  const grouped = raw.length && Array.isArray(raw[0]?.items);
  const groups = (grouped ? raw : [{ position: 'Roster', items: raw }]).map((g) => {
    const key = String(g.position || g.name || 'Roster');
    return {
      title: GROUP_TITLE[key.toLowerCase().replace(/[^a-z]/g, '')] || key.replace(/^./, (c) => c.toUpperCase()),
      players: (g.items || []).map((a) => normPlayerLite(a, lg)).filter((p) => p.id && p.name).sort(byJersey),
    };
  }).filter((g) => g.players.length);
  return { lg, teamId: String(teamId), groups };
}

// Table titles sit in a narrow first column: "Season Averages" -> "Averages", "2026 Regular Season" -> "2026".
const shortTitle = (t) => cleanText(t).replace(/^(Season|Career)\s+/i, '').replace(/\s+(Regular\s+)?Season$/i, '').replace(/^Misc(ellaneous)?\s+Totals$/i, 'Misc').replace(/^Regular Season$/i, 'Season');
function normGamelog(d) {
  const labels = (d?.labels || []).map((l) => cleanText(l));
  const evs = d?.events || {};
  const spans = (d?.categories || []).filter((c) => c.count).map((c) => ({ title: cleanText(c.displayName || c.name || ''), count: c.count }));
  const seasons = (d?.seasonTypes || []).map((st) => {
    const rows = [];
    (st.categories || []).forEach((c) => (c.events || []).forEach((e) => {
      const ev = evs[e.eventId] || {};
      rows.push({
        id: String(e.eventId ?? ''), date: ev.gameDate || null,
        opp: ev.opponent?.abbreviation || ev.opponent?.displayName || '', at: ev.atVs || '',
        result: ev.gameResult || '', score: cleanText(ev.score || ''),
        stats: (e.stats || []).map((v) => String(v ?? '')),
      });
    }));
    const tot = st.summary?.stats?.find((x) => Array.isArray(x.stats))?.stats;
    return { title: shortTitle(st.displayName || ''), rows, totals: tot ? tot.map((v) => String(v ?? '')) : null };
  }).filter((x) => x.rows.length);
  // The seasons the feed can show this player's games for, newest first (its own season filter).
  const f = (d?.filters || []).find((x) => x.name === 'season');
  const years = (f?.options || []).map((o) => ({ value: String(o.value), label: cleanText(o.displayValue || String(o.value)) }));
  return { labels, spans: spans.reduce((n, x) => n + x.count, 0) === labels.length ? spans : [], seasons, years, year: f?.value ? String(f.value) : '' };
}
// One season of a player's game log.
export async function getGamelog(lg, id, season) {
  return normGamelog(await get(url(COMMON, lg, `/athletes/${encodeURIComponent(id)}/gamelog`, season ? { season: String(season) } : {})));
}
function normCareer(d) {
  return (d?.categories || []).map((c) => ({
    key: String(c.name || ''), title: shortTitle(c.displayName || c.name || ''),
    labels: (c.labels || []).map((l) => cleanText(l)),
    rows: (c.statistics || []).map((x) => ({
      year: Number(x.season?.year) || 0,
      season: String(x.season?.displayName || x.season?.year || ''),
      teamId: String(x.teamId ?? x.team?.id ?? ''), teamSlug: String(x.teamSlug || ''),
      team: String(x.team?.abbreviation || x.teamAbbreviation || '').toUpperCase(),
      stats: (x.stats || []).map((v) => String(v ?? '')),
    })).filter((r) => r.stats.length).sort((x, y) => x.year - y.year),
    totals: Array.isArray(c.totals) && c.totals.length ? c.totals.map((v) => String(v ?? '')) : null,
  })).filter((c) => c.rows.length && c.labels.length && !/misc/i.test(c.key + ' ' + c.title)); // the misc table is ejections, flagrants and ratings nobody asks for
}

// One player: who they are, this season, game by game, and the career. Any piece can be missing.
export async function getPlayer(lg, id) {
  const pid = encodeURIComponent(id);
  const [info, log, stats, core] = await Promise.allSettled([
    get(url(COMMON, lg, `/athletes/${pid}`)),
    get(url(COMMON, lg, `/athletes/${pid}/gamelog`)),
    get(url(COMMON, lg, `/athletes/${pid}/stats`)),
    get(`https://sports.core.api.espn.com/v2/sports/${LEAGUE[lg].sport}/leagues/${LEAGUE[lg].slug}/athletes/${pid}?lang=en&region=us`),
  ]);
  // The feed links a pro to his college page and back. { lg, id, kind: 'college' | 'pro' } when the other page is one we cover.
  let other = null;
  if (core.status === 'fulfilled') {
    const kind = core.value.collegeAthlete ? 'college' : core.value.proAthlete ? 'pro' : '';
    const m = /leagues\/([^/]+)\/athletes\/(\d+)/.exec(String(core.value[kind + 'Athlete']?.$ref || ''));
    const to = m && Object.values(LEAGUE).find((L) => L.slug === m[1]);
    if (to && to.id !== lg) other = { lg: to.id, id: m[2], kind };
  }
  if (info.status === 'rejected' && log.status === 'rejected' && stats.status === 'rejected') throw info.reason;
  const a = info.status === 'fulfilled' ? (info.value.athlete || info.value || {}) : {};
  // Name the team for each career season (a transfer's old school). The stats read may list its teams;
  // if not, the league's team list knows every id.
  // Football's scoring table only repeats the touchdowns already in passing, rushing and receiving: leave it out.
  const career = (stats.status === 'fulfilled' ? normCareer(stats.value) : []).filter((c) => !(LEAGUE[lg]?.sport === 'football' && /scoring/i.test(c.key + ' ' + c.title)));
  const need = career.flatMap((c) => c.rows).filter((r) => !r.team && r.teamId);
  if (need.length) {
    const known = new Map();
    const tv = stats.value.teams;
    (Array.isArray(tv) ? tv : Object.entries(tv || {}).map(([k, v]) => ({ id: k, ...v }))).forEach((t) => { if (t?.abbreviation) known.set(String(t.id), String(t.abbreviation).toUpperCase()); });
    if (need.some((r) => !known.has(r.teamId))) { try { (await listTeams(lg)).forEach((t) => { if (!known.has(t.id)) known.set(t.id, t.abbr); }); } catch { /* fall through to the slug */ } }
    need.forEach((r) => { r.team = known.get(r.teamId) || r.teamSlug.split('-')[0].slice(0, 8).toUpperCase(); });
  }
  const sum = a.statsSummary || {};
  const born = a.displayBirthPlace || [a.birthPlace?.city, a.birthPlace?.state || a.birthPlace?.country].filter(Boolean).join(', ');
  return {
    player: {
      ...normPlayerLite({ ...a, id: a.id ?? id }, lg),
      posName: a.position?.displayName || '',
      team: a.team?.id ? normTeam(a.team, lg) : null,
      from: cleanText(born || ''),
      status: cleanText(a.status?.name && a.status.type !== 'active' ? a.status.name : ''),
    },
    summary: {
      title: cleanText(sum.displayName || ''),
      // The feed ranks each headline stat against the league ("12th"). Show it when they are in the top 150.
      items: (sum.statistics || []).map((x) => {
        const rank = Number(x.rank) || Number(/^(\d+)/.exec(String(x.rankDisplayValue || ''))?.[1]) || 0;
        return { label: cleanText(x.abbreviation || x.shortDisplayName || x.displayName || ''), value: String(x.displayValue ?? ''), rank: rank > 0 && rank <= 150 ? rank : 0, tied: /^T/i.test(String(x.rankDisplayValue || '')) };
      }).filter((x) => x.label && x.value).slice(0, 4),
    },
    gamelog: log.status === 'fulfilled' ? normGamelog(log.value) : { labels: [], spans: [], seasons: [] },
    career, other,
    missing: { info: info.status === 'rejected', gamelog: log.status === 'rejected', career: stats.status === 'rejected' },
  };
}

// Plus-minus for one whole game from its summary, for feeds that do not send it (college hoops). { athleteId: n } or null.
export function plusMinusFromSummary(d) {
  const comp = d?.header?.competitions?.[0];
  const side = (k) => String((comp?.competitors || []).find((c) => c.homeAway === k)?.team?.id ?? (comp?.competitors || []).find((c) => c.homeAway === k)?.id ?? '');
  const awayId = side('away'), homeId = side('home');
  if (!awayId || !homeId) return null;
  return plusMinusFromPlays(d.plays, startersOf(d.boxscore, [awayId, homeId]), awayId, homeId);
}

// Plus-minus for hoops players. The player feeds leave it out, so pros get it from the core service (the season total,
// plus one small read per game for the game log). College works it out from each game's play-by-play.
export const hasPlusMinus = (lg) => LEAGUE[lg]?.sport === 'basketball';
export const signed = (n) => (n > 0 ? `+${n}` : String(n));
// A finished game's plus-minus never changes, so keep it on the phone: the next page from that game is instant.
const pmCache = {
  get(k) { try { const v = localStorage.getItem('fr.pm2.' + k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem('fr.pm2.' + k, JSON.stringify(v)); } catch { /* storage full or blocked: just refetch next time */ } },
};
// One game's plus-minus from its play-by-play, plus who each player is: { pm: {id: n}, who: {id: [name, pos, jersey, teamId]} }.
async function gamePlusMinus(lg, eid) {
  const hit = pmCache.get(`${lg}.${eid}`);
  if (hit) return hit;
  const d = await get(url(SITE, lg, '/summary', { event: eid }));
  const pm = plusMinusFromSummary(d);
  if (!pm) return null;
  const who = {};
  (d.boxscore?.players || []).forEach((t) => (t.statistics?.[0]?.athletes || []).forEach((a) => {
    const x = a.athlete || {};
    if (x.id != null && !a.didNotPlay) who[String(x.id)] = [cleanText(x.displayName || x.shortName || ''), x.position?.abbreviation || '', x.jersey != null ? String(x.jersey) : '', String(t.team?.id ?? '')];
  }));
  const out = { pm, who };
  if (d.header?.competitions?.[0]?.status?.type?.completed) pmCache.set(`${lg}.${eid}`, out);
  return out;
}
// Run jobs a few at a time.
async function inBatches(list, n, fn) {
  const queue = [...list];
  await Promise.all(Array.from({ length: n }, async () => { for (let x = queue.shift(); x !== undefined; x = queue.shift()) { try { await fn(x); } catch { /* skip that one */ } } }));
}
// College: work it out from each game's play-by-play, for every game in this season's log.
async function collegePlusMinus(lg, id) {
  const pid = encodeURIComponent(id);
  const log = await get(url(COMMON, lg, `/athletes/${pid}/gamelog`));
  const ids = [...new Set((log.seasonTypes || []).flatMap((st) => (st.categories || []).flatMap((c) => (c.events || []).map((e) => String(e.eventId ?? '')))).filter(Boolean))];
  const games = {};
  await inBatches(ids, 6, async (eid) => { const g = await gamePlusMinus(lg, eid); if (g && g.who[String(id)]) games[eid] = g.pm[String(id)] ?? 0; });
  const vals = Object.values(games);
  return { year: null, total: vals.length ? vals.reduce((n, v) => n + v, 0) : null, games, n: vals.length };
}
// A team's plus-minus leaders for a season, per game, as a Team Leaders category. Players need half the team's games.
export async function getTeamPlusMinus(lg, teamId, season) {
  const L = LEAGUE[lg];
  const tid = String(teamId);
  const tally = new Map(); // id -> { total, gp, name, pos, jersey }
  let teamGames = 0;
  if (L.college) {
    const sched = await get(url(SITE, lg, `/teams/${encodeURIComponent(tid)}/schedule`, season ? { season: String(season) } : {}));
    const ids = (sched.events || []).filter((e) => e.competitions?.[0]?.status?.type?.completed).map((e) => String(e.id));
    await inBatches(ids, 6, async (eid) => {
      const g = await gamePlusMinus(lg, eid);
      if (!g) return;
      teamGames++;
      Object.entries(g.who).forEach(([pid, [name, pos, jersey, t]]) => {
        if (t !== tid) return;
        const r = tally.get(pid) || { total: 0, gp: 0, name, pos, jersey };
        r.total += g.pm[pid] ?? 0; r.gp++; tally.set(pid, r);
      });
    });
  } else {
    const base = `https://sports.core.api.espn.com/v2/sports/${L.sport}/leagues/${L.slug}`;
    const yr = Number(season) || null;
    if (!yr) return null;
    const roster = await getRoster(lg, tid);
    const players = roster.groups.flatMap((g) => g.players);
    await inBatches(players, 8, async (p) => {
      const d = await get(`${base}/seasons/${yr}/types/2/athletes/${encodeURIComponent(p.id)}/statistics?lang=en&region=us`);
      let pm = null, gp = 0;
      for (const c of d?.splits?.categories || []) for (const x of c.stats || []) { if (x.name === 'plusMinus') pm = Number(x.value); if (x.name === 'gamesPlayed') gp = Number(x.value) || gp; }
      if (Number.isFinite(pm) && gp) { tally.set(p.id, { total: pm, gp, name: p.name, pos: p.pos, jersey: p.jersey }); teamGames = Math.max(teamGames, gp); }
    });
  }
  const need = Math.max(1, Math.ceil(teamGames / 2));
  const rows = [...tally.entries()].filter(([, r]) => r.gp >= need && r.name).map(([pid, r]) => ({ id: pid, name: r.name, pos: r.pos, jersey: r.jersey, avg: r.total / r.gp, total: r.total }))
    .sort((a, b) => b.avg - a.avg || b.total - a.total).slice(0, 3)
    .map((r) => ({ id: r.id, name: r.name, pos: r.pos, jersey: r.jersey, value: signed(Math.round(r.avg * 10) / 10), detail: `${signed(r.total)} total` }));
  return rows.length ? { key: 'plusMinus', title: '+/- Per Game', rows } : null;
}
export async function getPlusMinus(lg, id) {
  const L = LEAGUE[lg];
  if (L.college) return collegePlusMinus(lg, id);
  const base = `https://sports.core.api.espn.com/v2/sports/${L.sport}/leagues/${L.slug}`;
  const pid = encodeURIComponent(id);
  const log = await get(`${base}/athletes/${pid}/eventlog?limit=200&lang=en&region=us`);
  const year = Number(/seasons\/(\d{4})/.exec(String(log.$ref || ''))?.[1]) || null;
  const items = (log.events?.items || []).filter((x) => x.played && x.statistics?.$ref);
  const pmOf = (d) => { for (const c of d?.splits?.categories || []) for (const x of c.stats || []) if (x.name === 'plusMinus') return Number(x.value); return null; };
  const games = {};
  // The season total and the games load side by side; a few games at a time, so a full season does not fire 80 reads at once.
  const totalP = year ? get(`${base}/seasons/${year}/types/2/athletes/${pid}/statistics?lang=en&region=us`).then(pmOf, () => null) : Promise.resolve(null);
  const queue = [...items];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      try {
        const eid = /events\/(\d+)/.exec(String(x.event?.$ref || ''))?.[1];
        const v = pmOf(await get(String(x.statistics.$ref).replace(/^http:/, 'https:')));
        if (eid && Number.isFinite(v)) games[eid] = v;
      } catch { /* that game stays blank */ }
    }
  }));
  let total = await totalP;
  // No season read: add up the games instead.
  if (!Number.isFinite(total) && Object.keys(games).length) total = Object.values(games).reduce((n, v) => n + v, 0);
  return { year, total: Number.isFinite(total) ? total : null, games };
}

// Player search across every league the app covers. The feed's own search, asked as you type.
const LEAGUE_NUM = { 28: 'nfl', 23: 'cfb', 46: 'nba', 90: 'nhl', 10: 'mlb', 41: 'ncaam', 54: 'ncaaw', 59: 'wnba', 700: 'epl', 770: 'mls' };
export async function searchPlayers(text) {
  const q = new URLSearchParams({ query: text, limit: '25', type: 'player' }).toString();
  const data = await get(`${SEARCH}?${q}`);
  const items = data.items || data.results?.flatMap((r) => r.contents || r.items || []) || [];
  const out = [], seen = new Set();
  for (const it of items) {
    if (it.type && it.type !== 'player') continue;
    const slug = typeof it.league === 'string' ? it.league : it.league?.slug || it.defaultLeagueSlug || '';
    const num = /~l:(\d+)/.exec(String(it.uid || ''))?.[1];
    const lg = LEAGUES.find((l) => l.slug === slug)?.id || LEAGUE_NUM[num];
    const id = String(it.id ?? /~a:(\d+)/.exec(String(it.uid || ''))?.[1] ?? '');
    if (!lg || !id || seen.has(lg + id)) continue;
    seen.add(lg + id);
    const rel = (it.teamRelationships || [])[0];
    out.push({ id, lg, name: cleanText(it.displayName || it.name || ''), team: cleanText(rel?.displayName || rel?.core?.displayName || it.subtitle || it.description || '') });
  }
  return out.filter((p) => p.name);
}

/* ---------- college polls ---------- */
// Polls in the order fans care about: the Playoff committee when it is out, then AP, then Coaches.
const POLL_ORDER = (p) => (/playoff|cfp/i.test(p.name + p.type) ? 0 : /\bap\b/i.test(p.name + ' ' + p.type) ? 1 : /coach|usa/i.test(p.name + p.type) ? 2 : 3);
// When a poll came out. The feed has used several field names for this, at the poll and at the top level.
const okDate = (v) => (v && !isNaN(new Date(v)) ? String(v) : null);
const releasedOf = (p, d) => okDate(p.date) || okDate(p.lastUpdated) || okDate(p.releaseDate) || okDate(p.occurrence?.date)
  || okDate(p.occurrence?.lastUpdated) || okDate(d?.date) || okDate(d?.lastUpdated) || null;
function normPolls(d, lg) {
  const team = (r) => normTeam({ ...(r.team || {}), id: r.team?.id ?? r.id }, lg);
  return (d?.rankings || []).map((p) => ({
    id: String(p.id ?? p.type ?? p.name ?? ''),
    name: cleanText(p.shortName || p.name || 'Poll'),
    full: cleanText(p.name || p.shortName || 'Poll'),
    type: String(p.type || ''),
    week: Number(p.occurrence?.number) || 0,
    released: releasedOf(p, d), // when this poll came out
    note: cleanText(p.occurrence?.displayValue || p.headline || ''),
    ranks: (p.ranks || []).map((r) => {
      const cur = Number(r.current), prev = Number(r.previous);
      return {
        rank: cur, team: team(r),
        record: String(r.recordSummary || r.team?.record || ''),
        points: Number(r.points) || 0, firstPlace: Number(r.firstPlaceVotes) || 0,
        move: !prev ? 'new' : prev === cur ? 0 : prev - cur, // positive = climbed
      };
    }).filter((r) => r.rank && r.team.id).sort((a, b) => a.rank - b.rank),
    others: (p.others || []).map((r) => ({ team: team(r), points: Number(r.points) || 0 })).filter((r) => r.team.id && r.points).sort((a, b) => b.points - a.points),
    dropped: (p.droppedOut || []).map((r) => team(r)).filter((t) => t.id),
  })).filter((p) => p.ranks.length);
}
const isPlayoff = (p) => /playoff|cfp/i.test(p.name + p.full + p.type);
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football';
async function coreCfp(d, polls) {
  const week = Math.max(Number(d.latestWeek?.number) || 0, ...polls.map((p) => p.week));
  const now = new Date();
  const season = Number(d.latestSeason?.year || d.season?.year) || (now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear());
  if (!week) return null;
  let names = null;
  for (const w of [week + 1, week, week - 1, week - 2]) {
    if (w < 1) continue;
    let r;
    try { r = await get(`${CORE}/seasons/${season}/types/2/weeks/${w}/rankings/21?lang=en&region=us`); } catch { continue; }
    if (!Array.isArray(r?.ranks) || !r.ranks.length) continue;
    if (!names) {
      names = new Map();
      try { (await getStandings('cfb')).groups.forEach((g) => g.rows.forEach((x) => names.set(x.team.id, x.team))); } catch { /* ids only */ }
    }
    const idOf = (x) => String(x?.team?.id ?? /\/teams\/(\d+)/.exec(String(x?.team?.$ref || ''))?.[1] ?? '');
    const ranks = r.ranks.map((x) => {
      const id = idOf(x), known = names.get(id), cur = Number(x.current), prev = Number(x.previous);
      const team = known || normTeam({ id, displayName: `Team ${id}`, abbreviation: '' }, 'cfb');
      return { rank: cur, team, record: String(x.record?.summary || x.recordSummary || ''), points: 0, firstPlace: 0, move: !prev ? 'new' : prev === cur ? 0 : prev - cur };
    }).filter((x) => x.rank && x.team.id).sort((a, b) => a.rank - b.rank);
    if (!ranks.length) continue;
    return {
      id: '21', name: 'CFP Rankings', full: cleanText(r.name || 'College Football Playoff Rankings'), type: 'cfp',
      week: w, note: cleanText(r.occurrence?.displayValue || `Week ${w}`), released: releasedOf(r, null),
      ranks, others: [], dropped: [],
    };
  }
  return null;
}
export async function getRankings(lg) {
  const d = await get(url(SITE, lg, '/rankings'));
  const polls = normPolls(d, lg);
  // The site feed often leaves the committee's ranking out. The feed's core service keeps every week of it (poll 21),
  // with teams as links, so names come from the standings. Try this week, then the weeks before it.
  if (lg === 'cfb' && polls.length && !polls.some(isPlayoff)) {
    try { const cfp = await coreCfp(d, polls); if (cfp) polls.push(cfp); } catch { /* the polls still show */ }
  }
  polls.sort((a, b) => POLL_ORDER(a) - POLL_ORDER(b));
  return { lg, polls };
}

/* ---------- league stats: leaders and team tables ---------- */
// Deep lists for one leader category, from the feed's per-stat leaderboard (hundreds deep, checked live).
// Each leader category maps to [stat group, stat name, category the feed wants filled] (formats checked live). Percentages and goalie
// rates are left out on purpose: that board does not apply minimums, so a 1-for-1 shooter would lead.
const DEEP = {
  football: {
    passingYards: ['passing', 'passingYards', 'offense:passing'], passingTouchdowns: ['passing', 'passingTouchdowns', 'offense:passing'], quarterbackRating: ['passing', 'QBRating', 'offense:passing'],
    rushingYards: ['rushing', 'rushingYards', 'offense:rushing'], rushingTouchdowns: ['rushing', 'rushingTouchdowns', 'offense:rushing'],
    receivingYards: ['receiving', 'receivingYards', 'offense:receiving'], receptions: ['receiving', 'receptions', 'offense:receiving'], receivingTouchdowns: ['receiving', 'receivingTouchdowns', 'offense:receiving'],
    sacks: ['defensive', 'sacks', 'defense'], totalTackles: ['defensive', 'totalTackles', 'defense'], passesDefended: ['defensive', 'passesDefended', 'defense'],
    totalPoints: ['scoring', 'totalPoints', 'scoring'],
  },
  basketball: {
    pointsPerGame: ['offensive', 'avgPoints'], assistsPerGame: ['offensive', 'avgAssists'], reboundsPerGame: ['general', 'avgRebounds'],
    stealsPerGame: ['defensive', 'avgSteals'], blocksPerGame: ['defensive', 'avgBlocks'], '3PointsMadePerGame': ['offensive', 'avgThreePointFieldGoalsMade'],
    minutesPerGame: ['general', 'avgMinutes'], doubleDouble: ['general', 'doubleDouble'], points: ['offensive', 'points'], avgTurnovers: ['offensive', 'avgTurnovers'], foulsPerGame: ['general', 'avgFouls'],
  },
  hockey: {
    goals: ['offensive', 'goals'], assists: ['offensive', 'assists'], points: ['offensive', 'points'], plusMinus: ['general', 'plusMinus'],
    penaltyMinutes: ['penalties', 'penaltyMinutes'], wins: ['general', 'wins'], shutouts: ['defensive', 'shutouts'],
  },
};
export const canGoDeep = (lg, key) => !!DEEP[LEAGUE[lg]?.sport]?.[key];
export async function getDeepLeader(lg, key) {
  const m = DEEP[LEAGUE[lg]?.sport]?.[key];
  if (!m) return null;
  const [group, stat, cat] = m;
  const d = await get(url(COMMON, lg, '/statistics/byathlete', { sort: `${group}.${stat}:desc`, limit: LEAGUE[lg].college ? '300' : '150', ...(cat ? { category: cat } : {}) }));
  const idx = (d.categories || []).find((c) => c.name === group)?.names?.indexOf(stat) ?? -1;
  if (idx < 0) return null;
  return (d.athletes || []).map((x) => {
    const a = x.athlete || {};
    const v = String((x.categories || []).find((c) => c.name === group)?.totals?.[idx] ?? '');
    return {
      value: v,
      player: { id: String(a.id ?? ''), name: cleanText(a.displayName || ''), pos: a.position?.abbreviation || '' },
      team: a.teamId ? normTeam({ id: a.teamId, abbreviation: a.teamShortName, displayName: a.teamName, shortDisplayName: a.teamShortName }, lg) : null,
    };
  }).filter((r) => r.value && r.value !== '-' && r.value !== '0' && r.player.name);
}

const SITE3 = 'https://site.api.espn.com/apis/site/v3/sports';
// Who leads the league in each stat. The feed has moved this around, so try each place it has lived.
// The feed's display text rounds half sacks away ("8" for 8.5), so trust the number when it has a fraction.
function leaderValue(l) {
  const shown = String(l.displayValue ?? l.value ?? '');
  const n = Number(l.value);
  if (/^\d+$/.test(shown) && Number.isFinite(n)) {
    if (!Number.isInteger(n)) return String(Math.round(n * 10) / 10);
    if (n >= 1000) return n.toLocaleString('en-US');
  }
  return shown;
}
// The feed's PER board is broken (all zeros in college, a copy of FG% in the NBA), so it is left out.
const LEADER_SKIP = /^PER$/i;
// Plainer names than the feed's ("3 points field goal percentage").
const LEADER_TITLE = {
  fieldGoalPercentage: 'Field Goal %', FreeThrowPct: 'Free Throw %', '3PointPct': '3-Point %', '3PointsMadePerGame': '3-Pointers Made Per Game',
  doubleDouble: 'Double-Doubles', tripleDouble: 'Triple-Doubles', foulsPerGame: 'Fouls Per Game',
};
// Qualified shooting leaders. To count, a player needs the attempts per game below and at least half the games
// of the busiest player. Read from the per-player board sorted by minutes, which holds every rotation player.
const SHOOT_MIN = [['fieldGoalPercentage', 'fieldGoalPct', 'avgFieldGoalsAttempted', 5], ['3PointPct', 'threePointFieldGoalPct', 'avgThreePointFieldGoalsAttempted', 2], ['FreeThrowPct', 'freeThrowPct', 'avgFreeThrowsAttempted', 2]];
async function qualifiedShooting(lg) {
  const d = await get(url(COMMON, lg, '/statistics/byathlete', { sort: 'general.avgMinutes:desc', limit: '500' }));
  const names = (g) => (d.categories || []).find((c) => c.name === g)?.names || [];
  const gen = names('general'), off = names('offensive');
  const val = (x, g, list, n) => { const i = list.indexOf(n); return i < 0 ? NaN : Number((x.categories || []).find((c) => c.name === g)?.totals?.[i]); };
  const athletes = d.athletes || [];
  const most = Math.max(0, ...athletes.map((x) => val(x, 'general', gen, 'gamesPlayed')).filter(Number.isFinite));
  const out = {};
  for (const [key, pct, att, min] of SHOOT_MIN) {
    if (off.indexOf(pct) < 0 || off.indexOf(att) < 0) continue;
    out[key] = athletes.filter((x) => val(x, 'offensive', off, att) >= min && val(x, 'general', gen, 'gamesPlayed') >= Math.ceil(most / 2))
      .map((x) => ({ x, v: val(x, 'offensive', off, pct) })).filter((r) => Number.isFinite(r.v))
      .sort((a, b) => b.v - a.v).slice(0, 100)
      .map(({ x, v }) => {
        const a = x.athlete || {};
        return {
          value: (v <= 1 ? v * 100 : v).toFixed(1),
          player: { id: String(a.id ?? ''), name: cleanText(a.displayName || ''), pos: a.position?.abbreviation || '' },
          team: a.teamId ? normTeam({ id: a.teamId, abbreviation: a.teamShortName, displayName: a.teamName, shortDisplayName: a.teamShortName }, lg) : null,
        };
      }).filter((r) => r.player.name);
  }
  return out;
}
export async function getLeaders(lg) {
  const tries = [[SITE3, '/leaders'], [SITE, '/leaders'], [SITE, '/statistics']];
  let lastErr = null;
  for (const [base, path] of tries) {
    try {
      const d = await get(url(base, lg, path)); // no limit param: the feed errors on it (checked live)
      const raw = d.leaders?.categories || d.categories || d.stats || d.leaders || [];
      const cats = (Array.isArray(raw) ? raw : []).filter((c) => !LEADER_SKIP.test(String(c.name || ''))).map((c) => ({
        key: String(c.name || c.abbreviation || c.displayName || ''),
        title: LEADER_TITLE[String(c.name || '')] || cleanText(c.displayName || c.shortDisplayName || c.name || ''),
        abbr: cleanText(c.abbreviation || c.shortDisplayName || ''),
        rows: (c.leaders || []).map((l) => {
          const a = l.athlete || null, t = l.team || a?.team || null;
          const n = Number(l.value), nm = String(c.name || '');
          // Some percentage boards come as fractions (0.778); show them like the rest (77.8).
          const pct = /pct|percent/i.test(nm) && Number.isFinite(n) && n <= 1 && /^-?\d*\.?\d+$/.test(String(l.displayValue ?? '').trim()) && Number(l.displayValue) <= 1;
          return {
            value: /double|triple/i.test(nm) && Number.isFinite(n) ? String(Math.round(n)) : pct ? (n * 100).toFixed(1) : leaderValue(l),
            player: a ? { id: String(a.id ?? ''), name: cleanText(a.displayName || a.fullName || a.shortName || ''), pos: a.position?.abbreviation || '' } : null,
            team: t?.id ? normTeam(t, lg) : null,
          };
        }).filter((r) => r.value && (r.player?.name || r.team)),
      })).filter((c) => c.title && c.rows.length);
      // Kickoff yards is noise: drop it. Other special-teams lists go to the bottom.
      const niche = (c) => /punt|return|kick|field goal/i.test(c.title + ' ' + c.key);
      // Hoops: total points just repeats the points-per-game list, so it goes.
      const hoops = LEAGUE[lg]?.sport === 'basketball';
      const kept = cats.filter((c) => !/kickoff/i.test(c.title + ' ' + c.key) && !(hoops && c.key === 'points'));
      if (kept.length && LEAGUE[lg]?.sport === 'basketball') {
        // Shooting percentages: the feed's board has no minimum, so a 1-for-1 shooter leads. Rebuild those lists from qualified shooters.
        try {
          const q = await qualifiedShooting(lg);
          kept.forEach((c) => { if (q[c.key]?.length) c.rows = q[c.key]; });
        } catch { /* keep the feed's lists */ }
      }
      if (kept.length) return { lg, cats: [...kept.filter((c) => !niche(c)), ...kept.filter(niche)] };
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return { lg, cats: [] };
}

// League plus-minus leaders, per game (pro hoops). The feed has no +/- board, so read each rotation player's season line:
// 15+ minutes a game and at least half the games of the busiest player. About 260 small reads, done 12 at a time.
export const hasLeaguePlusMinus = (lg) => hasPlusMinus(lg) && !LEAGUE[lg]?.college;
export async function getLeaguePlusMinus(lg) {
  if (!hasLeaguePlusMinus(lg)) return null;
  const L = LEAGUE[lg];
  const base = `https://sports.core.api.espn.com/v2/sports/${L.sport}/leagues/${L.slug}`;
  const [lgInfo, d] = await Promise.all([get(`${base}?lang=en&region=us`), get(url(COMMON, lg, '/statistics/byathlete', { sort: 'general.avgMinutes:desc', limit: '500' }))]);
  const yr = Number(lgInfo?.season?.year);
  if (!yr) return null;
  const gen = (d.categories || []).find((c) => c.name === 'general')?.names || [];
  const val = (x, n) => { const i = gen.indexOf(n); return i < 0 ? NaN : Number((x.categories || []).find((c) => c.name === 'general')?.totals?.[i]); };
  const athletes = d.athletes || [];
  const most = Math.max(0, ...athletes.map((x) => val(x, 'gamesPlayed')).filter(Number.isFinite));
  const pool = athletes.filter((x) => val(x, 'avgMinutes') >= 15 && val(x, 'gamesPlayed') >= Math.ceil(most / 2) && x.athlete?.id);
  const out = [];
  await inBatches(pool, 12, async (x) => {
    const a = x.athlete;
    const s = await get(`${base}/seasons/${yr}/types/2/athletes/${encodeURIComponent(a.id)}/statistics?lang=en&region=us`);
    let pm = null, gp = 0;
    for (const c of s?.splits?.categories || []) for (const st of c.stats || []) { if (st.name === 'plusMinus') pm = Number(st.value); if (st.name === 'gamesPlayed') gp = Number(st.value) || gp; }
    if (!Number.isFinite(pm) || !gp) return;
    out.push({
      avg: pm / gp, total: pm,
      player: { id: String(a.id), name: cleanText(a.displayName || ''), pos: a.position?.abbreviation || '' },
      team: a.teamId ? normTeam({ id: a.teamId, abbreviation: a.teamShortName, displayName: a.teamName, shortDisplayName: a.teamShortName }, lg) : null,
    });
  });
  const rows = out.filter((r) => r.player.name).sort((a, b) => b.avg - a.avg || b.total - a.total).slice(0, 100)
    .map((r) => ({ value: signed(Math.round(r.avg * 10) / 10), player: r.player, team: r.team }));
  return rows.length ? { key: 'plusMinus', title: '+/- Per Game', abbr: '+/-', rows } : null;
}

// Every team's season numbers, one table per stat group (passing, rushing, defense...).
export async function getTeamStats(lg) {
  const d = await get(url(COMMON, lg, '/statistics/byteam', { region: 'us', lang: 'en', contentorigin: 'espn', limit: '400' }));
  const cats = (d.categories || []).map((c) => ({
    key: String(c.name || ''), title: cleanText(c.displayName || c.name || ''),
    labels: (c.labels || c.names || []).map((l) => cleanText(l)),
    names: (c.displayNames || c.names || []).map((l) => cleanText(l)),
  })).filter((c) => c.key && c.labels.length);
  const teams = (d.teams || []).map((t) => {
    const stats = {};
    (t.categories || []).forEach((c) => { const v = c.totals || c.displayValues || c.values; if (Array.isArray(v)) stats[String(c.name || '')] = v.map((x) => { const t = String(x ?? ''); return /^-?\d+\.\d{3,}$/.test(t) ? String(Math.round(Number(t) * 10) / 10) : t; }); }); // raw numbers come with long tails, so trim them
    return { team: normTeam(t.team || {}, lg), stats };
  }).filter((t) => t.team.id);
  return { lg, cats: cats.filter((c) => teams.some((t) => t.stats[c.key]?.length)), teams };
}

/* ---------- one game ---------- */
// Which box-score rows we show, in order, and what we call them. Labels match the plain-English tips.
const STAT_PICKS = {
  football: [['totalYards', 'Total yards'], ['netPassingYards', 'Passing yards'], ['rushingYards', 'Rushing yards'], ['thirdDownEff', '3rd down'], ['fourthDownEff', '4th down'], ['turnovers', 'Turnovers'], ['possessionTime', 'Time of possession']],
  basketball: [['fieldGoalsMade-fieldGoalsAttempted', 'Field goals'], ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3-pointers'], ['freeThrowsMade-freeThrowsAttempted', 'Free throws'], ['totalRebounds', 'Rebounds'], ['assists', 'Assists'], ['turnovers', 'Turnovers'], ['fouls', 'Fouls']],
  hockey: [['shotsTotal', 'Shots on goal'], ['powerPlayGoals', 'Power play goals'], ['faceoffsWon', 'Faceoffs won'], ['hits', 'Hits'], ['blockedShots', 'Blocked shots']],
  soccer: [['possessionPct', 'Possession'], ['totalShots', 'Shots'], ['shotsOnTarget', 'Shots on goal'], ['wonCorners', 'Corners'], ['foulsCommitted', 'Fouls']],
  baseball: [['hits', 'Hits'], ['runs', 'Runs'], ['errors', 'Errors'], ['homeRuns', 'Home runs'], ['strikeouts', 'Strikeouts']],
};
// "5-12" reads as 5 of 12, "31:24" as minutes, anything else as a number.
export function statNumber(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d+)\s*[-/]\s*(\d+)$/); if (m) return +m[2] ? +m[1] / +m[2] : 0;
  m = s.match(/^(\d+):(\d{2})$/); if (m) return +m[1] + +m[2] / 60;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
// "41-88" or "22/31" as a percentage ("46.6%"), or '' when it is not a made-of-attempted pair.
export function pctOf(v, digits = 1) {
  const m = String(v ?? '').trim().match(/^(\d+)\s*[-/]\s*(\d+)$/);
  if (!m || !+m[2] || +m[1] > +m[2]) return '';
  return `${(100 * +m[1] / +m[2]).toFixed(digits)}%`;
}
// Only these are made-of-attempted. Things like sacks ("1-7") and penalties ("5-45") look the same but are not.
const PCT_STATS = new Set(['Field goals', '3-pointers', 'Free throws', '3rd down', '4th down', '3rd down eff.', '4th down eff.', 'Comp/Att', 'Red zone TDs']);
export const PCT_COLS = new Set(['FG', '3PT', 'FT', 'C/ATT']);
function statRows(box, awayId, homeId, sport, drives) {
  const teams = box?.teams || [];
  const of = (id) => (teams.find((t) => String(t.team?.id) === String(id))?.statistics) || [];
  const a = of(awayId), h = of(homeId);
  if (!a.length || !h.length) return [];
  const row = (name, label) => {
    const x = a.find((s) => s.name === name), y = h.find((s) => s.name === name);
    if (!x || !y) return null;
    const av = String(x.displayValue ?? ''), hv = String(y.displayValue ?? '');
    if (!av && !hv) return null;
    const lab = label || x.label || x.displayName || name, pct = PCT_STATS.has(lab);
    return { label: lab, away: av, home: hv, awayN: statNumber(av), homeN: statNumber(hv), awayPct: pct ? pctOf(av) : '', homePct: pct ? pctOf(hv) : '' };
  };
  if (sport === 'football') return footballRows(box, drives, awayId, homeId, a, h, row);
  let rows = (STAT_PICKS[sport] || []).map(([n, l]) => row(n, l)).filter(Boolean);
  // Basketball fouls: technicals and flagrants ride under the bar, only when there are any.
  const fl = rows.find((r) => r.label === 'Fouls');
  if (sport === 'basketball' && fl) {
    const extra = (list) => [['totalTechnicalFouls', 'tech'], ['flagrantFouls', 'flagrant']].map(([k, w]) => { const n = Number(list.find((x) => x.name === k)?.displayValue) || 0; return n ? `${n} ${w}` : ''; }).filter(Boolean).join(' · ');
    const da = extra(a), dh = extra(h);
    if (da || dh) Object.assign(fl, { awayDet: da, homeDet: dh });
  }
  // The feed names stats differently per sport. If none of ours matched, show the first few it does have.
  if (!rows.length) rows = a.slice(0, 6).map((s) => row(s.name, s.label || s.displayName)).filter(Boolean);
  return rows;
}
// Football: the full offensive picture. Plays, per-play, touchdowns, sacks and red zone are not in the team box,
// so they come from the player box (touchdowns) and the drives (sacks, red zone trips).
function footballRows(box, drives, awayId, homeId, a, h, row) {
  const raw = (list, name) => String(list.find((s) => s.name === name)?.displayValue ?? '').trim();
  const players = box?.players || [];
  const total = (id, cat, key) => {
    const c = (players.find((t) => String(t.team?.id) === String(id))?.statistics || []).find((x) => x.name === cat);
    const i = (c?.keys || []).indexOf(key);
    return i >= 0 ? Number(c.totals?.[i]) || 0 : null;
  };
  const all = [...(drives?.previous || []), ...(drives?.current ? [drives.current] : [])].filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i);
  const sacks = (id) => { let n = 0, y = 0; for (const d of all) if (String(d.team?.id) === String(id)) for (const p of d.plays || []) if (/sack/i.test(p.type?.text || '')) { n++; const m = /loss of (\d+) yards?/i.exec(p.text || ''); y += m ? +m[1] : Math.abs(Number(p.statYardage) || 0); } return [n, y]; };
  const redzone = (id) => {
    let trips = 0, tds = 0;
    for (const d of all) {
      if (String(d.team?.id) !== String(id)) continue;
      const deep = (d.plays || []).some((p) => Number(p.start?.yardsToEndzone) <= 20 && String(p.start?.team?.id ?? id) === String(id));
      if (!deep) continue;
      trips++;
      if (d.isScore && /touchdown|\btd\b/i.test(`${d.displayResult || ''} ${d.result || ''}`) && !returnScoreAgainst(d, id)) tds++;
    }
    return `${tds}/${trips}`;
  };
  const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  const make = (label, av, hv, pct) => (av === '' && hv === '' ? null : { label, away: String(av), home: String(hv), awayN: statNumber(av), homeN: statNumber(hv), awayPct: pct ? pctOf(String(av)) : '', homePct: pct ? pctOf(String(hv)) : '' });
  const side = (list, id) => {
    const att = num((raw(list, 'completionAttempts').split(/[/-]/)[1]) || '') || 0, rush = num(raw(list, 'rushingAttempts')) || 0, yds = num(raw(list, 'totalYards'));
    const plays = att + rush, [sk, sy] = sacks(id), [pen, peny] = raw(list, 'totalPenaltiesYards').split('-');
    return {
      plays: plays || '', ypp: plays && yds != null ? (yds / plays).toFixed(1) : '', passTd: total(id, 'passing', 'passingTouchdowns') ?? '', rushTd: total(id, 'rushing', 'rushingTouchdowns') ?? '',
      sacked: drives ? sk : '', sackYds: drives ? sy : '', rz: drives ? redzone(id) : '', pen: pen ?? '', penYds: peny ?? '',
      third: raw(list, 'thirdDownEff').replace('-', '/'), fourth: raw(list, 'fourthDownEff').replace('-', '/'),
    };
  };
  const A = side(a, awayId), H = side(h, homeId);
  const pick = (name, label) => row(name, label);
  // Related numbers ride along under the main bar as a small line per team, so one tile tells the whole story.
  const with_ = (r, parts) => {
    if (!r) return null;
    const line = (k) => parts.map(([v, fmt]) => { const x = String(v[k] ?? '').trim(); return x === '' ? '' : fmt(x); }).filter(Boolean).join(' · ');
    const da = line(0), dh = line(1);
    return da || dh ? { ...r, awayDet: da, homeDet: dh } : r;
  };
  const both = (fn) => [fn(a, A), fn(h, H)];
  const per = (n, word) => `${n} ${word}${n === '1' ? '' : 's'}`;
  return [
    with_(pick('totalYards', 'Total yards'), [[[A.plays, H.plays], (v) => per(v, 'play')], [[A.ypp, H.ypp], (v) => `${v} per play`]]),
    pick('firstDowns', 'First downs'),
    with_(pick('netPassingYards', 'Passing yards'), [
      [both((l) => raw(l, 'completionAttempts').replace('-', '/')), (v) => v],
      [both((l) => raw(l, 'yardsPerPass')), (v) => `${v} per att`],
      [[A.passTd, H.passTd], (v) => `${v} TD`],
    ]),
    with_(pick('rushingYards', 'Rushing yards'), [
      [both((l) => raw(l, 'rushingAttempts')), (v) => per(v, 'carry').replace('carrys', 'carries')],
      [both((l) => raw(l, 'yardsPerRushAttempt')), (v) => `${v} per carry`],
      [[A.rushTd, H.rushTd], (v) => `${v} TD`],
    ]),
    with_(pick('turnovers', 'Turnovers'), [
      [both((l) => raw(l, 'interceptions')), (v) => `${v} INT`],
      [both((l) => raw(l, 'fumblesLost')), (v) => `${v} fumbles lost`.replace(/^1 fumbles/, '1 fumble')],
    ]),
    with_(make('Sacked', A.sacked, H.sacked), [[[A.sackYds, H.sackYds], (v) => `${v} yds lost`]]),
    make('Red zone TDs', A.rz, H.rz, true),
    with_(make('3rd down eff.', A.third, H.third, true), [[[A.fourth, H.fourth], (v) => `4th down ${v}`]]),
    with_(make('Penalties', A.pen, H.pen), [[[A.penYds, H.penYds], (v) => `${v} yds`]]),
    pick('possessionTime', 'Time of possession'),
  ].filter(Boolean);
}
/* ---------- player box score ---------- */
// Column order we want up front per sport. Anything else the feed sends follows after, so nothing is hidden.
const BOX_FIRST = {
  basketball: ['MIN', 'PTS', 'REB', 'AST', '+/-', 'FG', '3PT', 'FT', 'STL', 'BLK', 'TO'],
};
const FOOTBALL_GROUPS = ['passing', 'rushing', 'receiving', 'defensive', 'interceptions', 'fumbles', 'kicking', 'punting', 'kickreturns', 'puntreturns'];

// Forced fumbles are not in the feed's box score, so count them from the play-by-play:
// pro plays read "FUMBLES (T.Watt)", college plays read "fumbled, forced by Tre Watt".
// Names are matched by first initial + last name, which is how both spellings line up with the box score.
export const nameKey = (n) => { const p = String(n || '').toLowerCase().replace(/[^a-z.\s'-]/g, '').split(/[.\s]+/).filter(Boolean); return p.length ? p[0][0] + p[p.length - 1] : ''; };
export function forcedFumbles(drives) {
  const out = {}; // offense team id -> { nameKey: count } credited to the OTHER team's defenders
  const all = [...(drives?.previous || []), ...(drives?.current ? [drives.current] : [])];
  const seen = new Set();
  for (const d of all) {
    if (seen.has(d.id)) continue; seen.add(d.id);
    const off = String(d.team?.id ?? '');
    for (const p of d.plays || []) {
      const text = String(p.text || '');
      const names = [...text.matchAll(/FUMBLES?\s*\(([^)]+)\)/g)].map((m) => m[1]).concat([...text.matchAll(/forced by ([A-Z][A-Za-z.'-]*(?: [A-Z][A-Za-z.'-]*){0,2})/g)].map((m) => m[1]));
      for (const n of names) {
        if (/aborted/i.test(n)) continue;
        const k = nameKey(n); if (!k) continue;
        (out[off] = out[off] || {})[k] = ((out[off] || {})[k] || 0) + 1;
      }
    }
  }
  return out;
}
// The feed's display text puts the team in front ("Buffalo Passing"). The plain stat name is cleaner.
const titleOf = (g, sport) => {
  const t = String(g.name || g.text || g.displayName || '').trim();
  // Baseball tables only carry a type: batting or pitching.
  if (!t && /^batting$/i.test(g.type || '')) return 'Hitting';
  if (!t && /^pitching$/i.test(g.type || '')) return 'Pitching';
  if (!t) return sport === 'basketball' ? 'Players' : 'Stats';
  return (t.charAt(0).toUpperCase() + t.slice(1)).replace(/([a-z])([A-Z])/g, '$1 $2');
};
// plusMinus: optional { athleteId: number } worked out from the play-by-play, used when the feed has no +/- column.
export function playerBox(box, awayId, homeId, sport, plusMinus, ff) {
  const out = [];
  for (const id of [awayId, homeId]) {
    const side = (box?.players || []).find((p) => String(p.team?.id) === String(id));
    let groups = (side?.statistics || []).map((g) => {
      const labels = (g.labels || g.names || g.keys || []).map((l) => cleanText(l));
      const keys = g.keys || g.names || [];
      // Make sure plus/minus is labeled the way fans know it even if the feed only names the key.
      labels.forEach((l, i) => { if (!l && /plusMinus/i.test(keys[i] || '')) labels[i] = '+/-'; });
      const addPm = sport === 'basketball' && plusMinus && !labels.includes('+/-');
      const pmIdx = labels.length;
      if (addPm) labels.push('+/-');
      const pmText = (a) => { const v = plusMinus[String(a.athlete?.id ?? '')] ?? 0; return v > 0 ? `+${v}` : String(v); };
      const first = BOX_FIRST[sport] || [];
      const order = [...first.map((l) => labels.indexOf(l)).filter((i) => i >= 0), ...labels.map((_, i) => i).filter((i) => !first.includes(labels[i]))];
      const rows = (g.athletes || []).filter((a) => !a.didNotPlay && (a.stats || []).length).map((a) => ({
        id: String(a.athlete?.id ?? ''),
        name: cleanText(a.athlete?.shortName || a.athlete?.displayName || ''),
        pos: a.athlete?.position?.abbreviation || '',
        starter: a.starter === true,
        stats: order.map((i) => (addPm && i === pmIdx ? pmText(a) : String(a.stats[i] ?? ''))),
      })).filter((r) => r.name);
      return { key: String(g.name || g.type || '').toLowerCase(), title: titleOf(g, sport), labels: order.map((i) => labels[i]), rows, totals: Array.isArray(g.totals) && g.totals.length ? order.map((i) => String(g.totals[i] ?? '')) : null };
    }).filter((g) => g.rows.length && g.labels.length);
    if (sport === 'football') {
      // Give the defense table the two columns fans look for: forced fumbles and fumble recoveries.
      const def = groups.find((g) => g.key === 'defensive'), fum = groups.find((g) => g.key === 'fumbles');
      if (def) {
        const other = String(id) === String(awayId) ? String(homeId) : String(awayId);
        const forced = ff ? (ff[other] || {}) : null; // fumbles forced while the other team had the ball
        const recIdx = fum ? fum.labels.indexOf('REC') : -1;
        const recOf = (r) => (recIdx < 0 ? 0 : Number(fum.rows.find((x) => x.id && x.id === r.id)?.stats[recIdx]) || 0);
        if (forced) { def.labels.push('FF'); def.rows.forEach((r) => r.stats.push(String(forced[nameKey(r.name)] || 0))); if (def.totals) def.totals.push(String(def.rows.reduce((n, r) => n + Number(r.stats[r.stats.length - 1]), 0))); }
        if (recIdx >= 0) { def.labels.push('FR'); def.rows.forEach((r) => r.stats.push(String(recOf(r)))); if (def.totals) def.totals.push(String(def.rows.reduce((n, r) => n + Number(r.stats[r.stats.length - 1]), 0))); }
      }
    }
    if (sport === 'football') groups = groups.filter((g) => FOOTBALL_GROUPS.includes(g.key)).sort((x, y) => FOOTBALL_GROUPS.indexOf(x.key) - FOOTBALL_GROUPS.indexOf(y.key));
    out.push({ teamId: String(id), groups });
  }
  return out.some((t) => t.groups.length) ? out : [];
}

/* ---------- score chart: both teams' scores across the game. Facts only, no predictions. ---------- */
const OT_LEN = { football: 10, basketball: 5, hockey: 5 };
// Minutes of game time elapsed at a play, or null if the clock cannot be read.
function elapsed(period, clock, L) {
  const c = String(clock ?? '').trim();
  if (L.sport === 'soccer') { const m = c.match(/(\d+)/); return m ? +m[1] : null; }
  if (!L.periodLen) return null;
  let left = null;
  let m = c.match(/^(\d+):(\d{2})/); if (m) left = +m[1] + +m[2] / 60;
  else if (/^\d+(\.\d+)?$/.test(c)) left = +c / 60; // last minute shows as seconds ("34.5")
  if (left == null) return null;
  const per = Math.max(1, period || 1), reg = L.periods, ot = OT_LEN[L.sport] || L.periodLen;
  const len = per <= reg ? L.periodLen : ot;
  const base = per <= reg ? (per - 1) * L.periodLen : reg * L.periodLen + (per - reg - 1) * ot;
  return base + Math.min(len, Math.max(0, len - left));
}
// plays: [{ period, clock, away, home }] in game order. Falls back to period scores when plays are missing.
export function scoreSeries(game, plays, L) {
  const played = Math.max(L.periods || 0, game.home.lines.length, game.away.lines.length, game.period || 0);
  const ot = OT_LEN[L.sport] || L.periodLen || 0;
  let pts = [{ m: 0, a: 0, h: 0 }], pa = 0, ph = 0, timed = !!L.periodLen;
  for (const p of plays) {
    if (!Number.isFinite(p.away) || !Number.isFinite(p.home) || (p.away === pa && p.home === ph) || p.away < pa || p.home < ph) continue;
    const m = elapsed(p.period, p.clock, L);
    if (m == null) timed = false;
    pts.push({ m, a: p.away, h: p.home }); pa = p.away; ph = p.home;
  }
  let bounds = [], total = null;
  if (pts.length >= 3 && timed) {
    total = L.sport === 'soccer' ? Math.max(90, ...pts.map((p) => p.m)) : L.periods * L.periodLen + Math.max(0, played - L.periods) * ot;
    let last = 0;
    pts.forEach((p) => { p.m = Math.max(last, Math.min(total, p.m)); last = p.m; p.t = p.m / total; });
    const ends = L.sport === 'soccer' ? [45, total] : Array.from({ length: played }, (_, i) => (i < L.periods ? (i + 1) * L.periodLen : L.periods * L.periodLen + (i - L.periods + 1) * ot));
    bounds = ends.map((e) => e / total);
  } else if (game.home.lines.length >= 2 && game.home.lines.length === game.away.lines.length) {
    const n = game.home.lines.length; let h = 0, a = 0;
    pts = [{ t: 0, a: 0, h: 0 }];
    game.home.lines.forEach((v, i) => { h += +v || 0; a += +game.away.lines[i] || 0; pts.push({ t: (i + 1) / n, a, h, soft: true }); });
    bounds = Array.from({ length: n }, (_, i) => (i + 1) / n);
  } else return null;
  // End the lines at the final whistle, or at the current moment of a live game.
  const lastPt = pts[pts.length - 1];
  const fa = parseInt(game.away.score, 10), fh = parseInt(game.home.score, 10);
  let end = game.state === 'final' ? 1 : lastPt.t;
  if (game.state === 'live' && total) { const now = elapsed(game.period, game.clock, L); if (now != null) end = Math.max(lastPt.t, Math.min(1, now / total)); }
  const endA = Number.isFinite(fa) ? Math.max(fa, lastPt.a) : lastPt.a, endH = Number.isFinite(fh) ? Math.max(fh, lastPt.h) : lastPt.h;
  if (end > lastPt.t || endA !== lastPt.a || endH !== lastPt.h) pts.push({ t: Math.max(end, lastPt.t), a: endA, h: endH });
  return { points: pts.map((p) => ({ t: p.t, a: p.a, h: p.h })), max: Math.max(1, endA, endH), bounds, periods: bounds.length, stepped: !pts.some((p) => p.soft), end: pts[pts.length - 1].t };
}

/* ---------- plus/minus worked out from the play-by-play ---------- */
// Some leagues (college hoops) do not send +/-. If every substitution is in the play-by-play we can count it:
// follow who is on the floor, and credit each basket to the ten players out there.
// If the lineups ever stop adding up to five a side, we return null and show nothing rather than a wrong number.
// Subs made between free throws count after the last free throw: the shots belong to the five on the floor at the foul.
function subsAfterFreeThrows(plays) {
  const isSub = (p) => /substitution/i.test(p.type?.text || '') || /subbing (in|out)|enters the game/i.test(p.text || '');
  const isFt = (p) => /free ?throw/i.test(`${p.type?.text || ''} ${p.text || ''}`);
  const at = (p) => `${p.period?.number}|${p.clock?.displayValue}`;
  const later = new Map(), out = [];
  plays.forEach((p, i) => {
    if (isSub(p)) {
      let last = -1;
      for (let j = i + 1; j < plays.length && at(plays[j]) === at(p); j++) if (isFt(plays[j])) last = j;
      if (last > i) { if (!later.has(last)) later.set(last, []); later.get(last).push(p); return; }
    }
    out.push(p);
    (later.get(i) || []).forEach((x) => out.push(x));
  });
  return out;
}
export function plusMinusFromPlays(rawPlays, starters, awayId, homeId) {
  rawPlays = subsAfterFreeThrows(rawPlays || []);
  const on = { [awayId]: new Set(starters[awayId] || []), [homeId]: new Set(starters[homeId] || []) };
  if (on[awayId].size !== 5 || on[homeId].size !== 5) return null;
  const pm = {}; let pa = 0, ph = 0, subs = 0;
  for (const p of rawPlays || []) {
    const text = String(p.text || ''), type = String(p.type?.text || '');
    const tid = String(p.team?.id ?? ''), who = (p.participants || []).map((x) => String(x.athlete?.id ?? '')).filter(Boolean);
    if (/substitution/i.test(type) || /subbing (in|out)|enters the game/i.test(text)) {
      // A sub the feed logs twice or out of order is skipped rather than throwing away the whole game.
      const set = on[tid]; if (!set || !who.length) continue;
      if (/enters the game for/i.test(text) && who.length >= 2) { set.delete(who[1]); set.add(who[0]); }
      else if (/subbing out/i.test(text)) set.delete(who[0]);
      else if (/subbing in|enters the game/i.test(text)) set.add(who[0]);
      else continue;
      subs++; continue;
    }
    const a = Number(p.awayScore), h = Number(p.homeScore);
    if (!Number.isFinite(a) || !Number.isFinite(h) || (a === pa && h === ph)) continue;
    if (a < pa || h < ph) continue; // a corrected score: wait for it to catch back up
    if (on[awayId].size !== 5 || on[homeId].size !== 5) return null; // the log lost track of who is on the floor
    const d = (a - pa) - (h - ph);
    on[awayId].forEach((id) => { pm[id] = (pm[id] || 0) + d; });
    on[homeId].forEach((id) => { pm[id] = (pm[id] || 0) - d; });
    pa = a; ph = h;
  }
  return subs > 0 && pa + ph > 0 ? pm : null; // no substitutions logged means we cannot know who was on the floor
}
function startersOf(box, ids) {
  const out = {};
  for (const id of ids) {
    const side = (box?.players || []).find((p) => String(p.team?.id) === String(id));
    out[id] = (side?.statistics?.[0]?.athletes || []).filter((a) => a.starter === true).map((a) => String(a.athlete?.id ?? ''));
  }
  return out;
}

/* ---------- football drives ---------- */
// Field position runs 0 to 100 left to right, with the away team driving right and the home team driving left.
// The feed sometimes measures a play's end spot from the wrong goal line (the 99 instead of the 1).
// When the flipped reading matches the yards gained far better, use it.
export function fixSpot(from, to, yards) {
  if (from == null || to == null || yards == null) return to;
  const want = from - yards;
  return Math.abs(100 - to - want) + 3 < Math.abs(to - want) ? 100 - to : to;
}
// What the newest football play is, for the live field's little shows. Pure text and numbers in, a plain description out.
// kind: 'fg' | 'td' | 'safety' | 'turnover' | 'punt' | 'kickoff' | 'big' | ''.
// A score the officials took away: "TOUCHDOWN nullified by penalty", "touchdown called back", "safety negated".
export const CALLED_BACK = /\b(touchdown|td|safety)\b[\s,]*(?:was\s+|is\s+)?(?:nullified|negated|wiped out|called back|overturned|reversed|taken off the board)\b/i;
export function fieldMoment(p) {
  if (!p) return { kind: '' };
  // Read a called-back score as the play it really was (a kickoff, a run...) and flag it, so nothing celebrates a score that did not count.
  if (CALLED_BACK.test(String(p.text || ''))) return { ...fieldMoment({ ...p, text: String(p.text).replace(new RegExp(CALLED_BACK.source, 'gi'), 'score called back') }), nulled: true };
  const type = String(p.type || ''), text = String(p.text || ''), both = `${type} ${text}`;
  if (/field goal/i.test(type) && !/fake/i.test(both)) {
    const blocked = /block/i.test(both);
    const good = !blocked && /good/i.test(both) && !/no good|missed/i.test(both);
    // Where a miss went, when the feed says (the NFL does; college only says NO GOOD).
    const miss = good ? '' : blocked ? 'blocked' : /hit (the )?left upright/i.test(text) ? 'leftpost' : /hit (the )?right upright/i.test(text) ? 'rightpost'
      : /wide left/i.test(text) ? 'left' : /wide right/i.test(text) ? 'right' : /short/i.test(text.replace(/short (left|right|middle)/gi, '')) ? 'short' : 'wide';
    const label = { blocked: 'Blocked', leftpost: 'Off the left upright', rightpost: 'Off the right upright', left: 'Wide left', right: 'Wide right', short: 'Short', wide: '' }[miss] || '';
    return { kind: 'fg', good, miss, label, yards: Number((/(\d+)[ -]yards?/i.exec(text) || [])[1]) || null };
  }
  if (/touchdown/i.test(both) || /\bfor a TD\b/i.test(text)) {
    const two = /two-point|2-pt|2 pt/i.test(text) ? (/fail|incomplete|no good/i.test(text.slice(text.search(/two-point|2-pt|2 pt/i))) ? 'failed' : 'good') : '';
    // Touchdowns the other side scored on the play: pick six, scoop and score, return touchdowns.
    const how = /intercept/i.test(both) ? 'Pick Six' : /fumble/i.test(both) && !/fumble recovery \(own\)/i.test(type) ? 'Scoop & Score'
      : /blocked/i.test(both) ? 'Blocked Kick TD' : /punt/i.test(both) && /return/i.test(both) ? 'Punt Return TD' : /kickoff/i.test(both) && /return/i.test(both) ? 'Kick Return TD' : '';
    return { kind: 'td', two, turnover: /intercept|fumble/i.test(both), ret: /return|recover|block/i.test(type), how };
  }
  if (/safety/i.test(type)) return { kind: 'safety' };
  const lost = /intercept/i.test(type) ? 'Interception' : /fumble recovery \(opponent\)|opp fumble recovery|muffed punt recovery \(opponent\)/i.test(type) ? 'Fumble' : '';
  // A fumble the other side recovered on a play the feed files under something else (a strip sack, say).
  if (!lost && p.kept === false && /fumble/i.test(text) && /recovered by/i.test(text) && !/\bpunts?\b|kickoff|field goal/i.test(both)) return { kind: 'turnover', how: /sack/i.test(type) ? 'Strip Sack' : 'Fumble' };
  if (lost) {
    // On a punt, "opponent" recovery means the kicking team got it back: the drive's team keeps the ball.
    if (p.kept === true && /\bpunts?\b/i.test(text)) { const n = Number((/punts?\s+(?:for\s+)?(\d+)\s+(?:yards?|yds?)\b/i.exec(text) || [])[1]); return { kind: 'punt', yards: Number.isFinite(n) && n > 0 ? n : null, touchback: false, blocked: false, recovered: true }; }
    if (p.kept !== true) return { kind: 'turnover', how: lost };
  }
  if (/^punt|blocked punt/i.test(type)) {
    const n = Number((/punts?\s+(?:for\s+)?(\d+)\s+(?:yards?|yds?)\b/i.exec(text) || [])[1]);
    return { kind: 'punt', yards: Number.isFinite(n) && n > 0 ? n : null, touchback: /touchback/i.test(text), blocked: /block/i.test(both) };
  }
  if (/^kickoff/i.test(type)) {
    const n = Number((/kick(?:s|off)?\s+(?:for\s+)?(\d+)\s+(?:yards?|yds?)\b/i.exec(text) || [])[1]);
    return { kind: 'kickoff', yards: Number.isFinite(n) && n > 0 ? n : null, touchback: /touchback/i.test(text) };
  }
  if (p.kept !== false && Number(p.yards) >= 20 && /rush|pass|reception|sack/i.test(type)) return { kind: 'big', yards: Number(p.yards) };
  return { kind: '' };
}

// Where a touchback puts the ball, as yards to the end zone, by league and season. Only a fallback: the feed's own drive start wins.
export function touchbackSpot(lg, season, kind) {
  if (kind === 'punt') return 80; // both levels: the 20
  if (lg === 'nfl') return season >= 2025 ? 65 : season === 2024 ? 70 : season >= 2016 ? 75 : 80;
  return season >= 2012 || !season ? 75 : 80; // college: the 25 since 2012
}
// A drive's start text ("SMU 25", "50") as yards to the end zone for the drive's team.
export function spotToEnd(text, abbr) {
  const m = /^\s*([A-Za-z&.' -]*?)\s*(\d{1,2})\s*$/.exec(String(text || ''));
  if (!m) return null;
  const n = Number(m[2]);
  if (n === 50 || !m[1]) return n === 50 ? 50 : null;
  return m[1].trim().toUpperCase() === String(abbr || '').toUpperCase() ? 100 - n : n;
}

// A drive that ended with the other side scoring on the return: a pick six, scoop and score, or a punt or blocked kick run back.
// The feed files it under the offense's drive ("Interception Touchdown"), but the points went the other way.
function returnScoreAgainst(d, teamId) {
  const last = d?.plays?.[d.plays.length - 1];
  if (d?.isScore !== true || !last || CALLED_BACK.test(last.text || '')) return '';
  const t = `${last.type?.text || ''}`, both = `${t} ${last.text || ''}`;
  if (!/return touchdown|(interception|fumble).*touchdown/i.test(t)) return '';
  if (String(last.start?.team?.id ?? teamId) !== String(teamId)) return ''; // the drive team's own kick return: their score
  return /intercept/i.test(both) ? 'Pick Six' : /fumble/i.test(both) ? 'Scoop & Score' : /block/i.test(both) ? 'Blocked Kick TD' : /punt/i.test(both) ? 'Punt Return TD' : 'Return TD';
}
export function normDrives(drives, awayId, homeId, live, opts = {}) {
  const list = [...(drives?.previous || [])];
  const cur = drives?.current;
  if (cur && !list.some((d) => String(d.id) === String(cur.id))) list.push(cur);
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  // Team abbreviations by id, for drives whose team the feed got wrong.
  const abbrOf = {};
  for (const d of list) if (d.team?.id) abbrOf[String(d.team.id)] = d.team.abbreviation;
  return list.map((d, i) => {
    // The feed sometimes credits a drive to the wrong team (after a blocked punt, say, SMU's touchdown drive came in as Tulane's
    // "Downs Touchdown"). Go by who ran the scrimmage plays when they all agree.
    const runners = new Set((d.plays || []).filter((p) => !/kickoff|punt|extra point|penalty|timeout|end of/i.test(`${p.type?.text || ''}`) && p.start?.team?.id).map((p) => String(p.start.team.id)));
    const fedId = String(d.team?.id ?? '');
    const teamId = runners.size === 1 && !runners.has(fedId) && [String(awayId), String(homeId)].includes([...runners][0]) ? [...runners][0] : fedId;
    const swapped = teamId !== fedId;
    const plays = (d.plays || []).map((p) => ({
      text: cleanText(p.text),
      down: cleanText(p.start?.downDistanceText || p.start?.shortDownDistanceText || ''),
      period: p.period?.number || 0, clock: p.clock?.displayValue || '',
      scoring: p.scoringPlay === true, away: Number(p.awayScore), home: Number(p.homeScore),
      // For the live field: where the play started and ended (yards to the end zone the offense is attacking), and what comes next.
      type: cleanText(p.type?.text || ''), yards: num(p.statYardage), from: num(p.start?.yardsToEndzone), to: /\bpunts?\b|kickoff/i.test(p.text || '') ? num(p.end?.yardsToEndzone) : fixSpot(num(p.start?.yardsToEndzone), num(p.end?.yardsToEndzone), num(p.statYardage)), // kick yards are not field position, so no spot check
      // endRaw is the feed's own end spot (after a kick it is counted from the receiving team's side); mine = the drive's team ran the play.
      endRaw: num(p.end?.yardsToEndzone), mine: String(p.start?.team?.id ?? teamId) === teamId,
      kept: String(p.end?.team?.id ?? teamId) === teamId, nextDown: Number(p.end?.down) || 0, nextDist: num(p.end?.distance),
      next: cleanText(p.end?.downDistanceText || ''), nextShort: cleanText(p.end?.shortDownDistanceText || ''), spot: cleanText(p.end?.possessionText || ''),
    })).filter((p) => p.text);
    const first = d.plays?.[0], last = d.plays?.[d.plays.length - 1];
    let result = cleanText(d.displayResult || d.result || d.shortDisplayResult || '');
    const against = returnScoreAgainst(d, teamId); // the defense scored on this drive's last play
    // "Downs Touchdown" and the like: the feed glued the other team's turnover onto this drive's score.
    if (!against && d.isScore === true && /touchdown|\btd\b/i.test(result)) result = result.replace(/^\s*(downs|punt|blocked punt|fumble|interception)\s+/i, '');
    if (against) result = against;
    if (swapped && /^downs$/i.test(result)) result = '';
    const kind = against ? 'defTd' : d.isScore === true && /touchdown|\btd\b/i.test(result) ? 'td' : d.isScore === true && /field goal|\bfg\b/i.test(result) ? 'fg'
      : /intercept|fumble|downs|safety/i.test(result) && d.isScore !== true ? 'turnover' : 'other';
    // A drive that opens on the other team's kick starts where the kick ended. The feed's drive start text says where;
    // the kick play's own spots are the kicking team's.
    const kickOpen = !!first && /kickoff|\bpunts?\b/i.test(`${first.type?.text || ''} ${first.text || ''}`) && String(first.start?.team?.id ?? teamId) !== teamId;
    const tb = kickOpen && /touchback/i.test(first.text || '') ? touchbackSpot(opts.lg, opts.season, /kickoff/i.test(`${first.type?.text || ''} ${first.text || ''}`) ? 'kickoff' : 'punt') : null;
    const startToEnd = spotToEnd(d.start?.text, abbrOf[teamId] || d.team?.abbreviation) ?? tb;
    const from = kickOpen && startToEnd != null ? startToEnd : num(first?.start?.yardsToEndzone ?? d.start?.yardsToEndzone);
    // Where the drive ended is its start plus the yards it gained. The last play's own end spot is no good:
    // after a punt or field goal it is where the ball landed, not where the offense got to.
    const gained = num(d.yards) ?? num((String(d.description || '').match(/(-?\d+)\s+yards?/i) || [])[1]);
    const to = from == null ? null : kind === 'td' ? 0 : gained != null ? from - gained : num(last?.end?.yardsToEndzone ?? d.end?.yardsToEndzone);
    const side = teamId === String(homeId) ? 'home' : teamId === String(awayId) ? 'away' : null;
    const pos = (toEnd) => (toEnd == null || !side ? null : Math.max(0, Math.min(100, side === 'away' ? 100 - toEnd : toEnd)));
    return {
      id: String(d.id ?? i), teamId, side,
      result, kind, isScore: d.isScore === true, turnover: kind === 'turnover' || kind === 'defTd',
      scoreSide: kind === 'defTd' ? (side === 'away' ? 'home' : 'away') : side, // who the points went to
      summary: cleanText(d.description || ''),
      period: d.start?.period?.number || plays[0]?.period || 0, clock: d.start?.clock?.displayValue || plays[0]?.clock || '',
      startText: cleanText(d.start?.text || ''), startToEnd: kickOpen ? from : null,
      x0: pos(from), x1: pos(to),
      plays,
      live: !!live && !!cur && String(d.id) === String(cur.id),
      // Score once the drive was over (extra point included), from its last play that carries one.
      score: (() => { const p = [...plays].reverse().find((x) => Number.isFinite(x.away) && Number.isFinite(x.home)); return p ? { away: p.away, home: p.home } : null; })(),
    };
  }).filter((d) => d.side && (d.plays.length || d.summary)).map((d, i, all) => {
    // Show the score on drives that changed it (touchdowns, field goals, and safeties or return scores by the other side).
    const prev = all.slice(0, i).reverse().find((x) => x.score)?.score || { away: 0, home: 0 };
    return { ...d, scoreChanged: !!d.score && (d.score.away !== prev.away || d.score.home !== prev.home) };
  });
}

/* ---------- basketball shots ---------- */
// Feed coordinates are in feet on a half court: x across (0 to 50), y out from the basket. Free throws carry junk values.
export function normShots(rawPlays) {
  return (rawPlays || []).filter((p) => p.shootingPlay && p.coordinate && !/free throw/i.test(`${p.type?.text || ''} ${p.text || ''}`)).map((p) => ({
    teamId: String(p.team?.id ?? ''),
    x: Number(p.coordinate.x), y: Number(p.coordinate.y),
    made: p.scoringPlay === true,
    three: Number(p.scoreValue) === 3 || /three point|3-pt|3pt/i.test(`${p.type?.text || ''} ${p.text || ''}`),
    period: p.period?.number || 0,
  })).filter((sh) => sh.teamId && Number.isFinite(sh.x) && Number.isFinite(sh.y) && sh.x >= -2 && sh.x <= 52 && sh.y >= -6 && sh.y <= 95);
}

/* ---------- soccer shots on the pitch ---------- */
// The feed's commentary tags each shot with where it was struck: x 0..100 toward the goal being attacked, y 0..100 across.
// Away attacks the right goal and home the left, so the two sides never overlap.
const PITCH_KIND = (t) => (/^goal\b|own goal|penalty - scored/i.test(t) ? 'goal' : /penalty - (saved|missed)/i.test(t) ? (/saved/i.test(t) ? 'save' : 'miss') : /on target/i.test(t) ? 'save' : /woodwork|post|bar/i.test(t) ? 'post' : /block/i.test(t) ? 'block' : /off target|miss/i.test(t) ? 'miss' : null);
export function normPitch(data, game) {
  const src = (data.commentary || []).map((c) => c.play).filter(Boolean);
  const plays = src.length ? src : (data.keyEvents || []);
  const sideOf = (team) => {
    const id = String(team?.id ?? ''), nm = String(team?.displayName || team?.name || '').toLowerCase();
    for (const [side, t] of [['away', game.away], ['home', game.home]]) {
      if (id && id === t.id) return side;
      const names = [t.full, t.name, t.short].filter(Boolean).map((x) => String(x).toLowerCase());
      if (nm && names.some((n) => n && (nm === n || nm.startsWith(n) || n.startsWith(nm)))) return side;
    }
    return null;
  };
  const seen = new Set();
  return plays.map((p) => {
    const kind = PITCH_KIND(String(p.type?.text || ''));
    const x = Number(p.fieldPositionX), y = Number(p.fieldPositionY);
    const side = sideOf(p.team);
    if (!kind || !side || !Number.isFinite(x) || !Number.isFinite(y) || p.shootout) return null;
    const key = `${kind}:${x}:${y}:${p.period?.number}`;
    if (seen.has(key)) return null; seen.add(key);
    const away = side === 'away';
    return {
      kind, side, teamId: away ? game.away.id : game.home.id, period: p.period?.number || 0, clock: p.clock?.displayValue || '',
      x: away ? x : 100 - x, y: away ? y : 100 - y,
      who: cleanText(p.participants?.[0]?.athlete?.displayName || ''), text: cleanText(p.text || ''),
    };
  }).filter(Boolean);
}

/* ---------- hockey shots on the rink ---------- */
// A scoring run: points one team has scored in a row with the other team held to zero, counted back from the newest play.
// plays: in order, each with away/home running scores. Returns { side, pts } or null.
export function scoringRun(plays, min = 10) {
  let side = null, pts = 0;
  let after = null;
  for (let i = (plays || []).length - 1; i >= 0; i--) {
    const p = plays[i];
    const a = Number(p.away), h = Number(p.home);
    if (!Number.isFinite(a) || !Number.isFinite(h)) continue;
    if (after) {
      const da = after.a - a, dh = after.h - h;
      if (da > 0 || dh > 0) {
        const sd = da > 0 && dh === 0 ? 'away' : dh > 0 && da === 0 ? 'home' : 'both';
        if (sd === 'both' || (side && sd !== side)) break;
        side = sd; pts += sd === 'away' ? da : dh;
      }
    }
    after = { a, h };
  }
  return side && pts >= min ? { side, pts } : null;
}

// Hockey, right now: who is on the power play and for how much longer, and whose net is empty.
// pp: { side: 'away' | 'home' (the team with the extra skater), left: seconds as of the newest play, skaters: '5 on 4' } or null.
// emptyNet: sides whose goalie is off the ice. Clocks in the feed count up through each 20-minute period.
export function rinkState(data, awayId, homeId) {
  const plays = data?.plays || [];
  const side = (id) => (String(id) === String(awayId) ? 'away' : String(id) === String(homeId) ? 'home' : null);
  const secs = (p) => { const m = /^(\d+):(\d+)/.exec(p.clock?.displayValue || ''); return ((p.period?.number || 1) - 1) * 1200 + (m ? Number(m[1]) * 60 + Number(m[2]) : 0); };
  const now = plays.length ? secs(plays[plays.length - 1]) : 0;
  const pens = [];
  plays.forEach((p, i) => {
    const mins = Number(p.type?.penaltyMinutes), sd = side(p.team?.id);
    if (!sd || !(mins === 2 || mins === 4 || mins === 5)) return;
    const start = secs(p);
    let end = start + mins * 60;
    // A minor ends early when the other team scores on the power play.
    if (mins === 2) { const g = plays.slice(i + 1).find((q) => q.scoringPlay === true && side(q.team?.id) && side(q.team?.id) !== sd && /power play/i.test(q.strength?.text || '')); if (g) end = Math.min(end, secs(g)); }
    pens.push({ sd, start, end, i });
  });
  const live = pens.filter((x) => x.end > now);
  const n = { away: live.filter((x) => x.sd === 'away').length, home: live.filter((x) => x.sd === 'home').length };
  let pp = null;
  if (n.away !== n.home) {
    const short = n.away > n.home ? 'away' : 'home';
    const mine = live.filter((x) => x.sd === short);
    // The feed's own word wins: if a play after the newest penalty is tagged even strength, the advantage is over.
    const since = plays.slice(Math.max(...mine.map((x) => x.i)) + 1).filter((q) => q.strength?.text && secs(q) > Math.max(...mine.map((x) => x.start)));
    const lastTag = since.length ? since[since.length - 1].strength.text : '';
    if (!/even/i.test(lastTag)) {
      const sk = (k) => 5 - Math.min(2, n[k]);
      pp = { side: short === 'away' ? 'home' : 'away', left: Math.max(0, Math.min(...mine.map((x) => x.end)) - now), skaters: `${sk(short === 'away' ? 'home' : 'away')} on ${sk(short)}` };
    }
  }
  // Empty net: a team with skaters on the ice and no goalie among them.
  const goalies = new Set((data?.boxscore?.players || []).flatMap((t) => (t.statistics || []).filter((g) => /goal/i.test(g.name || '')).flatMap((g) => (g.athletes || []).map((a) => String(a.athlete?.id ?? '')))));
  const emptyNet = goalies.size ? (data?.onIce || []).filter((o) => side(o.teamId) && (o.entries || []).length >= 4 && !(o.entries || []).some((e) => goalies.has(String(e.athleteid)))).map((o) => side(o.teamId)) : [];
  return { pp, emptyNet };
}

// Rink in feet, measured from center ice: x -100..100 (goal to goal), y -42.5..42.5.
// Teams swap ends every period, so each team's shots are turned to face one goal: away shoots right, home shoots left.
export function normIce(rawPlays, awayId, homeId) {
  const kindOf = (p) => {
    const t = `${p.type?.text || ''}`.toLowerCase();
    if (p.scoringPlay === true || /^goal\b/.test(t)) return 'goal';
    if (/block/.test(t)) return null; // credited to the blocker, so the spot says nothing about the shooter
    if (/miss/.test(t)) return 'miss';
    if (/shot|save/.test(t) || p.shootingPlay === true) return 'save';
    return null;
  };
  let ev = (rawPlays || []).map((p) => ({
    kind: p.coordinate ? kindOf(p) : null, teamId: String(p.team?.id ?? ''),
    x: Number(p.coordinate?.x), y: Number(p.coordinate?.y), period: p.period?.number || 0,
    text: cleanText(p.text || ''),
  })).filter((e) => e.kind && (e.teamId === String(awayId) || e.teamId === String(homeId)) && Number.isFinite(e.x) && Number.isFinite(e.y));
  if (!ev.length) return [];
  // Some feeds count from a corner (0..200, 0..85) instead of from center ice.
  if (!ev.some((e) => e.x < 0) && ev.some((e) => e.x > 100)) ev = ev.map((e) => ({ ...e, x: e.x - 100, y: e.y - 42.5 }));
  ev = ev.filter((e) => Math.abs(e.x) <= 101 && Math.abs(e.y) <= 44);
  const groups = new Map();
  ev.forEach((e) => { const k = `${e.teamId}:${e.period}`; groups.set(k, [...(groups.get(k) || []), e]); });
  for (const [k, list] of groups) {
    const mean = list.reduce((n, e) => n + e.x, 0) / list.length;
    const wantRight = k.startsWith(String(awayId) + ':');
    if ((mean > 0) !== wantRight) list.forEach((e) => { e.x = -e.x; e.y = -e.y; });
  }
  return ev;
}

// Everything else with a spot on the ice: hits, blocks, takeaways, giveaways and penalties, credited to the team that made
// the play (a block goes to the blocker's team, a penalty to the team that took it). Teams swap ends every period, so each
// period gets one turn, read from that period's shots (away shoots right), and every play in it turns with it.
export const ICE_EVENTS = ['hit', 'block', 'take', 'give', 'pen'];
export function normIceEvents(rawPlays, awayId, homeId) {
  const A = String(awayId), Hm = String(homeId);
  const kindOf = (p) => {
    const t = `${p.type?.text || ''}`.toLowerCase();
    if (p.type?.penaltyMinutes != null || p.type?.penaltyType || /penalty/.test(t)) return 'pen';
    if (/^hit/.test(t)) return 'hit';
    if (/block/.test(t)) return 'block';
    if (/takeaway/.test(t)) return 'take';
    if (/giveaway/.test(t)) return 'give';
    return null;
  };
  const shotOf = (p) => { const t = `${p.type?.text || ''}`.toLowerCase(); return p.scoringPlay === true || /^goal\b|shot|save|miss/.test(t) ? !/block/.test(t) : false; };
  let all = (rawPlays || []).filter((p) => p.coordinate).map((p) => ({
    kind: kindOf(p), shot: kindOf(p) ? false : shotOf(p), teamId: String(p.team?.id ?? ''),
    x: Number(p.coordinate?.x), y: Number(p.coordinate?.y), period: p.period?.number || 0,
    text: cleanText(p.text || ''), mins: Number(p.type?.penaltyMinutes) || null,
  })).filter((e) => (e.kind || e.shot) && (e.teamId === A || e.teamId === Hm) && Number.isFinite(e.x) && Number.isFinite(e.y));
  if (!all.some((e) => e.kind)) return [];
  // Some feeds count from a corner (0..200, 0..85) instead of from center ice.
  if (!all.some((e) => e.x < 0) && all.some((e) => e.x > 100)) all = all.map((e) => ({ ...e, x: e.x - 100, y: e.y - 42.5 }));
  // Which periods to turn: away shots should sit right of center, home shots left.
  const lean = new Map();
  all.filter((e) => e.shot).forEach((e) => lean.set(e.period, (lean.get(e.period) || 0) + (e.teamId === A ? e.x : -e.x)));
  const flip = new Map([...lean].map(([p, v]) => [p, v < 0]));
  const turn = (p) => (flip.has(p) ? flip.get(p) : flip.has(p - 1) ? !flip.get(p - 1) : flip.has(p + 1) ? !flip.get(p + 1) : false); // ends swap each period
  return all.filter((e) => e.kind && Math.abs(e.x) <= 101 && Math.abs(e.y) <= 44)
    .map(({ shot, ...e }) => (turn(e.period) ? { ...e, x: -e.x, y: -e.y } : e));
}

/* ---------- play-by-play (everything that is not football, which reads by drive) ---------- */
export function normPlays(rawPlays) {
  let pa = 0, ph = 0;
  return (rawPlays || []).map((p) => {
    const a = Number(p.awayScore), h = Number(p.homeScore);
    const scored = p.scoringPlay === true || (Number.isFinite(a) && Number.isFinite(h) && (a !== pa || h !== ph));
    if (Number.isFinite(a) && Number.isFinite(h)) { pa = a; ph = h; }
    const cx = Number(p.coordinate?.x), cy = Number(p.coordinate?.y);
    return { text: cleanText(p.text), period: p.period?.number || 0, clock: p.clock?.displayValue || '', teamId: String(p.team?.id ?? ''), scoring: scored, away: a, home: h,
      id: String(p.id ?? ''), type: cleanText(p.type?.text || ''), pts: Number(p.scoreValue) || 0, shot: p.shootingPlay === true,
      // Basketball: feet on a half court, x across (0 to 50) and y out from the basket. Free throws carry junk spots.
      xy: Number.isFinite(cx) && Number.isFinite(cy) && cx > -900 && !/free throw/i.test(`${p.type?.text || ''} ${p.text || ''}`) ? { x: cx, y: cy } : null };
  }).filter((p) => p.text);
}

// Before a game: season numbers side by side, each team's last five, the standings that matter, and season leaders.
function normPreview(data, game, lg) {
  const ids = [game.away.id, game.home.id];
  const teamsBox = data.boxscore?.teams || [];
  const statsOf = (id) => teamsBox.find((t) => String(t.team?.id) === id)?.statistics || [];
  const A = statsOf(game.away.id), H = statsOf(game.home.id);
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  const short = (l) => cleanText(l).replace(/\s+Per Game$/i, '').replace(/^Yards (Passing|Rushing)$/i, '$1 Yards');
  const seen = new Set();
  const compare = A.filter((s) => s.name !== 'streak' && !seen.has(s.name) && seen.add(s.name)).map((s) => {
    const h = H.find((x) => x.name === s.name);
    if (!h) return null;
    const pct = /pct|percent/i.test(s.name);
    return { key: s.name, label: short(s.label || s.displayName || s.name), away: pct ? `${Number(s.displayValue).toFixed(1)}%` : String(s.displayValue ?? ''), home: pct ? `${Number(h.displayValue).toFixed(1)}%` : String(h.displayValue ?? ''),
      awayN: num(s.displayValue), homeN: num(h.displayValue), pct, lowerBetter: /against|allowed|turnover/i.test(s.name + ' ' + (s.label || '')) };
  }).filter((r) => r && r.awayN != null && r.homeN != null && (r.awayN || r.homeN) && !/^team turnovers$/i.test(r.label));
  compare.sort((a, b) => a.lowerBetter - b.lowerBetter); // offense first, then what they give up
  const streak = Object.fromEntries(ids.map((id) => [id, String(statsOf(id).find((s) => s.name === 'streak')?.displayValue || '')]));
  const last5 = {};
  (data.lastFiveGames || []).forEach((t) => {
    const id = String(t.team?.id ?? '');
    last5[id] = (t.events || []).map((e) => ({
      id: String(e.id ?? ''), date: e.gameDate || null, at: e.atVs || '',
      opp: e.opponent?.id ? normTeam(e.opponent, lg) : null,
      result: String(e.gameResult || ''), score: String(e.score || ''),
    })).sort((a, b) => String(b.date).localeCompare(String(a.date))); // most recent first
  });
  // The feed sends a different pile of columns per sport (NBA: GB, L, STRK, PCT, W). Boil it down to the few that matter.
  const sport = LEAGUE[lg]?.sport;
  const cols = sport === 'soccer' ? [['GP', ['gamesPlayed']], ['GD', ['pointDifferential']], ['PTS', ['points']]]
    : sport === 'hockey' ? [['REC', ['@rec']], ['PTS', ['points']]]
      : LEAGUE[lg]?.college ? [['REC', ['@rec']], ['CONF', ['vsConf', 'vs. Conf.', 'CONF', 'VS CONF']]]
        : sport === 'football' ? [['REC', ['@rec']], ['PCT', ['winPercent']]]
        : [['REC', ['@rec']], ['PCT', ['winPercent']], ['GB', ['gamesBehind']]];
  const standings = (data.standings?.groups || []).map((g) => {
    const entries = g.standings?.entries || [];
    const val = (e, names) => {
      const st = e.stats || [];
      const by = (n) => st.find((x) => x.name === n || x.abbreviation === n || x.type === n || x.shortDisplayName === n);
      if (names[0] === '@rec') {
        const o = by('overall') || by('total');
        if (o && /^\d+-\d+/.test(String(o.displayValue ?? o.summary ?? ''))) return recOnly(o.displayValue ?? o.summary);
        const w = by('wins')?.displayValue, l = by('losses')?.displayValue, t = (by('otLosses') || by('ties'))?.displayValue;
        return w != null && l != null ? [w, l, ...(t != null && (sport === 'hockey' || t !== '0') ? [t] : [])].join('-') : '';
      }
      for (const n of names) { const x = by(n); if (x) return String(x.displayValue ?? x.summary ?? ''); }
      return '';
    };
    const use = cols.filter(([, names]) => entries.some((e) => val(e, names)));
    return {
      title: shortGroup(cleanText(g.header || '').replace(/^\d{4}(-\d{2})?\s+/, '').replace(/\s+Standings$/i, '')),
      cols: use.map(([label]) => label),
      rows: entries.map((e) => ({ id: String(e.id ?? ''), name: cleanText(typeof e.team === 'string' ? e.team : e.team?.displayName || ''), stats: use.map(([, names]) => val(e, names)) })),
    };
  }).filter((g) => g.rows.length);
  const leaders = {};
  (data.leaders || []).forEach((t) => {
    const id = String(t.team?.id ?? '');
    leaders[id] = (t.leaders || []).map((c) => {
      const x = c.leaders?.[0]; if (!x) return null;
      const a = x.athlete || {};
      const main = x.mainStat?.value ?? x.displayValue ?? '';
      return { key: String(c.name || ''), title: cleanText(c.displayName || c.name || ''), value: String(main),
        unit: cleanText(x.mainStat?.label || ''), player: { id: String(a.id ?? ''), name: cleanText(a.shortName || a.displayName || ''), jersey: a.jersey ? String(a.jersey) : '' }, sub: cleanText(x.summary || '') };
    }).filter(Boolean);
  });
  const has = compare.length || Object.keys(last5).length || standings.length || Object.keys(leaders).length;
  return has ? { compare, streak, last5, standings, leaders } : null;
}

export async function getGame(lg, id) {
  return gameFromSummary(lg, id, await get(url(SITE, lg, '/summary', { event: id })));
}
export async function getSummary(lg, id) {
  return get(url(SITE, lg, '/summary', { event: id }));
}

/* ---------- replay: step through a finished game as if it were live, one play at a time ---------- */
// Every play in order. Football keeps them inside drives, so each step remembers which drive it is in.
export function replaySteps(data, sport) {
  if (sport === 'football') return (data?.drives?.previous || []).flatMap((d, k) => (d.plays || []).map((p, j) => ({ k, j, p })));
  return (Array.isArray(data?.plays) ? data.plays : []).map((p, j) => ({ j, p }));
}
// The steps worth jumping to: scores, turnovers, kicks, penalties, big gains.
export function replayMoments(steps, sport) {
  const re = sport === 'football' ? /field goal|intercept|fumble recovery \(opp|opp fumble|punt|kickoff|safety|touchdown/i
    : sport === 'hockey' ? /goal|hooking|tripping|slashing|high-sticking|interference|holding|roughing|penalty|cross-checking|delay of game/i : /^$/;
  return steps.map((x, i) => {
    const t = `${x.p.type?.text || ''}`;
    const hit = x.p.scoringPlay === true || re.test(t) || (sport === 'hockey' && x.p.type?.penaltyMinutes) || (sport === 'football' && Number(x.p.statYardage) >= 20);
    return hit ? i : -1;
  }).filter((i) => i >= 0);
}
// The summary as it stood after step i: later plays gone, score and clock from that play, the game marked live.
export function replayCut(data, sport, i) {
  const steps = replaySteps(data, sport);
  const at = steps[Math.max(0, Math.min(i, steps.length - 1))];
  if (!at) return data;
  const d = { ...data };
  let kept;
  if (sport === 'football') {
    const prev = data.drives.previous;
    const cur = { ...prev[at.k], plays: prev[at.k].plays.slice(0, at.j + 1) };
    if (at.j < prev[at.k].plays.length - 1) Object.assign(cur, { isScore: false, displayResult: '', result: '', shortDisplayResult: '', yards: undefined, description: `${at.j + 1} plays` });
    d.drives = { previous: [...prev.slice(0, at.k), cur], current: cur };
    kept = new Set(d.drives.previous.flatMap((x) => x.plays.map((p) => String(p.id))));
  } else {
    d.plays = data.plays.slice(0, at.j + 1);
    kept = new Set(d.plays.map((p) => String(p.id)));
  }
  d.scoringPlays = (data.scoringPlays || []).filter((p) => kept.has(String(p.id)));
  delete d.onIce; // who is on the ice is only known for right now
  // Score and line score as of this play.
  const flat = steps.slice(0, i + 1).map((x) => x.p).filter((p) => Number.isFinite(Number(p.awayScore)));
  const lastP = at.p, per = lastP.period?.number || 1;
  const endOf = (n) => { const q = flat.filter((p) => (p.period?.number || 0) <= n); return q.length ? q[q.length - 1] : { awayScore: 0, homeScore: 0 }; };
  const comp = { ...data.header.competitions[0] };
  comp.competitors = comp.competitors.map((c) => {
    const k = c.homeAway === 'home' ? 'homeScore' : 'awayScore';
    const lines = Array.from({ length: per }, (_, n) => { const v = Number(endOf(n + 1)[k]) - Number(n ? endOf(n)[k] : 0); return { value: v, displayValue: String(v) }; });
    return { ...c, score: String(Number(endOf(per)[k]) || 0), linescores: lines, winner: undefined };
  });
  const clock = lastP.clock?.displayValue || '';
  const nth = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
  const detail = `${clock} - ${nth(per)}`;
  comp.status = { ...comp.status, period: per, displayClock: clock, type: { ...(comp.status?.type || {}), state: 'in', completed: false, name: 'STATUS_IN_PROGRESS', description: 'In Progress', detail, shortDetail: detail } };
  comp.situation = undefined;
  d.header = { ...data.header, competitions: [comp] };
  return d;
}

// A live game's clock as "13:58 - 1H": seconds left and the period label, so two feeds can be compared.
export function clockOf(text) {
  const m = /^(\d{1,2}):(\d{2})(?:\.\d)?\s*-\s*(.+)$/.exec(String(text || '').trim());
  return m ? { secs: Number(m[1]) * 60 + Number(m[2]), per: m[3].trim().toLowerCase() } : null;
}
// The game page reads ESPN's per-game feed; the Scores list reads its scoreboard. The per-game feed's clock now and then
// sticks on a wrong value while the scoreboard stays right, so when both are live in the same period and their clocks are
// more than two minutes apart (the scoreboard is at most ~30 seconds old), the scoreboard's clock wins.
export function pickClock(game, board) {
  if (!game || !board || game.state !== 'live' || board.state !== 'live') return game;
  const a = clockOf(game.statusText), b = clockOf(board.statusText);
  if (!a || !b || a.per !== b.per || Math.abs(a.secs - b.secs) <= 120) return game;
  return { ...game, statusText: board.statusText };
}
export function gameFromSummary(lg, id, data) {
  const L = LEAGUE[lg];
  const comp = data.header?.competitions?.[0];
  if (!comp) throw new FeedError('That game is not in the feed.', 404);
  const game = normEvent({ id: data.header.id || id, date: comp.date, competitions: [comp] }, lg);
  game.season = Number(data.header?.season?.year) || null; // the season this game belongs to, for links to that season's team pages
  const started = game.state === 'live' || game.state === 'final';
  const plays = (data.scoringPlays || []).map((p) => ({
    text: cleanText(p.text),
    kind: cleanText(p.type?.text || p.scoringType?.displayName || ''),
    period: p.period?.number || 0,
    clock: p.clock?.displayValue || '',
    teamId: String(p.team?.id ?? ''),
    away: Number(p.awayScore), home: Number(p.homeScore),
  })).filter((p) => p.text);
  // Basketball has no scoring-play list, but its full play-by-play carries the running score.
  const all = Array.isArray(data.plays) && data.plays.length ? data.plays : (data.scoringPlays || []);
  const timeline = all.map((p) => ({ period: p.period?.number || 0, clock: p.clock?.displayValue || '', away: Number(p.awayScore), home: Number(p.homeScore) }));
  let plusMinus = null;
  if (L.sport === 'basketball' && started) {
    try { plusMinus = plusMinusFromPlays(data.plays, startersOf(data.boxscore, [game.away.id, game.home.id]), game.away.id, game.home.id); } catch { plusMinus = null; }
  }
  // When the latest play happened, by the wall clock: during a break, that's when the break started.
  const walls = [...(Array.isArray(data.plays) ? data.plays : []), ...(data.drives?.previous || []).flatMap((d) => d.plays || []), ...(data.drives?.current?.plays || [])]
    .map((p) => Date.parse(p.wallclock || '')).filter(Number.isFinite);
  const lastWall = walls.length ? Math.max(...walls) : null;
  return {
    game, lastWall,
    stats: statRows(data.boxscore, game.away.id, game.home.id, L.sport, data.drives),
    box: playerBox(data.boxscore, game.away.id, game.home.id, L.sport, plusMinus, L.sport === 'football' && data.drives ? forcedFumbles(data.drives) : null),
    plays,
    chart: started ? scoreSeries(game, timeline, L) : null,
    drives: L.sport === 'football' ? normDrives(data.drives, game.away.id, game.home.id, game.state === 'live', { lg, season: game.season }) : [],
    shots: L.sport === 'basketball' ? normShots(data.plays) : [],
    ice: L.sport === 'hockey' ? normIce(data.plays, game.away.id, game.home.id) : [],
    iceEvents: L.sport === 'hockey' ? normIceEvents(data.plays, game.away.id, game.home.id) : [],
    rink: L.sport === 'hockey' && game.state === 'live' ? rinkState(data, game.away.id, game.home.id) : null,
    pitch: L.sport === 'soccer' ? normPitch(data, game) : [],
    pbp: L.sport === 'football' ? [] : normPlays(Array.isArray(data.plays) && data.plays.length ? data.plays : data.keyEvents),
    venue: [data.gameInfo?.venue?.fullName, [data.gameInfo?.venue?.address?.city, data.gameInfo?.venue?.address?.state || data.gameInfo?.venue?.address?.country].filter(Boolean).join(', ')].filter(Boolean).map(cleanText).join(' · '),
    preview: started ? null : normPreview(data, game, lg),
  };
}

/* ---------- headlines, written from final scores by template (no AI yet) ---------- */
const BLOWOUT = { football: 21, basketball: 20, hockey: 4, baseball: 6, soccer: 3 };
const CLOSE = { football: 3, basketball: 3, hockey: 1, baseball: 1, soccer: 1 };
export function headlineFor(g) {
  const L = LEAGUE[g.lg];
  const h = parseInt(g.home.score, 10), a = parseInt(g.away.score, 10);
  if (g.state !== 'final' || !Number.isFinite(h) || !Number.isFinite(a)) return null;
  const tag = (t) => (t.rank ? `No. ${t.rank} ${t.name}` : t.name);
  if (h === a) return { title: `${g.home.name} and ${g.away.name} draw, ${h}-${a}`, weight: 2 };
  const W = h > a ? g.home : g.away, Lo = h > a ? g.away : g.home;
  const hi = Math.max(h, a), lo = Math.min(h, a), margin = hi - lo, score = `${hi}-${lo}`;
  const ot = /OT|SO/i.test(g.statusText);
  // Pro nicknames are plural ("Bengals beat"), schools are singular ("Ohio State beats").
  const plural = !L.college && /s$/i.test(W.name);
  const v = (one, many) => (plural ? many : one);
  const upset = Lo.rank && (!W.rank || W.rank > Lo.rank + 4);
  if (upset) return { title: `${W.name} ${v('stuns', 'stun')} ${tag(Lo)}, ${score}`, weight: 6 };
  if (ot) return { title: `${tag(W)} ${v('outlasts', 'outlast')} ${tag(Lo)} in overtime, ${score}`, weight: 5 };
  if (margin <= (CLOSE[L.sport] ?? 3)) return { title: `${tag(W)} ${v('edges', 'edge')} ${tag(Lo)}, ${score}`, weight: 4 };
  if (margin >= (BLOWOUT[L.sport] ?? 20)) return { title: `${tag(W)} ${v('rolls', 'roll')} past ${tag(Lo)}, ${score}`, weight: 3 };
  return { title: `${tag(W)} ${v('beats', 'beat')} ${tag(Lo)}, ${score}`, weight: W.rank || Lo.rank ? 3 : 1 };
}
