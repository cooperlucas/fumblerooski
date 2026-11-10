// The only file that knows what the scores feed looks like.
// Everything else in the app reads the plain shapes this file returns (Game, Team, Standings...),
// so swapping in a licensed feed later means rewriting this one adapter, not the screens.
//
// Feed: ESPN's public site API. It is unofficial and its terms do not cover commercial use,
// so treat it as private-beta only.

import { LEAGUE } from './leagues.js';
import { scrub, cleanText } from './guard.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const V2 = 'https://site.api.espn.com/apis/v2/sports';

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

export function normTeam(t, lg) {
  t = t || {};
  const name = t.shortDisplayName || t.displayName || t.name || t.location || 'TBD';
  const abbr = String(t.abbreviation || name).toUpperCase().slice(0, 4);
  return {
    id: String(t.id ?? ''), lg,
    name, full: t.displayName || name, abbr,
    color: teamColor(t.color, t.alternateColor, (t.displayName || name) + lg),
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
export async function getStandings(lg) {
  const L = LEAGUE[lg];
  const data = await get(url(V2, lg, '/standings'));
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
      groups.push({ name: node.name || node.abbreviation || L.name, col2Label: label, rows });
    }
    (node.children || []).forEach(walk);
  };
  walk(data);
  return { lg, groups };
}

/* ---------- teams ---------- */
// The feed's team list is flaky from browsers (the big-limit request can be refused), so try smaller asks,
// then fall back to the teams inside standings, which is a read we know works.
let teamsParams = [{ limit: '1000' }, { limit: '400' }, {}];
export async function getTeams(lg) {
  let lastErr = null;
  for (const params of teamsParams) {
    try {
      const data = await get(url(SITE, lg, '/teams', params));
      const list = data.sports?.[0]?.leagues?.[0]?.teams || data.teams || [];
      const teams = list.map((x) => normTeam(x.team || x, lg)).filter((t) => t.id);
      if (teams.length) {
        teamsParams = [params, ...teamsParams.filter((p) => p !== params)]; // start with what worked next time
        teams.source = 'team list';
        return teams;
      }
    } catch (e) { lastErr = e; }
  }
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

/* ---------- one game ---------- */
// Which box-score rows we show, in order, and what we call them. Labels match the plain-English tips.
const STAT_PICKS = {
  football: [['totalYards', 'Total yards'], ['netPassingYards', 'Passing yards'], ['rushingYards', 'Rushing yards'], ['thirdDownEff', '3rd down'], ['turnovers', 'Turnovers'], ['possessionTime', 'Time of possession']],
  basketball: [['fieldGoalsMade-fieldGoalsAttempted', 'Field goals'], ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3-pointers'], ['totalRebounds', 'Rebounds'], ['assists', 'Assists'], ['turnovers', 'Turnovers']],
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
    return { label: label || x.label || x.displayName || name, away: av, home: hv, awayN: statNumber(av), homeN: statNumber(hv) };
  };
  let rows = (STAT_PICKS[sport] || []).map(([n, l]) => row(n, l)).filter(Boolean);
  // The feed names stats differently per sport. If none of ours matched, show the first few it does have.
  if (!rows.length) rows = a.slice(0, 6).map((s) => row(s.name, s.label || s.displayName)).filter(Boolean);
  return rows;
}
const clockFrac = (clock, len) => {
  const m = String(clock || '').match(/^(\d+):(\d{2})/);
  if (!m || !len) return null;
  const rem = +m[1] + +m[2] / 60;
  return Math.min(1, Math.max(0, 1 - rem / len));
};
// Momentum: who led, by how much, across the game. Built only from points scored. No predictions.
export function momentum(game, plays, L) {
  const pts = [{ t: 0, d: 0 }];
  const n = Math.max(L.periods || 4, game.period || 0, game.home.lines.length);
  const scored = plays.filter((p) => Number.isFinite(p.home) && Number.isFinite(p.away));
  if (scored.length >= 2) {
    scored.forEach((p, i) => {
      const f = L.sport === 'soccer' ? null : clockFrac(p.clock, L.periodLen);
      const per = Math.max(1, p.period || 1);
      const t = f == null ? (i + 1) / (scored.length + 1) : Math.min(1, (per - 1 + f) / n);
      pts.push({ t, d: p.home - p.away });
    });
  } else if (game.home.lines.length >= 2 && game.home.lines.length === game.away.lines.length) {
    let h = 0, a = 0;
    game.home.lines.forEach((v, i) => { h += +v || 0; a += +game.away.lines[i] || 0; pts.push({ t: (i + 1) / game.home.lines.length, d: h - a }); });
  } else return null;
  const last = pts[pts.length - 1];
  if (last.t < 1) pts.push({ t: 1, d: last.d });
  pts.sort((x, y) => x.t - y.t);
  const max = Math.max(1, ...pts.map((p) => Math.abs(p.d)));
  return { points: pts, max, periods: n };
}

export async function getGame(lg, id) {
  const L = LEAGUE[lg];
  const data = await get(url(SITE, lg, '/summary', { event: id }));
  const comp = data.header?.competitions?.[0];
  if (!comp) throw new FeedError('That game is not in the feed.', 404);
  const game = normEvent({ id: data.header.id || id, date: comp.date, competitions: [comp] }, lg);
  const plays = (data.scoringPlays || []).map((p) => ({
    text: cleanText(p.text),
    kind: cleanText(p.type?.text || p.scoringType?.displayName || ''),
    period: p.period?.number || 0,
    clock: p.clock?.displayValue || '',
    teamId: String(p.team?.id ?? ''),
    away: Number(p.awayScore), home: Number(p.homeScore),
  })).filter((p) => p.text);
  return {
    game,
    stats: statRows(data.boxscore, game.away.id, game.home.id, L.sport),
    plays,
    flow: game.state === 'final' ? momentum(game, plays, L) : null,
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
