// The only file that knows what the scores feed looks like.
// Everything else in the app reads the plain shapes this file returns (Game, Team, Standings...),
// so swapping in a licensed feed later means rewriting this one adapter, not the screens.
//
// Feed: ESPN's public site API. It is unofficial and its terms do not cover commercial use,
// so treat it as private-beta only.

import { LEAGUE, LEAGUES } from './leagues.js';
import { scrub, cleanText } from './guard.js';

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
function hashColor(s) {
  let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 38%)`;
}
// A team chip needs a color that shows up on a navy screen with white letters.
export function teamColor(color, alt, seed) {
  const a = hexOk(color) ? color : null, b = hexOk(alt) ? alt : null;
  const usable = (h) => h && lum(h) > 0.012 && lum(h) < 0.55;
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
function learn(key, color, alt) {
  const old = book.get(key);
  if (old && old[0] === color && old[1] === alt) return;
  book.set(key, [color, alt]);
  if (!hasStore() || bookTimer) return;
  bookTimer = setTimeout(() => { bookTimer = null; try { localStorage.setItem('fr.colors.v1', JSON.stringify(Object.fromEntries(book))); } catch { /* full or private mode */ } }, 800);
}
const knowsColor = (t, lg) => hexOk(t?.color) || (loadBook(), book.has(`${lg}:${t?.id}`));

export function normTeam(t, lg) {
  t = t || {};
  if (t.id != null) {
    const key = `${lg}:${t.id}`;
    if (hexOk(t.color)) learn(key, String(t.color), hexOk(t.alternateColor) ? String(t.alternateColor) : null);
    else { loadBook(); const k = book.get(key); if (k) t = { ...t, color: k[0], alternateColor: k[1] }; }
  }
  // Game pages do not send the short name, so build it: schools go by place ("Virginia Tech"), pros by nickname ("Bills").
  const name = t.shortDisplayName || (LEAGUE[lg]?.college ? t.location : t.name) || t.displayName || t.name || t.location || 'TBD';
  const abbr = String(t.abbreviation || name).toUpperCase().slice(0, 4);
  return {
    id: String(t.id ?? ''), lg,
    name, full: t.displayName || name, abbr,
    color: teamColor(t.color, t.alternateColor, (t.displayName || name) + lg),
    color2: hexOk(t.alternateColor) ? '#' + String(t.alternateColor).toUpperCase() : null,
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
  const rank = c?.curatedRank?.current;
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
    statusText: cleanText(type.shortDetail || type.detail || type.description || ''),
    // The feed gives undecided kickoff times a placeholder clock time; flag them so screens say TBD.
    tbd: state === 'pre' && (comp.timeValid === false || ev?.timeValid === false || /\bTBD\b/i.test(String(type.shortDetail || type.detail || ''))),
    period: st.period || 0,
    clock: st.displayClock || '',
    home: normSide(homeC, lg),
    away: normSide(awayC, lg),
    note: cleanText(comp.notes?.[0]?.headline || ''),
  };
}

/* ---------- scoreboard ---------- */
// day: 'YYYYMMDD' or undefined for the feed's current slate.
export async function getScoreboard(lg, day) {
  const L = LEAGUE[lg];
  const data = await get(url(SITE, lg, '/scoreboard', { ...(L.params || {}), ...(day ? { dates: day } : {}) }));
  const games = (data.events || []).map((e) => normEvent(e, lg)).filter((g) => g.id && g.home.id && g.away.id);
  return { lg, games, season: data.leagues?.[0]?.season?.type?.name || '' };
}

/* ---------- standings ---------- */
const stat = (entry, ...names) => {
  for (const n of names) {
    const s = (entry.stats || []).find((x) => x.name === n || x.type === n || x.abbreviation === n);
    if (s) return String(s.displayValue ?? s.summary ?? s.value ?? '');
  }
  return '';
};
function overallOf(entry) {
  const o = stat(entry, 'overall', 'total');
  if (o) return o;
  const w = stat(entry, 'wins'), l = stat(entry, 'losses');
  if (!w && !l) return '';
  const t = stat(entry, 'ties', 'otLosses', 'draws');
  return [w || '0', l || '0', ...(t && t !== '0' ? [t] : [])].join('-');
}
function col2Of(entry, L) {
  if (L.sport === 'hockey' || L.sport === 'soccer') return ['PTS', stat(entry, 'points')];
  if (L.college) {
    const conf = (entry.stats || []).find((x) => /conf/i.test(x.name || '') || /conf/i.test(x.displayName || '') || /conf/i.test(x.type || ''));
    return ['CONF', conf ? String(conf.displayValue ?? conf.summary ?? '') : ''];
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
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const entries = node.standings?.entries;
    if (Array.isArray(entries) && entries.length) {
      let label = 'REC';
      const rows = entries.map((e) => {
        const [lab, v] = col2Of(e, L); label = lab;
        return { team: normTeam(e.team, lg), overall: overallOf(e), col2: v };
      });
      const full = node.name || node.abbreviation || L.name;
      groups.push({ name: shortGroup(full), full, col2Label: label, rows });
    }
    (node.children || []).forEach(walk);
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
export async function getStandings(lg) {
  const L = LEAGUE[lg];
  const [conf, div] = await Promise.allSettled([
    get(url(V2, lg, '/standings')),
    L.college ? Promise.reject(new Error('skip')) : get(url(V2, lg, '/standings', { level: '3' })),
  ]);
  if (conf.status !== 'fulfilled') throw conf.reason;
  // Standings rows usually carry no team colors: pull the team list once so the chips are the real colors.
  if (entryTeams(conf.value).some((t) => !knowsColor(t, lg))) { try { await listTeams(lg); } catch { /* chips fall back */ } }
  const groups = standingGroups(conf.value, lg);
  const divisions = div.status === 'fulfilled' ? standingGroups(div.value, lg) : [];
  const views = divisions.length > groups.length
    ? [{ id: 'division', label: 'Division', groups: divisions }, { id: 'conference', label: groups.length > 1 ? 'Conference' : 'League', groups }]
    : [{ id: 'conference', label: 'Conference', groups }];
  return { lg, groups, views };
}

/* ---------- teams ---------- */
// The feed's team list is flaky from browsers (the big-limit request can be refused), so try smaller asks,
// then fall back to the teams inside standings, which is a read we know works.
let teamsParams = [{ limit: '1000' }, { limit: '400' }, {}];
const listMemo = new Map();
function listTeams(lg) {
  if (!listMemo.has(lg)) {
    const p = (async () => {
      let lastErr = null;
      for (const params of teamsParams) {
        try {
          const data = await get(url(SITE, lg, '/teams', params));
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

export async function getTeam(lg, id) {
  const [info, sched] = await Promise.allSettled([
    get(url(SITE, lg, `/teams/${encodeURIComponent(id)}`)),
    get(url(SITE, lg, `/teams/${encodeURIComponent(id)}/schedule`)),
  ]);
  if (info.status === 'rejected' && sched.status === 'rejected') throw info.reason;
  const t = info.status === 'fulfilled' ? (info.value.team || {}) : (sched.value.team || {});
  const record = t.record?.items?.[0]?.summary || t.recordSummary || '';
  const events = sched.status === 'fulfilled' ? (sched.value.events || []) : [];
  return {
    team: normTeam(t.id ? t : { ...t, id }, lg),
    record: String(record || ''),
    standing: cleanText(t.standingSummary || ''),
    schedule: events.map((e) => normEvent(e, lg)).filter((g) => g.id),
    scheduleMissing: sched.status === 'rejected',
  };
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
    return { title: cleanText(st.displayName || ''), rows, totals: tot ? tot.map((v) => String(v ?? '')) : null };
  }).filter((x) => x.rows.length);
  return { labels, spans: spans.reduce((n, x) => n + x.count, 0) === labels.length ? spans : [], seasons };
}
function normCareer(d) {
  return (d?.categories || []).map((c) => ({
    key: String(c.name || ''), title: cleanText(c.displayName || c.name || ''),
    labels: (c.labels || []).map((l) => cleanText(l)),
    rows: (c.statistics || []).map((x) => ({
      year: Number(x.season?.year) || 0,
      season: String(x.season?.displayName || x.season?.year || ''),
      team: String(d.teams?.[x.teamId]?.abbreviation || x.teamAbbreviation || '').toUpperCase(),
      stats: (x.stats || []).map((v) => String(v ?? '')),
    })).filter((r) => r.stats.length).sort((x, y) => x.year - y.year),
    totals: Array.isArray(c.totals) && c.totals.length ? c.totals.map((v) => String(v ?? '')) : null,
  })).filter((c) => c.rows.length && c.labels.length);
}

// One player: who they are, this season, game by game, and the career. Any piece can be missing.
export async function getPlayer(lg, id) {
  const pid = encodeURIComponent(id);
  const [info, log, stats] = await Promise.allSettled([
    get(url(COMMON, lg, `/athletes/${pid}`)),
    get(url(COMMON, lg, `/athletes/${pid}/gamelog`)),
    get(url(COMMON, lg, `/athletes/${pid}/stats`)),
  ]);
  if (info.status === 'rejected' && log.status === 'rejected' && stats.status === 'rejected') throw info.reason;
  const a = info.status === 'fulfilled' ? (info.value.athlete || info.value || {}) : {};
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
      items: (sum.statistics || []).map((x) => ({ label: cleanText(x.abbreviation || x.shortDisplayName || x.displayName || ''), value: String(x.displayValue ?? '') })).filter((x) => x.label && x.value).slice(0, 4),
    },
    gamelog: log.status === 'fulfilled' ? normGamelog(log.value) : { labels: [], spans: [], seasons: [] },
    career: stats.status === 'fulfilled' ? normCareer(stats.value) : [],
    missing: { info: info.status === 'rejected', gamelog: log.status === 'rejected', career: stats.status === 'rejected' },
  };
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

/* ---------- one game ---------- */
// Which box-score rows we show, in order, and what we call them. Labels match the plain-English tips.
const STAT_PICKS = {
  football: [['totalYards', 'Total yards'], ['netPassingYards', 'Passing yards'], ['rushingYards', 'Rushing yards'], ['thirdDownEff', '3rd down'], ['fourthDownEff', '4th down'], ['turnovers', 'Turnovers'], ['possessionTime', 'Time of possession']],
  basketball: [['fieldGoalsMade-fieldGoalsAttempted', 'Field goals'], ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3-pointers'], ['freeThrowsMade-freeThrowsAttempted', 'Free throws'], ['totalRebounds', 'Rebounds'], ['assists', 'Assists'], ['turnovers', 'Turnovers']],
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
const PCT_STATS = new Set(['Field goals', '3-pointers', 'Free throws', '3rd down', '4th down']);
export const PCT_COLS = new Set(['FG', '3PT', 'FT', 'C/ATT']);
function statRows(box, awayId, homeId, sport) {
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
  let rows = (STAT_PICKS[sport] || []).map(([n, l]) => row(n, l)).filter(Boolean);
  // The feed names stats differently per sport. If none of ours matched, show the first few it does have.
  if (!rows.length) rows = a.slice(0, 6).map((s) => row(s.name, s.label || s.displayName)).filter(Boolean);
  return rows;
}
/* ---------- player box score ---------- */
// Column order we want up front per sport. Anything else the feed sends follows after, so nothing is hidden.
const BOX_FIRST = {
  basketball: ['MIN', 'PTS', 'REB', 'AST', '+/-', 'FG', '3PT', 'FT', 'STL', 'BLK', 'TO'],
};
const FOOTBALL_GROUPS = ['passing', 'rushing', 'receiving', 'defensive', 'interceptions', 'kicking', 'punting'];
// The feed's display text puts the team in front ("Buffalo Passing"). The plain stat name is cleaner.
const titleOf = (g, sport) => {
  const t = String(g.name || g.text || g.displayName || '').trim();
  if (!t) return sport === 'basketball' ? 'Players' : 'Stats';
  return (t.charAt(0).toUpperCase() + t.slice(1)).replace(/([a-z])([A-Z])/g, '$1 $2');
};
// plusMinus: optional { athleteId: number } worked out from the play-by-play, used when the feed has no +/- column.
export function playerBox(box, awayId, homeId, sport, plusMinus) {
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
      return { key: String(g.name || '').toLowerCase(), title: titleOf(g, sport), labels: order.map((i) => labels[i]), rows, totals: Array.isArray(g.totals) && g.totals.length ? order.map((i) => String(g.totals[i] ?? '')) : null };
    }).filter((g) => g.rows.length && g.labels.length);
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
export function plusMinusFromPlays(rawPlays, starters, awayId, homeId) {
  const on = { [awayId]: new Set(starters[awayId] || []), [homeId]: new Set(starters[homeId] || []) };
  if (on[awayId].size !== 5 || on[homeId].size !== 5) return null;
  const pm = {}; let pa = 0, ph = 0, subs = 0;
  for (const p of rawPlays || []) {
    const text = String(p.text || ''), type = String(p.type?.text || '');
    const tid = String(p.team?.id ?? ''), who = (p.participants || []).map((x) => String(x.athlete?.id ?? '')).filter(Boolean);
    if (/substitution/i.test(type) || /subbing (in|out)|enters the game/i.test(text)) {
      const set = on[tid]; if (!set || !who.length) return null;
      if (/enters the game for/i.test(text) && who.length >= 2) { if (set.has(who[0]) || !set.has(who[1])) return null; set.delete(who[1]); set.add(who[0]); }
      else if (/subbing out/i.test(text)) { if (!set.has(who[0])) return null; set.delete(who[0]); }
      else if (/subbing in|enters the game/i.test(text)) { if (set.has(who[0])) return null; set.add(who[0]); }
      else return null;
      subs++; continue;
    }
    const a = Number(p.awayScore), h = Number(p.homeScore);
    if (!Number.isFinite(a) || !Number.isFinite(h) || (a === pa && h === ph)) continue;
    if (a < pa || h < ph) return null;
    if (on[awayId].size !== 5 || on[homeId].size !== 5) return null;
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
export function normDrives(drives, awayId, homeId, live) {
  const list = [...(drives?.previous || [])];
  const cur = drives?.current;
  if (cur && !list.some((d) => String(d.id) === String(cur.id))) list.push(cur);
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return list.map((d, i) => {
    const teamId = String(d.team?.id ?? '');
    const plays = (d.plays || []).map((p) => ({
      text: cleanText(p.text),
      down: cleanText(p.start?.downDistanceText || p.start?.shortDownDistanceText || ''),
      period: p.period?.number || 0, clock: p.clock?.displayValue || '',
      scoring: p.scoringPlay === true, away: Number(p.awayScore), home: Number(p.homeScore),
    })).filter((p) => p.text);
    const first = d.plays?.[0], last = d.plays?.[d.plays.length - 1];
    const result = cleanText(d.displayResult || d.result || d.shortDisplayResult || '');
    const kind = d.isScore === true && /touchdown|\btd\b/i.test(result) ? 'td' : d.isScore === true && /field goal|\bfg\b/i.test(result) ? 'fg'
      : /intercept|fumble|downs|safety/i.test(result) && d.isScore !== true ? 'turnover' : 'other';
    const from = num(first?.start?.yardsToEndzone ?? d.start?.yardsToEndzone);
    // Where the drive ended is its start plus the yards it gained. The last play's own end spot is no good:
    // after a punt or field goal it is where the ball landed, not where the offense got to.
    const gained = num(d.yards) ?? num((String(d.description || '').match(/(-?\d+)\s+yards?/i) || [])[1]);
    const to = from == null ? null : kind === 'td' ? 0 : gained != null ? from - gained : num(last?.end?.yardsToEndzone ?? d.end?.yardsToEndzone);
    const side = teamId === String(homeId) ? 'home' : teamId === String(awayId) ? 'away' : null;
    const pos = (toEnd) => (toEnd == null || !side ? null : Math.max(0, Math.min(100, side === 'away' ? 100 - toEnd : toEnd)));
    return {
      id: String(d.id ?? i), teamId, side,
      result, kind, isScore: d.isScore === true, turnover: kind === 'turnover',
      summary: cleanText(d.description || ''),
      period: d.start?.period?.number || plays[0]?.period || 0, clock: d.start?.clock?.displayValue || plays[0]?.clock || '',
      startText: cleanText(d.start?.text || ''),
      x0: pos(from), x1: pos(to),
      plays,
      live: !!live && !!cur && String(d.id) === String(cur.id),
    };
  }).filter((d) => d.side && (d.plays.length || d.summary));
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

/* ---------- play-by-play (everything that is not football, which reads by drive) ---------- */
export function normPlays(rawPlays) {
  let pa = 0, ph = 0;
  return (rawPlays || []).map((p) => {
    const a = Number(p.awayScore), h = Number(p.homeScore);
    const scored = p.scoringPlay === true || (Number.isFinite(a) && Number.isFinite(h) && (a !== pa || h !== ph));
    if (Number.isFinite(a) && Number.isFinite(h)) { pa = a; ph = h; }
    return { text: cleanText(p.text), period: p.period?.number || 0, clock: p.clock?.displayValue || '', teamId: String(p.team?.id ?? ''), scoring: scored, away: a, home: h };
  }).filter((p) => p.text);
}

export async function getGame(lg, id) {
  const L = LEAGUE[lg];
  const data = await get(url(SITE, lg, '/summary', { event: id }));
  const comp = data.header?.competitions?.[0];
  if (!comp) throw new FeedError('That game is not in the feed.', 404);
  const game = normEvent({ id: data.header.id || id, date: comp.date, competitions: [comp] }, lg);
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
  return {
    game,
    stats: statRows(data.boxscore, game.away.id, game.home.id, L.sport),
    box: playerBox(data.boxscore, game.away.id, game.home.id, L.sport, plusMinus),
    plays,
    chart: started ? scoreSeries(game, timeline, L) : null,
    drives: L.sport === 'football' ? normDrives(data.drives, game.away.id, game.home.id, game.state === 'live') : [],
    shots: L.sport === 'basketball' ? normShots(data.plays) : [],
    pbp: L.sport === 'football' ? [] : normPlays(Array.isArray(data.plays) && data.plays.length ? data.plays : data.keyEvents),
    venue: cleanText(data.gameInfo?.venue?.fullName || ''),
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
