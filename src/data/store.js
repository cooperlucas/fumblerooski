// App state that is not a screen: cached feed reads, pinned teams, demo mode.
// Everything personal stays on the device. There are no accounts and nothing is sent anywhere.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LEAGUES } from './leagues.js';
import { getScoreboard, getTeams, getDivisionTeams, setFetcher } from './espn.js';
import { demoFetch } from './fixtures.js';
import { isToday } from './headlines.js';

const ls = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode or full: carry on without it */ } },
};

/* ---------- demo mode ---------- */
// A preview build can be locked to demo data (VITE_FORCE_DEMO=1) for places that cannot reach the feed.
export const demoLocked = import.meta.env?.VITE_FORCE_DEMO === '1';
export const isDemo = () => {
  if (demoLocked) return true;
  try { if (new URLSearchParams(location.search).get('demo') === '1') return true; } catch { /* no location */ }
  return ls.get('fr.demo', false) === true;
};
export function setDemo(on) {
  ls.set('fr.demo', !!on);
  const u = new URL(location.href); u.searchParams.delete('demo'); // a ?demo=1 link would otherwise keep demo on
  history.replaceState(null, '', u.pathname + u.search + u.hash);
  location.reload();
}
if (typeof window !== 'undefined' && isDemo()) setFetcher(demoFetch);

/* ---------- pinned teams ---------- */
let favs = ls.get('fr.favs.v1', []);
const favSubs = new Set();
const emit = () => { favSubs.forEach((f) => f()); };
export const favKey = (t) => `${t.lg}:${t.id}`;
export function toggleFav(t) {
  const k = favKey(t);
  favs = favs.some((x) => favKey(x) === k)
    ? favs.filter((x) => favKey(x) !== k)
    : [...favs, { id: t.id, lg: t.lg, name: t.name, abbr: t.abbr, color: t.color }];
  ls.set('fr.favs.v1', favs); emit();
}
export function useFavs() {
  return useSyncExternalStore((cb) => { favSubs.add(cb); return () => favSubs.delete(cb); }, () => favs, () => favs);
}
export const isFavGame = (g, set) => set.has(`${g.lg}:${g.home.id}`) || set.has(`${g.lg}:${g.away.id}`);

/* ---------- league settings: which leagues show on Scores and the ticker, and in what order ---------- */
// A league that is off still lives in the Leagues tab and search, and a pinned team's games always show.
let leaguePrefs = ls.get('fr.leagues.v1', { order: [], off: [] });
const lpSubs = new Set();
const lpEmit = () => { ls.set('fr.leagues.v1', leaguePrefs); lpSubs.forEach((f) => f()); };
export function useLeaguePrefs() {
  return useSyncExternalStore((cb) => { lpSubs.add(cb); return () => lpSubs.delete(cb); }, () => leaguePrefs, () => leaguePrefs);
}
// Every league in the picked order. Leagues added to the app later land at the end, in their default spot.
export function orderLeagues(prefs = leaguePrefs) {
  const rank = new Map((prefs.order || []).map((id, i) => [id, i]));
  return LEAGUES.map((l, i) => ({ l, r: rank.has(l.id) ? rank.get(l.id) : 1000 + i })).sort((a, b) => a.r - b.r).map((x) => x.l);
}
export const isLeagueOn = (id, prefs = leaguePrefs) => !(prefs.off || []).includes(id);
export const shownLeagues = (prefs = leaguePrefs) => orderLeagues(prefs).filter((l) => isLeagueOn(l.id, prefs));
export function setLeagueOrder(ids) { leaguePrefs = { ...leaguePrefs, order: [...ids] }; lpEmit(); }
export function toggleLeague(id) {
  const off = new Set(leaguePrefs.off || []);
  if (off.has(id)) off.delete(id);
  else if (LEAGUES.length - off.size > 1) off.add(id); // at least one league stays on
  leaguePrefs = { ...leaguePrefs, off: [...off] }; lpEmit();
}
export function resetLeagues() { leaguePrefs = { order: [], off: [] }; lpEmit(); }

/* ---------- cached reads ---------- */
const cache = new Map(); // key -> { data, at }
const inflight = new Map(); // key -> promise, so two screens asking for the same thing share one read
const watchers = new Map(); // key -> Set of repaint callbacks
const FRESH = 4000;
function fetchShared(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH) return Promise.resolve(hit.data);
  if (!inflight.has(key)) {
    const p = fn().then((data) => { cache.set(key, { data, at: Date.now() }); (watchers.get(key) || []).forEach((f) => f()); return data; }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return inflight.get(key);
}

// Shows cached data right away, refetches, and keeps polling while the tab is visible.
// refresh(data) returns how many ms to wait before the next fetch (0 = do not poll).
export function useQuery(key, fn, refresh) {
  const [, bump] = useState(0);
  const st = useRef({ key: null, error: null, loading: false });
  const fnRef = useRef(fn); fnRef.current = fn;
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  if (st.current.key !== key) st.current = { key, error: null, loading: !!key && !cache.has(key) };

  useEffect(() => {
    if (!key) return undefined;
    let alive = true, timer = null;
    const run = async () => {
      clearTimeout(timer);
      try {
        await fetchShared(key, () => fnRef.current());
        if (!alive) return;
        st.current = { key, error: null, loading: false };
      } catch (e) {
        if (!alive) return;
        st.current = { key, error: e, loading: false };
      }
      bump((n) => n + 1);
      const ms = refreshRef.current ? refreshRef.current(cache.get(key)?.data) : 0;
      if (ms > 0) timer = setTimeout(() => { if (document.visibilityState === 'visible') run(); else timer = null; }, ms);
    };
    // Back in the app (phone unlocked, tab switched back): look again now if this is due, instead of waiting out a stale timer.
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const ms = refreshRef.current ? refreshRef.current(cache.get(key)?.data) : 0;
      const age = Date.now() - (cache.get(key)?.at || 0);
      if (!timer || (ms > 0 && age >= ms)) { clearTimeout(timer); timer = null; run(); }
    };
    run();
    document.addEventListener('visibilitychange', onVis);
    const repaint = () => { if (alive) bump((n) => n + 1); };
    if (!watchers.has(key)) watchers.set(key, new Set());
    watchers.get(key).add(repaint);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); watchers.get(key)?.delete(repaint); };
  }, [key]);

  const hit = key ? cache.get(key) : null;
  return {
    data: hit?.data, updatedAt: hit?.at || 0, error: st.current.error, loading: st.current.loading,
    reload: () => { st.current = { ...st.current, error: null, loading: !hit }; bump((n) => n + 1); return fnRef.current().then((data) => { cache.set(key, { data, at: Date.now() }); st.current = { key, error: null, loading: false }; bump((n) => n + 1); }).catch((e) => { st.current = { key, error: e, loading: false }; bump((n) => n + 1); }); },
  };
}

/* ---------- every league's games for one day ---------- */
export const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
export const dayOffset = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };

export async function loadDay(day) {
  const res = await Promise.allSettled(LEAGUES.map((l) => getScoreboard(l.id, day)));
  const ok = res.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw res[0].reason; // every league failed: surface it instead of showing an empty day
  return {
    games: ok.flatMap((r) => r.value.games),
    seasons: Object.fromEntries(ok.map((r) => [r.value.lg, r.value.season])),
    failed: LEAGUES.filter((_, i) => res[i].status === 'rejected').map((l) => l.id),
  };
}
// Poll fast while anything is live, slowly otherwise.
// How soon to look again at a game that has not started: often once it is close to (or past) its start time,
// so the page flips to live within seconds of the opening tip, faceoff or kickoff instead of minutes later.
export function preRefresh(g, near = 15000) {
  const t = Date.parse(g?.date || '');
  if (!Number.isFinite(t) || g?.tbd) return 300000;
  const left = t - Date.now();
  if (left < -3 * 3600000) return 300000; // hours late: a delay, not a start
  if (left <= 10 * 60000) return near;
  if (left <= 60 * 60000) return 60000;
  return 300000;
}
// A board of games: every 30 seconds while any is live, faster still as the next one is about to start.
export const boardRefresh = (d) => {
  const gs = d?.games || [];
  const pre = Math.min(300000, ...gs.filter((g) => g.state === 'pre').map((g) => preRefresh(g, 20000)));
  return gs.some((g) => g.state === 'live') ? Math.min(30000, pre) : pre;
};
// One game's page. Live: every 10 seconds, which is about how often the feed itself updates (its cache holds ~10s),
// so asking faster would only get the same answer back.
export const gameRefresh = (g) => (g?.state === 'live' ? 10000 : g?.state === 'pre' ? preRefresh(g) : 0);
export const dayRefresh = boardRefresh;
export function useDay(offset) {
  const day = ymd(dayOffset(offset));
  return useQuery(`day:${day}`, () => loadDay(day), dayRefresh);
}

const ORDER = { live: 0, pre: 1, final: 2, off: 3 };
// Your teams first, then live, then today's games before anything on another day, then by start time.
export function sortGames(games, favSet) {
  const now = new Date();
  return [...games].sort((a, b) =>
    (isFavGame(b, favSet) - isFavGame(a, favSet)) || (ORDER[a.state] === 0 ? 0 : 1) - (ORDER[b.state] === 0 ? 0 : 1) || (isToday(b, now) - isToday(a, now)) || (ORDER[a.state] - ORDER[b.state]) || String(a.date).localeCompare(String(b.date)));
}

/* ---------- team search index (cached on the device for a week) ---------- */
// One league at a time with a short breath between: asking for every league at once gets some of the reads refused.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function loadAllTeams() {
  const saved = ls.get('fr.teams.v4', null);
  // A full index (every league's real team list, with colors) is good for a week; a patched one gets rebuilt within the hour.
  if (!isDemo() && saved?.teams?.length && Date.now() - saved.at < (saved.full ? 7 * 864e5 : 36e5)) return saved.teams;
  const teams = []; let full = true, firstErr = null;
  for (const l of LEAGUES) {
    try { const t = await getTeams(l.id); teams.push(...t); if (t.source !== 'team list') full = false; }
    catch (e) { full = false; firstErr = firstErr || e; }

    if (!isDemo()) await pause(120);
  }
  if (!teams.length) throw firstErr || new Error('No teams came back.');
  if (!isDemo()) ls.set('fr.teams.v4', { at: Date.now(), teams, full });
  return teams;
}

// Smaller schools (FCS, D2, D3), loaded after the main index so search is usable right away. Cached for a week.
export async function loadLowerTeams() {
  const saved = ls.get('fr.lower.v1', null);
  if (!isDemo() && saved?.teams?.length && Date.now() - saved.at < 7 * 864e5) return saved.teams;
  const teams = [];
  for (const l of LEAGUES.filter((x) => x.college)) {
    try { teams.push(...(await getDivisionTeams(l.id)).map((t) => ({ ...t, lg: l.id }))); } catch { /* skip that league */ }
  }
  if (!isDemo() && teams.length) ls.set('fr.lower.v1', { at: Date.now(), teams });
  return teams;
}

/* ---------- appearance: dark (default), light, or follow the phone ---------- */
export const getTheme = () => { const t = ls.get('fr.theme', 'dark'); return t === 'light' || t === 'system' ? t : 'dark'; };
export function applyTheme(t = getTheme()) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  const light = t === 'light' || (t === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#F3EFE4' : '#15100C');
}
export function setTheme(t) { ls.set('fr.theme', t); applyTheme(t); }
if (typeof window !== 'undefined') {
  applyTheme();
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (getTheme() === 'system') applyTheme('system'); }); } catch { /* old browsers */ }
}
