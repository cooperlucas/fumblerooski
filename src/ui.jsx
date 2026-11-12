// Shared pieces every screen uses: team chips, game rows, headers, loading and error states.
import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';
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

/* ---------- event names (bowls, playoffs, tournaments) trimmed to fit one line ---------- */
// Bowl names without their sponsors. Longest first, so "New Orleans" wins over "Orleans".
const BOWLS = ['Salute to Veterans', 'First Responder', 'Armed Forces', 'Independence', 'Myrtle Beach', 'Boca Raton', 'New Orleans', 'New Mexico', 'Las Vegas',
  'Music City', 'Gasparilla', 'Celebration', 'Birmingham', 'Pinstripe', "Duke's Mayo", 'Pop-Tarts', 'ReliaQuest', 'Camellia', 'Quick Lane', 'Guaranteed Rate', 'Rate',
  'Holiday', 'Liberty', 'Citrus', 'Alamo', 'Gator', 'Fenway', 'Frisco', 'Arizona', 'Texas', 'Military', 'Cure', 'Rose', 'Sugar', 'Orange', 'Cotton', 'Peach', 'Fiesta',
  'Outback', 'Sun', 'Potato', 'Hawaiʻi', 'Hawaii', 'Bahamas', 'LA', 'Lending Tree', 'LendingTree', '68 Ventures', 'GameAbove Sports', 'Cheez-It'];
const coreBowl = (name) => {
  const n = name.replace(/\s+Classic$/i, '');
  const hit = BOWLS.find((b) => new RegExp(`(^|\\s)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+Bowl$`, 'i').test(n));
  return hit ? `${hit} Bowl` : n;
};
// Does this text overflow its box? Safari can report a clipped, ellipsized line as fitting, so measure a hidden copy at full width instead.
// Italics hang past their box a little, so leave a few pixels of slack.
export function overflows(el, slack = 3) {
  if (!el || !el.parentElement) return false;
  const c = el.cloneNode(true);
  Object.assign(c.style, { position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0', width: 'auto', maxWidth: 'none', overflow: 'visible', whiteSpace: el.style.whiteSpace === 'normal' ? 'normal' : 'nowrap' });
  // A shrink-wrapped name (a centered flex item, say) is only as wide as its text, so the room it has is its parent's content box.
  const par = el.parentElement, ps = getComputedStyle(par);
  const avail = Math.max(el.clientWidth, par.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight));
  if (el.style.whiteSpace === 'normal') c.style.width = `${avail}px`;
  par.appendChild(c);
  const over = el.style.whiteSpace === 'normal' ? c.scrollWidth > avail + 1 : c.getBoundingClientRect().width > avail - slack;
  c.remove();
  return over || el.scrollWidth > el.clientWidth + 1;
}
// An event label (all caps, letter-spaced) that tightens, then shrinks, to fit its line before it ever cuts off.
export function GameNote({ text }) {
  const ref = useRef(null);
  const steps = [[10, 0.08], [10, 0.04], [9.5, 0.02], [9, 0.02], [8.5, 0.01], [8, 0]];
  const [i, setI] = useState(0);
  useLayoutEffect(() => { setI(0); }, [text]);
  useEffect(() => { const again = () => setI(0); window.addEventListener('resize', again); document.fonts?.ready?.then(again); return () => window.removeEventListener('resize', again); }, []);
  useLayoutEffect(() => { const el = ref.current; if (el && i < steps.length - 1 && overflows(el, 1)) setI(i + 1); });
  return <span ref={ref} className="gnote" style={{ fontSize: steps[i][0], letterSpacing: `${steps[i][1]}em` }}>{text}</span>;
}
export function shortEvent(note) {
  let n = String(note || '').replace(/\s+-\s+Rescheduled.*$/i, '').replace(/\s+(presented|pres\.?|powered|driven)\s+by\b.*$/i, '').trim();
  n = n.replace(/College Football Playoff/gi, 'CFP').replace(/NCAA (Men's|Women's) Basketball Championship/i, 'NCAA Tournament')
    .replace(/\bNational Championship\b/i, 'Title Game').replace(/\s+Region\b/i, '').replace(/\bFirst Round\b/i, '1st Round').replace(/\bSecond Round\b/i, '2nd Round');
  // Conference title games: the short names everyone uses.
  n = n.replace(/\bAmerican Athletic( Conference)?\b/i, 'AAC').replace(/\bConference USA\b/i, 'CUSA').replace(/\bMid-American( Conference)?\b/i, 'MAC')
    .replace(/\bMountain West( Conference)?\b/i, 'MW').replace(/\bAtlantic Coast Conference\b/i, 'ACC').replace(/\bSoutheastern Conference\b/i, 'SEC')
    .replace(/\b(ACC|SEC|AAC|MAC|MW|CUSA|Big Ten|Big 12|Sun Belt|Pac-12) Football Championship( Game)?\b/i, '$1 Championship')
    .replace(/\b(ACC|SEC|AAC|MAC|MW|CUSA|Big Ten|Big 12|Sun Belt|Pac-12) Championship Game\b/i, '$1 Championship');
  const at = /^(.*?)\s+at the\s+(.+)$/i.exec(n); // "CFP Quarterfinal at the Allstate Sugar Bowl"
  if (at) return `${at[1]} · ${coreBowl(at[2])}`;
  if (/\bBowl(\s+Classic)?$/i.test(n)) return coreBowl(n);
  return n.replace(/\s+-\s+/g, ' · ');
}

/* ---------- building blocks ---------- */
// A team chip with its poll rank in a gold tag on the top-left corner, the way the team page shows it.
export function RankBlob({ team, rank, size = 28, radius }) {
  if (!rank) return <Blob team={team} size={size} radius={radius} />;
  // Small chips (schedules, score rows) get a small tag that sits on the corner without burying the abbreviation.
  const big = size > 40;
  const h = big ? Math.round(size * 0.42) : Math.max(11, Math.round(size * 0.38)), off = big ? -Math.round(size * 0.16) : -4;
  return (
    <span className="rblob" style={{ position: 'relative', display: 'inline-flex', flex: 'none' }}>
      <Blob team={team} size={size} radius={radius} />
      <b className="rtag" aria-label={`Ranked ${rank}`} style={{ top: off, left: off, minWidth: h, height: h, fontSize: big ? Math.round(h * 0.54) : Math.max(7.5, h * 0.62), padding: big ? undefined : '0 2px', borderRadius: Math.round(h * 0.3), boxShadow: `${big ? 2 : 1}px ${big ? 2 : 1}px 0 #0C1124` }}>{rank}</b>
    </span>
  );
}
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

// A tiny football beside the team with the ball. Red inside the 20.
export const Ball = ({ red }) => (
  <svg className={'possball' + (red ? ' rz' : '')} viewBox="0 0 24 14" aria-label={red ? 'Has the ball, red zone' : 'Has the ball'} role="img">
    <ellipse cx="12" cy="7" rx="11" ry="6.2" />
    <path d="M7.5 7h9M9.5 5.2v3.6M12 5.2v3.6M14.5 5.2v3.6" />
  </svg>
);
// Network names short enough for a score row: "ACC Network" reads "ACC Net".
export const shortTv = (n) => String(n || '').replace(/\bNetwork\b/i, 'Net').replace(/^Big Ten Net$/i, 'BTN').replace(/^Prime Video$/i, 'Prime');
export function GameRow({ g, showLg = true }) {
  const fin = g.state === 'final', pre = g.state === 'pre' || g.state === 'off';
  const h = parseInt(g.home.score, 10), a = parseInt(g.away.score, 10);
  const lose = (mine, theirs) => fin && Number.isFinite(mine) && Number.isFinite(theirs) && mine < theirs;
  const side = (t, mine, theirs) => (
    <span className={'side' + (lose(mine, theirs) ? ' lose' : '')}>
      <RankBlob team={t} rank={t.rank} />
      <span className="nm"><span className="nmt">{t.name} <small>{t.record}</small></span>{g.poss && g.poss === String(t.id) ? <Ball red={g.redZone} /> : null}</span>
      <span className="sc">{pre ? '' : t.score}</span>
    </span>
  );
  const label = statusLabel(g);
  return (
    <button className="grow" onClick={() => go(`game/${g.lg}/${g.id}`)}
      aria-label={`${g.away.name} ${pre ? 'at' : g.away.score + ','} ${g.home.name}${pre ? '' : ' ' + g.home.score}, ${label}`}>
      <span className="sides">{g.note ? <GameNote text={shortEvent(g.note)} /> : null}{side(g.away, a, h)}{side(g.home, h, a)}</span>
      <span className="meta">
        <span className={'stat' + (pre ? ' pre' : '')} style={{ color: statusColor(g) }}>{g.state === 'live' ? <span className="dot" aria-hidden="true" /> : null}<span>{label}</span></span>
        {/* A game on another day shows its date up top; the start time goes under it when it is set. */}
        {g.state === 'pre' && !g.tbd && !isNaN(new Date(g.date)) && !sameDay(new Date(g.date), new Date()) ? <span className="gtime">{fmtTime(g.date)}</span> : null}
        {g.down ? <span className={'gdd' + (g.redZone ? ' rz' : '')}><b>{g.down}</b>{g.spot ? <span>{g.spot}</span> : null}</span> : null}
        {g.state !== 'final' && g.tv?.national?.length ? <span className="gtv">{shortTv(g.tv.national[0])}</span> : null}
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
// Only while something is live, and small: a quiet sign the scores are moving on their own.
export function Stamp({ at, live }) {
  if (!at || !live) return null;
  return <p className="stamp tiny"><span className="dot" aria-hidden="true" />Live · updates on its own</p>;
}

/* ---------- chrome ---------- */
const SearchIcon = () => (<svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" /><path d="M15.5 15.5 L21 21" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>);
// Home header buttons: chunky sticker icons in the app's throwback colors.
const RooSearch = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15.2 15.2 L20.6 20.6" stroke="#0C1124" strokeWidth="4.6" strokeLinecap="round" />
    <path d="M15.6 15.6 L20.2 20.2" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
    <circle cx="10" cy="10" r="6.6" fill="#F4FAFF" stroke="#0C1124" strokeWidth="2.6" />
    <path d="M6.9 9.2 A3.4 3.4 0 0 1 9.4 6.6" fill="none" stroke="#22D3D6" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
function gearPath(cx, cy, R, r, n, base = 0.95, top = 0.5) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n - Math.PI / 2, w = Math.PI / n; // first tooth points straight up
    [[a - w * base, r], [a - w * top, R], [a + w * top, R], [a + w * base, r]].forEach(([t, rad]) => pts.push(`${(cx + rad * Math.cos(t)).toFixed(2)},${(cy + rad * Math.sin(t)).toFixed(2)}`));
  }
  return `M${pts.join(' L')} Z`;
}
const GEAR = gearPath(12, 12, 11, 8, 6, 0.6, 0.36);
const RooGear = () => (
  <svg className="gearsvg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d={GEAR} fill="#0C1124" strokeLinejoin="round" />
    {/* a baseball for the hub: reads like a gear's hole, with red stitches */}
    <circle cx="12" cy="12" r="3.5" fill="#F4FAFF" />
    <path d="M10.2 9.5 Q11.5 12 10.2 14.5 M13.8 9.5 Q12.5 12 13.8 14.5" fill="none" stroke="#E0263C" strokeWidth="0.9" strokeLinecap="round" />
  </svg>
);

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

// Text that shrinks to the room it has, measured on the real font (the wide Archivo can take a beat to load).
function useFit(base, floor, slack = 0) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      el.style.fontSize = `${base}px`;
      const need = el.getBoundingClientRect().width + slack, have = el.parentElement.clientWidth;
      if (need > have) el.style.fontSize = `${Math.max(floor, Math.floor((base * have / need) * 10) / 10)}px`;
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el.parentElement);
    document.fonts?.ready?.then(fit);
    document.fonts?.addEventListener?.('loadingdone', fit);
    return () => { ro?.disconnect(); document.fonts?.removeEventListener?.('loadingdone', fit); };
  }, [base, floor, slack]);
  return ref;
}
function FitBrand() {
  const ref = useFit(22, 13, 6); // a few px for the italic lean and shadow
  return <h1 ref={ref} className="brand">Fumblerooski</h1>;
}
function FitTagline() {
  const ref = useFit(10, 7, 2);
  return <div ref={ref} className="tagline">Pure sports · No odds · No ads</div>;
}
export function RootHeader() {
  return (
    <>
      <header className="head">
        <Mascot />
        <div className="brandbox">
          <FitBrand />
          <FitTagline />
        </div>
        <div className="headbtns">
          <button className="roobtn srch" aria-label="Search" onClick={() => go('search')}><RooSearch /></button>
          <button className="roobtn gear" aria-label="Settings" onClick={() => go('settings')}><RooGear /></button>
        </div>
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
