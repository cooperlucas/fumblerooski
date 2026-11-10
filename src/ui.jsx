// Shared pieces every screen uses: team chips, game rows, headers, loading and error states.
import React from 'react';
import { LEAGUE } from './data/leagues.js';
import { isDemo, setDemo, demoLocked } from './data/store.js';
import { liveColor } from './data/espn.js';

/* ---------- navigation: plain hash routes so the phone's back button just works ---------- */
// The demo-locked preview keeps its route in memory instead, since its host does not pass path-style hashes through.
const mem = { stack: [''], subs: new Set() };
// Coming back to a screen (back button or swipe) should put it back the way it was: same filters, same scroll.
// Going to a screen fresh starts it clean.
let forward = false, wentBack = false;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { wentBack = !forward; forward = false; });
const sticky = new Map(); // path -> { name: value, scroll: number }
let lastPath = null;
// Called by the app on every render with the current path: decides whether this visit restores or starts clean.
export function enterRoute(path) {
  if (path === lastPath) return false;
  lastPath = path;
  const back = wentBack; wentBack = false;
  if (!back) sticky.delete(path);
  return back;
}
const bucket = (path) => { if (!sticky.has(path)) sticky.set(path, {}); return sticky.get(path); };
// useState that survives leaving the screen and coming back to it.
export function useSticky(name, init) {
  const path = lastPath;
  const b = bucket(path);
  const [v, setV] = React.useState(() => (name in b ? b[name] : typeof init === 'function' ? init() : init));
  const set = React.useCallback((x) => setV((old) => { const nv = typeof x === 'function' ? x(old) : x; bucket(path)[name] = nv; return nv; }), [path, name]);
  return [v, set];
}
export const saveScroll = (top) => { if (lastPath != null) bucket(lastPath).scroll = top; };
export const savedScroll = (path) => sticky.get(path)?.scroll || 0;
const tell = () => mem.subs.forEach((f) => f());
export const go = (path) => { if (demoLocked) { mem.stack.push(path); tell(); } else { forward = true; location.hash = '#/' + path; } };
export const back = () => {
  if (demoLocked) { wentBack = true; if (mem.stack.length > 1) mem.stack.pop(); else mem.stack = ['']; tell(); }
  else if (history.length > 1) history.back(); else go('');
};
const split = (p) => p.split('/').filter(Boolean).map(decodeURIComponent);
export function useRoute() {
  const read = () => (demoLocked ? split(mem.stack[mem.stack.length - 1]) : split(location.hash.replace(/^#\/?/, '')));
  const [parts, setParts] = React.useState(read);
  React.useEffect(() => {
    const on = () => setParts(read());
    if (demoLocked) { mem.subs.add(on); return () => mem.subs.delete(on); }
    window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

/* ---------- formatting ---------- */
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
export const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' }); };
export function statusLabel(g) {
  if (g.state === 'live') return g.statusText || 'Live';
  if (g.state === 'final') return g.statusText || 'Final';
  if (g.state === 'off') return g.statusText || 'Postponed';
  const d = new Date(g.date);
  if (isNaN(d)) return 'TBD';
  if (g.tbd) return sameDay(d, new Date()) ? 'TBD' : fmtDate(g.date);
  return sameDay(d, new Date()) ? fmtTime(g.date) : fmtDate(g.date);
}
export const statusColor = (g) => (g.state === 'live' ? 'var(--pink)' : g.state === 'final' ? 'var(--soft)' : g.state === 'off' ? 'var(--mute)' : 'var(--teal)');

function lumOf(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return 0.2;
  const n = parseInt(m[1], 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/* ---------- building blocks ---------- */
// Teams are a colored chip with their abbreviation. No logos: those need a license.
export function Blob({ team, size = 28, radius }) {
  const bg = liveColor(team);
  const light = lumOf(bg) > 0.33;
  return (
    <span className="blob" aria-hidden="true" style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.28), background: bg, color: light ? '#0C1124' : '#fff', overflow: 'hidden', fontStretch: team.abbr.length > 3 ? '100%' : undefined, fontSize: Math.max(7, Math.round(size * (team.abbr.length > 3 ? 0.25 : 0.3))) }}>
      {team.abbr}
    </span>
  );
}
export function LgTag({ lg }) {
  const L = LEAGUE[lg];
  return <span className="lgtag" style={{ background: L.color + '26', color: L.color }}>{L.short}</span>;
}
export const H2 = ({ children }) => <h2 className="h2">{children}</h2>;

export function GameRow({ g, showLg = true }) {
  const fin = g.state === 'final', pre = g.state === 'pre' || g.state === 'off';
  const h = parseInt(g.home.score, 10), a = parseInt(g.away.score, 10);
  const lose = (mine, theirs) => fin && Number.isFinite(mine) && Number.isFinite(theirs) && mine < theirs;
  const side = (t, mine, theirs) => (
    <span className={'side' + (lose(mine, theirs) ? ' lose' : '')}>
      <Blob team={t} />
      <span className="nm">{t.rank ? <span className="rk">{t.rank}</span> : null}{t.name} <small>{t.record}</small></span>
      <span className="sc">{pre ? '' : t.score}</span>
    </span>
  );
  const label = statusLabel(g);
  return (
    <button className="grow" onClick={() => go(`game/${g.lg}/${g.id}`)}
      aria-label={`${g.away.name} ${pre ? 'at' : g.away.score + ','} ${g.home.name}${pre ? '' : ' ' + g.home.score}, ${label}`}>
      <span className="sides">{side(g.away, a, h)}{side(g.home, h, a)}</span>
      <span className="meta">
        <span className="stat" style={{ color: statusColor(g) }}>{g.state === 'live' ? <span className="dot" aria-hidden="true" /> : null}<span>{label}</span></span>
        {g.state === 'final' && !sameDay(new Date(g.date), new Date()) && !isNaN(new Date(g.date)) ? <span className="gdate">{fmtDate(g.date)}</span> : null}
        {showLg ? <LgTag lg={g.lg} /> : null}
      </span>
    </button>
  );
}

/* ---------- states ---------- */
export const Loading = ({ rows = 4 }) => (
  <div role="status" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ animationDelay: `${i * 120}ms` }} />)}</div>
);
export function Problem({ error, retry }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <div className="err" role="alert">
      <h3>{offline ? "You're offline" : 'No scores right now'}</h3>
      <p>{offline ? 'Reconnect and the scores will come right back.' : (error?.message || 'The scores feed did not answer.')}</p>
      <div className="row">
        {retry ? <button className="btn on" onClick={retry}>Try again</button> : null}
        {!isDemo() ? <button className="btn" onClick={() => setDemo(true)}>See it with demo data</button> : null}
      </div>
    </div>
  );
}
export const Empty = ({ children }) => <div className="note">{children}</div>;
export function Stamp({ at, live }) {
  if (!at) return null;
  return <p className="stamp">Updated {new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{live ? ' · refreshing every 30 seconds' : ''}</p>;
}

/* ---------- chrome ---------- */
const SearchIcon = () => (<svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" /><path d="M15.5 15.5 L21 21" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>);

export function Mascot() {
  return (
    <svg className="mascot" width="54" height="42" viewBox="0 0 64 50" aria-hidden="true">
      <defs>
        <linearGradient id="frBall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#C97A47" /><stop offset="1" stopColor="#7A3B1C" /></linearGradient>
        <clipPath id="frBallClip"><ellipse cx="38" cy="25" rx="21" ry="14" transform="rotate(-20 38 25)" /></clipPath>
      </defs>
      <path d="M4 16 H22" stroke="#22D3D6" strokeWidth="4" strokeLinecap="round" />
      <path d="M9 23 H20" stroke="#F5F5F7" strokeWidth="4" strokeLinecap="round" />
      <path d="M2 30 H20" stroke="#8B5CF6" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="41" cy="28" rx="21" ry="14" transform="rotate(-20 41 28)" fill="#6E3AB5" />
      <ellipse cx="38" cy="25" rx="21" ry="14" transform="rotate(-20 38 25)" fill="url(#frBall)" />
      <g clipPath="url(#frBallClip)">
        <path d="M7.7 29.0 L64.1 8.6 L62.1 3.1 L5.8 23.4 Z" fill="#22D3D6" />
        <path d="M6.8 26.2 L63.1 5.8" stroke="#FFFFFF" strokeWidth="1.2" />
      </g>
      <ellipse cx="38" cy="25" rx="21" ry="14" transform="rotate(-20 38 25)" fill="none" stroke="#0C1124" strokeWidth="2.6" />
      <ellipse cx="32.5" cy="27" rx="3.8" ry="3.3" fill="#FFFFFF" />
      <ellipse cx="44" cy="22.8" rx="3.8" ry="3.3" fill="#FFFFFF" />
      <circle cx="33.6" cy="27.4" r="1.8" fill="#0C1124" />
      <circle cx="45.1" cy="23.2" r="1.8" fill="#0C1124" />
      <path d="M28.6 23.2 L35.6 24.2 M40.8 20.6 L47.4 17.4" stroke="#0C1124" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M35.5 33.5 q6 1.8 11 -3.2" fill="none" stroke="#0C1124" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function RootHeader() {
  return (
    <>
      <header className="head">
        <Mascot />
        <div style={{ minWidth: 0 }}>
          <h1 className="brand">Fumblerooski</h1>
          <div className="tagline">Pure sports · No odds · No ads</div>
        </div>
        <button className="round" style={{ marginLeft: 'auto' }} aria-label="Search" onClick={() => go('search')}><SearchIcon /></button>
      </header>
      <div className="stripes" aria-hidden="true" />
    </>
  );
}
export function SubHeader({ title, children }) {
  return (
    <header className="head">
      <button className="round" aria-label="Back" onClick={back}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4 L7 12 L15 20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {children || (<>
        <h1 className="subtitle">{title}</h1>
        <button className="round" aria-label="Search" onClick={() => go('search')}><SearchIcon /></button>
      </>)}
    </header>
  );
}

const TABS = [
  ['', 'Scores', <g key="p" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" strokeWidth="2.2" /><path d="M12 5 V19 M7 10 V14 M15.5 10 H18 V14 H15.5" strokeWidth="2" /></g>],
  ['leagues', 'Leagues', <path key="p" d="M7 4 H17 V9 A5 5 0 0 1 7 9 Z M12 14 V18 M8 20 H16 M7 6 H4 V8 A3 3 0 0 0 7 11 M17 6 H20 V8 A3 3 0 0 1 17 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />],
  ['stats', 'Stats', <path key="p" d="M5 20 V11 M12 20 V4 M19 20 V14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />],
];
export function TabBar({ active }) {
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map(([path, label, icon]) => (
        <button key={label} className="tab" aria-current={active === path ? 'page' : undefined} onClick={() => go(path)}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
export const DemoBar = () => (isDemo() ? <div className="demo">DEMO DATA, NOT REAL SCORES{demoLocked ? null : <button onClick={() => setDemo(false)}>Go live</button>}</div> : null);
