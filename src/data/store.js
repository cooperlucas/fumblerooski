// App state that is not a screen: cached feed reads, pinned teams, demo mode.
// Everything personal stays on the device. There are no accounts and nothing is sent anywhere.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LEAGUES } from './leagues.js';
import { getScoreboard, getTeams, setFetcher } from './espn.js';
import { demoFetch } from './fixtures.js';

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
    const onVis = () => { if (document.visibilityState === 'visible' && !timer) run(); };
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
export const dayRefresh = (d) => (d?.games?.some((g) => g.state === 'live') ? 30000 : 300000);
export function useDay(offset) {
  const day = ymd(dayOffset(offset));
  return useQuery(`day:${day}`, () => loadDay(day), dayRefresh);
}

const ORDER = { live: 0, pre: 1, final: 2, off: 3 };
export function sortGames(games, favSet) {
  return [...games].sort((a, b) =>
    (isFavGame(b, favSet) - isFavGame(a, favSet)) || (ORDER[a.state] - ORDER[b.state]) || String(a.date).localeCompare(String(b.date)));
}

/* ---------- team search index (cached on the device for a week) ---------- */
export async function loadAllTeams() {
  const saved = ls.get('fr.teams.v2', null);
  if (!isDemo() && saved && Date.now() - saved.at < 7 * 864e5 && saved.teams?.length) return saved.teams;
  const res = await Promise.allSettled(LEAGUES.map((l) => getTeams(l.id)));
  const teams = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!teams.length) throw res[0].reason;
  if (!isDemo()) ls.set('fr.teams.v2', { at: Date.now(), teams });
  return teams;
}
