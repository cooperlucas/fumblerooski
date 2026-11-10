import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LEAGUES, LEAGUE } from './data/leagues.js';
import { getStandings, DIVISIONS, FULL_DIVISIONS, getTeam, getGame, getScoreboard, getTeams, getRoster, getPlayer, searchPlayers, getRankings, getRecords, getTeamNames, getTeamStatsFor, getLeaders, getDeepLeader, canGoDeep, getTeamStats, ensureColors, onColors, listTeams, pctOf, PCT_COLS } from './data/espn.js';
import { useQuery, useDay, useFavs, toggleFav, favKey, isFavGame, sortGames, dayOffset, loadAllTeams, loadLowerTeams, isDemo, setDemo, demoLocked, getTheme, setTheme } from './data/store.js';
import { chartColors, inkOn } from './data/colors.js';
import { go, useRoute, Blob, LgTag, H2, GameRow, Loading, Problem, Empty, Stamp, RootHeader, SubHeader, TabBar, DemoBar, statusLabel, fmtDate, fmtTime, enterRoute, useSticky, saveScroll, savedScroll, shortEvent } from './ui.jsx';

/* ---------- router ---------- */
const ROOTS = new Set(['', 'scores', 'leagues', 'stats']);

export default function App() {
  const parts = useRoute();
  const path = parts.join('/');
  const back = enterRoute(path);
  // Back to a screen: return to where it was scrolled, once its content is there to scroll.
  useEffect(() => {
    const target = back ? savedScroll(path) : 0;
    if (!target) return undefined;
    let tries = 0;
    const t = setInterval(() => {
      const el = document.querySelector('.page');
      if (el) { el.scrollTop = target; if (Math.abs(el.scrollTop - target) < 4 || ++tries > 40) clearInterval(t); } else if (++tries > 40) clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [path]);
  useEffect(() => {
    const on = (e) => { if (e.target?.classList?.contains('page')) saveScroll(e.target.scrollTop); };
    document.addEventListener('scroll', on, true);
    return () => document.removeEventListener('scroll', on, true);
  }, []);
  const [, repaint] = useState(0);
  useEffect(() => onColors(() => repaint((n) => n + 1)), []);
  const [name = '', a, b, c] = parts;
  const root = ROOTS.has(name);
  let title = '', body, tab = name;
  if (name === '' || name === 'scores') { tab = ''; body = <Scores />; }
  else if (name === 'leagues') body = <Leagues />;
  else if (name === 'stats') body = <Stats key={a || 'x'} start={LEAGUE[a] ? a : null} />;
  else if (name === 'league' && LEAGUE[a]) { title = LEAGUE[a].name; tab = 'leagues'; body = <LeaguePage key={a + (b || '') + (c || '')} lg={a} focus={b === 'scores' ? undefined : b} start={b === 'scores' ? 'scores' : undefined} startDay={b === 'scores' && /^\d{8}$/.test(c || '') ? c : undefined} />; }
  else if (name === 'team' && LEAGUE[a] && b) { tab = 'leagues'; body = <TeamPage key={a + b} lg={a} id={b} />; }
  else if (name === 'player' && LEAGUE[a] && b) { tab = 'leagues'; body = <PlayerPage key={a + b} lg={a} id={b} />; }
  else if (name === 'game' && LEAGUE[a] && b) { tab = ''; body = <GamePage key={a + b} lg={a} id={b} />; }
  else if (name === 'search') { tab = ''; body = <Search />; }
  else if (name === 'about') { title = 'About'; tab = 'leagues'; body = <About />; }
  else { title = 'Not found'; body = <Empty>That page does not exist. <br /><button className="btn" onClick={() => go('')}>Go home</button></Empty>; }

  // Team, game and search screens draw their own header (they know the title or own the search box).
  const ownHeader = name === 'team' || name === 'game' || name === 'search' || name === 'player';
  return (
    <div className="app">
      <DemoBar />
      {root ? <RootHeader /> : ownHeader ? null : <SubHeader title={title} />}
      {ownHeader ? body : <main className="page" key={parts.join('/')}><div className="enter">{body}</div></main>}
      <Ticker />
      <TabBar active={tab} />
    </div>
  );
}
const Page = ({ children }) => <main className="page"><div className="enter">{children}</div></main>;

/* ---------- Bottom ticker: today's scores crawling by, league by league, like an old sports channel ---------- */
function Ticker() {
  const today = useDay(0);
  const morning = isMorning();
  const yest = useDay(morning ? -1 : 0);
  const track = useRef(null);
  const [secs, setSecs] = useState(60);
  const groups = useMemo(() => {
    const rank = { live: 0, final: 1, pre: 2, off: 3 };
    const pool = [...(morning ? (yest.data?.games || []) : []), ...(today.data?.games || [])];
    return LEAGUES.map((l) => ({ l, games: pool.filter((g) => g.lg === l.id).sort((a, b) => rank[a.state] - rank[b.state] || String(a.date).localeCompare(String(b.date))) })).filter((x) => x.games.length);
  }, [today.data, yest.data, morning]);
  const count = groups.reduce((n, x) => n + x.games.length, 0);
  // Constant crawl speed no matter how many games are on.
  useLayoutEffect(() => { if (track.current) setSecs(Math.max(20, Math.round(track.current.scrollWidth / 2 / 55))); }, [count]);
  if (!count) return null;
  const run = (copy) => groups.map(({ l, games }) => (
    <React.Fragment key={l.id + copy}>
      <span className="tlg" style={{ background: l.color }}>{l.short}</span>
      {games.map((g) => {
        const pre = g.state === 'pre' || g.state === 'off', fin = g.state === 'final';
        const a = parseInt(g.away.score, 10), h = parseInt(g.home.score, 10);
        return (
          <button key={g.id + copy} className="titem" tabIndex={copy ? -1 : 0} aria-hidden={copy ? 'true' : undefined} onClick={() => go(`game/${g.lg}/${g.id}`)}
            aria-label={`${l.short}: ${g.away.abbr} ${pre ? 'at' : g.away.score} ${g.home.abbr}${pre ? '' : ' ' + g.home.score}, ${statusLabel(g)}`}>
            <span className={fin && a < h ? 'dim' : undefined}>{g.away.abbr}{pre ? '' : <b> {g.away.score}</b>}</span>
            <span className="at">{pre ? 'at' : ''}</span>
            <span className={fin && h < a ? 'dim' : undefined}>{g.home.abbr}{pre ? '' : <b> {g.home.score}</b>}</span>
            <span className="tst" style={{ color: g.state === 'live' ? 'var(--pink)' : g.state === 'pre' ? 'var(--teal)' : 'var(--mute)' }}>{statusLabel(g).toUpperCase()}</span>
          </button>
        );
      })}
    </React.Fragment>
  ));
  return (
    <div className="ticker" role="region" aria-label="Today's scores">
      <div className="ttrack" ref={track} style={{ animationDuration: `${secs}s` }}>{run('')}{run('b')}</div>
    </div>
  );
}

/* ---------- Scores ---------- */
const DAYS = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
const ymdDash = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Small-college teams (D2, D3 and the like) turn up as opponents, but the feed has no rosters or player pages for them.
// A college team counts as covered when it is in its league's standings; pro leagues are always covered.
function useCovered(lg) {
  const college = !!LEAGUE[lg]?.college;
  const [top, second] = FULL_DIVISIONS[lg] || [];
  const a = useQuery(college ? `standings:${lg}:${top}` : null, () => getStandings(lg, top), () => 600000);
  const b = useQuery(college && second ? `standings:${lg}:${second}` : null, () => getStandings(lg, second), () => 600000);
  return useMemo(() => (college ? new Set([a.data, b.data].flatMap((d) => (d?.groups || []).flatMap((g) => g.rows.map((r) => r.team.id)))) : null), [college, a.data, b.data]);
}
const isCovered = (set, id) => !set || set.has(String(id));
// Until noon the ticker leads with last night's finals (the Scores board shows only the day you pick).
const MORNING_UNTIL = 12;
const isMorning = () => new Date().getHours() < MORNING_UNTIL;

// One day's games: your teams first, then each league in its own card.
function Board({ games, pick, favSet, title }) {
  const shown = games.filter((g) => pick === 'all' || g.lg === pick);
  const mine = sortGames(shown.filter((g) => isFavGame(g, favSet)), favSet);
  const leagues = LEAGUES.filter((l) => shown.some((g) => g.lg === l.id && !isFavGame(g, favSet)));
  return (
    <>
      {title ? <div className="sechead" style={{ marginTop: 22 }}><H2>{title}</H2></div> : null}
      {!shown.length ? <Empty>No {pick === 'all' ? '' : LEAGUE[pick].short + ' '}games.</Empty> : null}
      {mine.length ? (
        <div className="card">
          <div className="lghead" style={{ cursor: 'default' }}><b style={{ color: 'var(--yellow)' }}>Your Teams</b><span>{mine.length} {mine.length === 1 ? 'game' : 'games'}</span></div>
          {mine.map((g) => <GameRow key={g.lg + g.id} g={g} />)}
        </div>
      ) : null}
      {leagues.map((l) => {
        const list = sortGames(shown.filter((g) => g.lg === l.id && !isFavGame(g, favSet)), favSet);
        return (
          <div className="card" key={l.id}>
            <button className="lghead" onClick={() => go(`league/${l.id}/scores${l.sport === 'football' ? '' : '/' + ymdOf(new Date([...list].map((g) => g.date).sort()[0]))}`)}><b style={{ color: l.color }}>{l.name}</b><span>{list.length} {list.length === 1 ? 'game' : 'games'} ›</span></button>
            {list.map((g) => <GameRow key={g.id} g={g} showLg={false} />)}
          </div>
        );
      })}
    </>
  );
}

// The day's best games per league for Top Events: your teams, then live, then ranked matchups, then by start time.
const RANKED = (g) => (g.away.rank ? 1 : 0) + (g.home.rank ? 1 : 0);
function topOf(games, favSet, n) {
  const order = { live: 0, pre: 1, final: 2, off: 3 };
  return [...games].sort((a, b) => (isFavGame(b, favSet) - isFavGame(a, favSet)) || (order[a.state] - order[b.state]) || (RANKED(b) - RANKED(a)) || String(a.date).localeCompare(String(b.date))).slice(0, n);
}

function Scores() {
  const [lg, setLg] = useSticky('lg', 'top');
  const favs = useFavs();
  const favSet = useMemo(() => new Set(favs.map(favKey)), [favs]);
  const day = useDay(0);
  const pickL = LEAGUE[lg] ? lg : null;
  // A league's own slate: today, or this week for football.
  const sb0 = useQuery(pickL ? `board:${pickL}` : null, () => getScoreboard(pickL), (d) => (d?.games?.some((g) => g.state === 'live') ? 30000 : 300000));
  // The feed's default slate is its latest match day, which can be finished. When it is, add the next game day underneath.
  const todayKey = ymdOf(new Date());
  const baseDay = sb0.data?.current?.day ? sb0.data.current.day.replace(/-/g, '') : null;
  const nextDay = sb0.data?.dates && baseDay && baseDay < todayKey ? [...sb0.data.dates].map((x) => x.replace(/-/g, '')).sort().find((x) => x >= todayKey) : null;
  const sbNext = useQuery(pickL && nextDay ? `board:${pickL}:d${nextDay}` : null, () => getScoreboard(pickL, nextDay), (d) => (d?.games?.some((g) => g.state === 'live') ? 30000 : 300000));
  const sb = sb0;
  const today = day.data?.games || [];
  const mine = sortGames(today.filter((g) => isFavGame(g, favSet)), favSet);
  const leagues = LEAGUES.filter((l) => today.some((g) => g.lg === l.id && !isFavGame(g, favSet)));
  const q = pickL ? sb : day;
  return (
    <>
      <div className="chips" role="group" aria-label="League">
        <button className="chipb" aria-pressed={!pickL} onClick={() => setLg('top')}>Top Events</button>
        {LEAGUES.map((l) => <button key={l.id} className="chipb" aria-pressed={pickL === l.id} onClick={() => setLg(l.id)}>{l.short}</button>)}
      </div>
      {q.loading && !q.data ? <Loading rows={5} /> : q.error && !q.data ? <Problem error={q.error} retry={q.reload} /> : !pickL ? (
        !today.length ? <Empty>No games on the board today.</Empty> : (
          <>
            {mine.length ? (
              <div className="card" style={{ marginTop: 14 }}>
                <div className="lghead" style={{ cursor: 'default' }}><b style={{ color: 'var(--yellow)' }}>Your Teams</b><span>{mine.length} {mine.length === 1 ? 'game' : 'games'}</span></div>
                {mine.map((g) => <GameRow key={g.lg + g.id} g={g} />)}
              </div>
            ) : null}
            {leagues.map((l) => {
              const all = today.filter((g) => g.lg === l.id && !isFavGame(g, favSet));
              return (
                <div className="card" key={l.id} style={{ marginTop: 14 }}>
                  <div className="lghead" style={{ cursor: 'default' }}><b style={{ color: l.color }}>{l.name}</b>
                    <button className="link" onClick={() => setLg(l.id)}>See all{all.length > 4 ? ` ${all.length}` : ''} ›</button></div>
                  {topOf(all, favSet, 4).map((g) => <GameRow key={g.id} g={g} showLg={false} />)}
                </div>
              );
            })}
          </>
        )
      ) : (
        <>
          <div className="sechead" style={{ marginTop: 14 }}>
            <H2>{LEAGUE[pickL].name}</H2>
            <button className="link" onClick={() => go(`league/${pickL}`)}>Standings ›</button>
          </div>
          {baseDay && !sb.data.weeks && baseDay !== todayKey ? <p className="stamp" style={{ textAlign: 'left', margin: '0 0 8px' }}>{baseDay < todayKey ? 'Last played' : 'Next up'}: {dateOf(baseDay).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p> : null}
          {sb.data.weeks && sb.data.current.week ? <p className="stamp" style={{ textAlign: 'left', margin: '0 0 8px' }}>{(sb.data.weeks.find((w) => w.week === sb.data.current.week && w.type === sb.data.current.type) || {}).label || ''}</p> : null}
          {sb.data.games.length ? <Board games={sb.data.games} pick="all" favSet={favSet} /> : <Empty>No {LEAGUE[pickL].short} games right now. Pick dates or weeks on its <button className="link" onClick={() => go(`league/${pickL}`)}>league page</button>.</Empty>}
          {nextDay && sbNext.data?.games?.length ? (
            <>
              <div className="sechead" style={{ marginTop: 22 }}><H2>{nextDay === todayKey ? 'Today' : `Next: ${dateOf(nextDay).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`}</H2></div>
              <Board games={sbNext.data.games} pick="all" favSet={favSet} />
            </>
          ) : nextDay && sbNext.loading ? <Loading rows={2} /> : null}
        </>
      )}
      {!favs.length && !pickL ? <p className="stamp">Pin a team from <button className="link" onClick={() => go('search')}>Search</button> and its games jump to the top.</p> : null}
      <Stamp at={q.updatedAt} live={(q.data?.games || []).some((g) => g.state === 'live')} />
    </>
  );
}

/* ---------- A league's scores, by week (football) or by day with a calendar ---------- */
// Today if it has games; otherwise the next day that does; otherwise the last one played. ('YYYYMMDD')
function gameDayFor(dates, today) {
  const list = [...dates].sort();
  if (!list.length || list.includes(today)) return today;
  return list.find((x) => x > today) || list[list.length - 1];
}
const ymdOf = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), 12);
const dashOf = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
function LeagueScores({ lg, startDay }) {
  const L = LEAGUE[lg];
  const favs = useFavs();
  const favSet = useMemo(() => new Set(favs.map(favKey)), [favs]);
  const base = useQuery(`board:${lg}`, () => getScoreboard(lg), (d) => (d?.games?.some((g) => g.state === 'live') ? 30000 : 300000));
  const [wk, setWk] = useSticky('wk', null); // 'type:week'
  const [yr, setYr] = useSticky('yr', null); // football season year; null = this season
  const [day, setDay] = useSticky('day', startDay || null); // 'YYYYMMDD'
  const [cal, setCal] = useState(false);
  const [month, setMonth] = useState(null); // first of the month shown in the calendar
  const b = base.data;
  const weekMode = !!b?.weeks?.length;
  const curWk = b?.current?.week ? `${b.current.type}:${b.current.week}` : null;
  const wkKey = wk || curWk;
  const today = ymdOf(new Date());
  const dayKey = day || (b?.dates ? gameDayFor(b.dates.map((x) => x.replace(/-/g, '')), today) : today);
  const [wt, wn] = (wkKey || '').split(':').map(Number);
  const isBase = weekMode ? !yr && wkKey === curWk : dayKey === (b?.current?.day ? b.current.day.replace(/-/g, '') : today);
  const sel = useQuery(b && !isBase ? (weekMode ? `board:${lg}:w${yr || ''}:${wkKey}` : `board:${lg}:d${dayKey}`) : null,
    () => (weekMode ? getScoreboard(lg, null, { week: wn, type: wt, year: yr || undefined }) : getScoreboard(lg, dayKey)), (d) => (d?.games?.some((g) => g.state === 'live') ? 30000 : 0));
  // Past seasons have their own week list (bowl names, playoff rounds), which comes back with that season's slate.
  const weekList = (yr && sel.data?.weeks?.length ? sel.data.weeks : b?.weeks) || [];
  const thisYear = b?.year || new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2001 }, (_, i) => thisYear - i);
  const q = isBase ? base : sel;
  const dates = useMemo(() => new Set([...(b?.dates || []), ...(sel.data?.dates || [])].map((x) => x.replace(/-/g, ''))), [b, sel.data]);
  if (base.loading && !b) return <Loading rows={5} />;
  if (base.error && !b) return <Problem error={base.error} retry={base.reload} />;

  const pickDay = (s) => { setDay(s); setCal(false); };
  const strip = Array.from({ length: 7 }, (_, i) => { const d = dateOf(dayKey); d.setDate(d.getDate() + i - 3); return ymdOf(d); });
  const m0 = month || (() => { const d = dateOf(dayKey); d.setDate(1); return d; })();
  const grid = (() => {
    const first = new Date(m0.getFullYear(), m0.getMonth(), 1, 12);
    const cells = Array(first.getDay()).fill(null);
    const n = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= n; i++) cells.push(ymdOf(new Date(m0.getFullYear(), m0.getMonth(), i, 12)));
    return cells;
  })();
  const shiftMonth = (k) => setMonth(new Date(m0.getFullYear(), m0.getMonth() + k, 1, 12));
  const games = q.data?.games || [];
  return (
    <>
      {weekMode ? (
        <>
          <div className="filters">
            <Picker label="Season" value={String(yr || thisYear)} onChange={(v) => { const y = Number(v); if (y === thisYear) { setYr(null); setWk(null); } else { setYr(y); setWk('2:1'); } }}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Picker>
            <Picker label="Week" value={wkKey || ''} onChange={setWk}>{weekList.map((w) => <option key={`${w.type}:${w.week}`} value={`${w.type}:${w.week}`}>{w.label}</option>)}</Picker>
          </div>
          <p className="stamp" style={{ textAlign: 'right', margin: '6px 2px 0' }}>{(weekList.find((w) => `${w.type}:${w.week}` === wkKey) || {}).detail || ''}</p>
        </>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Day" style={{ marginTop: 10 }}>
            {strip.map((s) => { const d = dateOf(s); return (
              <button key={s} className="daychip" aria-pressed={s === dayKey} onClick={() => pickDay(s)}>
                <b>{s === today ? 'TODAY' : d.toLocaleDateString([], { weekday: 'short' }).toUpperCase()}</b>
                <span>{d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                {dates.has(s) ? <i className="gdot" aria-label="Games" /> : <i className="gdot off" />}
              </button>); })}
          </div>
          <div className="datebar">
            <button className="pick date" onClick={() => { setMonth(null); setCal(!cal); }} aria-expanded={cal}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style={{ position: 'static' }}><rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M3 10 H21 M8 3 V7 M16 3 V7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
              <span>{dateOf(dayKey).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </button>
            {dayKey !== today ? <button className="link" onClick={() => pickDay(today)}>Today</button> : null}
          </div>
          {cal ? (
            <div className="card pad calbox">
              <div className="calhead">
                <button className="round sm" aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
                <b>{m0.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
                <button className="round sm" aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
              </div>
              <div className="calgrid">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <span key={'h' + i} className="dow">{x}</span>)}
                {grid.map((s, i) => s ? (
                  <button key={s} className={'cday' + (s === dayKey ? ' on' : '') + (s === today ? ' now' : '')} onClick={() => pickDay(s)} aria-label={dateOf(s).toDateString() + (dates.has(s) ? ', games' : '')}>
                    {+s.slice(6)}{dates.has(s) ? <i className="gdot" /> : null}
                  </button>
                ) : <span key={'e' + i} />)}
              </div>
              <label className="link" style={{ display: 'block', textAlign: 'center', marginTop: 10, position: 'relative' }}>Jump to another year
                <input type="date" aria-label="Pick any date" value={dashOf(dayKey)} min="2002-01-01" onChange={(e) => { const v = e.target.value.replace(/-/g, ''); if (v.length === 8) { pickDay(v); setMonth(null); } }} style={{ position: 'absolute', inset: 0, opacity: 0 }} />
              </label>
            </div>
          ) : null}
        </>
      )}
      {q.loading && !q.data ? <Loading rows={4} /> : q.error && !q.data ? <Problem error={q.error} retry={q.reload} /> :
        games.length ? <Board games={games} pick="all" favSet={favSet} /> : <Empty>No {L.short} games {weekMode ? 'this week' : 'on this day'}.</Empty>}
      <Stamp at={q.updatedAt} live={games.some((g) => g.state === 'live')} />
    </>
  );
}

/* ---------- Leagues ---------- */
function Leagues() {
  const q = useDay(0);
  const count = (id) => (q.data?.games || []).filter((g) => g.lg === id).length;
  return (
    <>
      <section className="sec">
        <H2>Leagues</H2>
        <div className="card">
          {LEAGUES.map((l) => { const n = count(l.id), season = q.data?.seasons?.[l.id]; return (
            <button key={l.id} className="lrow" onClick={() => go(`league/${l.id}`)}>
              <span className="blob" aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, background: l.color, color: '#0C1124', overflow: 'hidden', fontStretch: l.short.length > 4 ? '100%' : undefined, fontSize: l.short.length > 4 ? 9 : l.short.length > 3 ? 10 : 11 }}>{l.short}</span>
              <span className="nm">{l.name}<span className="sub">{n ? `${n} ${n === 1 ? 'game' : 'games'} today` : season || 'No games today'}</span></span>
              <span className="chev" aria-hidden="true">›</span>
            </button>); })}
        </div>
      </section>
      <div style={{ textAlign: 'center', marginTop: 18 }}><button className="link" onClick={() => go('about')}>About Fumblerooski</button></div>
    </>
  );
}

function LeaguePage({ lg, focus, start, startDay }) {
  const L = LEAGUE[lg];
  const [tab, setTab] = useSticky('tab', start || 'standings');
  const [by, setBy] = useSticky('by', null);
  const [all, setAll] = useSticky('all', false);
  const divs = DIVISIONS[lg] || [];
  const [div, setDiv] = useSticky('div', divs[0]?.id);
  const [hunting, setHunting] = useSticky('hunting', !!focus && divs.length > 1);
  const [yr, setYr] = useSticky('yr', null); // null = this season
  const [conf, setConf] = useSticky('conf', 'all');
  const st = useQuery(`standings:${lg}${divs.length ? ':' + div : ''}${yr ? ':' + yr : ''}`, () => getStandings(lg, div, yr), () => 600000);
  const seasonsQ = useQuery(`standings:${lg}${divs.length ? ':' + divs[0].id : ''}`, () => getStandings(lg, divs[0]?.id), () => 600000); // the year list
  // From a team page: if the team is not in this division, step down the divisions until we find it.
  useEffect(() => {
    if (!hunting || !st.data) return;
    if (st.data.groups.some((g) => g.rows.some((r) => r.team.id === String(focus)))) { setHunting(false); return; }
    const i = divs.findIndex((d) => d.id === div);
    if (i >= 0 && i < divs.length - 1) setDiv(divs[i + 1].id); else { setDiv(divs[0].id); setHunting(false); }
  }, [hunting, st.data, div]);
  const seasons = seasonsQ.data?.seasons || st.data?.seasons || [];
  const curView = st.data?.views?.find((v) => v.id === by) || st.data?.views?.[0];
  const confGroups = curView?.groups || st.data?.groups || [];
  const confNames = confGroups.length > 1 ? confGroups.map((g) => g.name) : [];
  const divPicker = (
    <div className="filters">
      {divs.length > 1 ? <Picker label="Division" value={div} onChange={(v) => { setHunting(false); setAll(true); setConf('all'); setDiv(v); }}>{divs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Picker> : null}
      {confNames.length ? <Picker label="Conference" value={confNames.includes(conf) ? conf : 'all'} onChange={(v) => { setAll(true); setConf(v); }}><option value="all">All {L.college || curView?.id === 'conference' && curView?.label === 'Conference' ? 'confs' : curView?.id === 'division' ? 'divisions' : 'teams'}</option>{confNames.map((n) => <option key={n} value={n}>{n}</option>)}</Picker> : null}
      {seasons.length > 1 ? <Picker label="Season" value={String(yr || seasons[0].year)} onChange={(v) => { setHunting(false); setAll(true); setYr(Number(v) === seasons[0].year ? null : Number(v)); }}>{seasons.map((x) => <option key={x.year} value={x.year}>{x.label}</option>)}</Picker> : null}
    </div>
  );
  useEffect(() => {
    if (!st.data) return;
    const groups = [...st.data.groups].sort((x, y) => y.rows.some((r) => r.team.id === String(focus)) - x.rows.some((r) => r.team.id === String(focus)));
    ensureColors(groups.flatMap((g) => g.rows.map((r) => r.team)), 36);
  }, [st.data, focus]);
  return (
    <>
      <div className="seg" role="group" aria-label="View">
        <button aria-pressed={tab === 'standings'} onClick={() => setTab('standings')}>Standings</button>
        {L.college ? <button aria-pressed={tab === 'rankings'} onClick={() => setTab('rankings')}>Rankings</button> : null}
        <button aria-pressed={tab === 'scores'} onClick={() => setTab('scores')}>Schedule</button>
      </div>
      {tab === 'rankings' ? <Rankings lg={lg} focus={focus} /> : tab === 'scores' ? <LeagueScores lg={lg} startDay={startDay} /> : (
        (st.loading && !st.data) || hunting ? <>{divPicker}<Loading rows={6} /></> : st.error && !st.data ? <>{divPicker}<Problem error={st.error} retry={st.reload} /></> :
          !st.data.groups.length ? <>{divPicker}<Empty>{divs.length > 1 ? `The scores feed has no ${divs.find((d) => d.id === div)?.label} standings.` : `No standings for ${L.name} right now.`}</Empty></> : (() => {
            const views = st.data.views || [{ id: 'conference', label: 'Conference', groups: st.data.groups }];
            const view = views.find((v) => v.id === by) || views[0];
            // Coming from a team page: show just that team's group, with the team lit up.
            const has = (gr) => gr.rows.some((r) => r.team.id === String(focus));
            const mine = focus && !all ? view.groups.filter(has) : [];
            const picked = conf !== 'all' && view.groups.some((g) => g.name === conf) ? view.groups.filter((g) => g.name === conf) : null;
            const shown = picked || (mine.length ? mine : view.groups);
            return (<>
            {divPicker}
            {views.length > 1 ? (
              <div className="seg sub" role="group" aria-label="Group standings by">
                {views.map((v) => <button key={v.id} aria-pressed={v.id === view.id} onClick={() => { setConf('all'); setBy(v.id); }}>{v.label}</button>)}
              </div>
            ) : null}
            {shown.map((gr, i) => (
              <div className="card" key={view.id + gr.name + i}>
                <div className="shead"><span className="nm">{gr.name}</span><span style={{ width: 56, textAlign: 'right' }}>REC</span><span style={{ width: 52, textAlign: 'right' }}>{gr.col2Label}</span></div>
                {(gr.subs || [{ name: null, rows: gr.rows }]).map((sub) => (
                  <React.Fragment key={sub.name || 'all'}>
                    {sub.name ? <div className="subhead">{sub.name}</div> : null}
                    {sub.rows.map((r, j) => (
                      <button key={r.team.id} className={'srow' + (focus && r.team.id === String(focus) ? ' me' : '')} aria-current={focus && r.team.id === String(focus) ? 'true' : undefined} onClick={() => go(`team/${lg}/${r.team.id}`)}>
                        <span className="pos">{j + 1}</span><Blob team={r.team} /><span className="nm">{r.team.name}</span>
                        <span className="v">{r.overall}</span><span className="v2">{r.col2}</span>
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            ))}
            {mine.length && mine.length < view.groups.length ? <div style={{ textAlign: 'center', marginTop: 14 }}><button className="btn" onClick={() => setAll(true)}>All {L.short} standings</button></div> : null}
            </>);
          })()
      )}
    </>
  );
}

/* ---------- College polls ---------- */
function Rankings({ lg, focus }) {
  const q = useQuery(`rankings:${lg}`, () => getRankings(lg), () => 1800000);
  const [pid, setPid] = useState(null);
  if (q.loading && !q.data) return <Loading rows={8} />;
  if (q.error && !q.data) return <Problem error={q.error} retry={q.reload} />;
  const polls = q.data.polls;
  if (!polls.length) return <Empty>No polls out for {LEAGUE[lg].name} right now.</Empty>;
  const p = polls.find((x) => x.id === pid) || polls[0];
  const hasPts = p.ranks.some((r) => r.points);
  const move = (m) => (m === 'new' ? <span className="mv new">NEW</span> : m > 0 ? <span className="mv up">▲{m}</span> : m < 0 ? <span className="mv dn">▼{-m}</span> : <span className="mv">–</span>);
  return (
    <>
      <div className="sechead" style={{ marginTop: 14 }}>
        <span className="released">{p.note ? <b>{p.note}</b> : null}{p.released ? <span>Released {new Date(p.released).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</span> : null}</span>
        {polls.length > 1 ? <Picker label="Poll" value={p.id} onChange={setPid}>{polls.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Picker> : <b className="ptitle">{p.name}</b>}
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <div className="shead"><span className="nm">{p.full}</span><span>{hasPts ? 'PTS' : ''}</span></div>
        {p.ranks.map((r) => (
          <button key={r.team.id} className={'srow poll' + (String(focus) === r.team.id ? ' me' : '')} onClick={() => go(`team/${lg}/${r.team.id}`)}>
            <span className="pos">{r.rank}</span>
            <Blob team={r.team} />
            <span className="nm">{r.team.name}<span className="sub">{[r.record, r.firstPlace ? `${r.firstPlace} first-place ${r.firstPlace === 1 ? 'vote' : 'votes'}` : ''].filter(Boolean).join(' · ')}</span></span>
            {move(r.move)}
            {hasPts ? <span className="pts">{r.points.toLocaleString('en-US')}</span> : null}
          </button>
        ))}
      </div>
      {p.others.length ? <p className="pollnote"><b>Others receiving votes:</b> {p.others.map((o) => `${o.team.name} ${o.points}`).join(', ')}</p> : null}
      {p.dropped.length ? <p className="pollnote"><b>Dropped out:</b> {p.dropped.map((t) => t.name).join(', ')}</p> : null}
    </>
  );
}

/* ---------- Stats: league leaders and every team's numbers ---------- */
const Picker = ({ label, value, onChange, children }) => (
  <label className="pick">
    <span style={{ position: 'absolute', left: -9999 }}>{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </label>
);
const remember = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
function Stats({ start }) {
  const [lg, setLgRaw] = useSticky('lg', () => start || (LEAGUE[remember.get('fr.stats.lg', '')] ? remember.get('fr.stats.lg', '') : 'nfl'));
  const setLg = (v) => { setLgRaw(v); remember.set('fr.stats.lg', v); };
  const [view, setView] = useSticky('view', 'leaders');
  return (
    <>
      <div className="sechead" style={{ marginTop: 4 }}>
        <H2>Stats</H2>
        <Picker label="League" value={lg} onChange={setLg}>{LEAGUES.map((l) => <option key={l.id} value={l.id}>{l.short}</option>)}</Picker>
      </div>
      <div className="seg" role="group" aria-label="Stats view" style={{ marginTop: 12 }}>
        <button aria-pressed={view === 'leaders'} onClick={() => setView('leaders')}>Leaders</button>
        <button aria-pressed={view === 'teams'} onClick={() => setView('teams')}>Team Stats</button>
      </div>
      {view === 'leaders' ? <Leaders key={lg} lg={lg} /> : <TeamStats key={lg} lg={lg} />}
    </>
  );
}
// Leader filters: conference groupings from the standings, plus the usual college buckets.
const POWER = { cfb: ['acc', 'big ten', 'big 12', 'sec'], ncaam: ['acc', 'big ten', 'big 12', 'sec', 'big east'], ncaaw: ['acc', 'big ten', 'big 12', 'sec', 'big east'] };
const isPower = (lg, name) => (POWER[lg] || []).includes(String(name).toLowerCase());
function useLeaderFilters(lg) {
  const st = useQuery(`standings:${lg}${DIVISIONS[lg] ? ':' + DIVISIONS[lg][0].id : ''}`, () => getStandings(lg, DIVISIONS[lg]?.[0]?.id), () => 600000);
  return useMemo(() => {
    const groups = st.data?.groups || [];
    if (!groups.length) return [];
    const ids = (gs) => new Set(gs.flatMap((g) => g.rows.map((r) => r.team.id)));
    const out = [];
    if (POWER[lg]) {
      const p = groups.filter((g) => isPower(lg, g.name));
      const rest = groups.filter((g) => !isPower(lg, g.name) && !/independ/i.test(g.name));
      if (p.length) out.push({ id: 'power', label: lg === 'cfb' ? 'Power 4' : 'Power conferences', ids: ids(p) });
      if (lg === 'cfb' && rest.length) out.push({ id: 'g6', label: 'Group of 6', ids: ids(rest) });
      if (lg !== 'cfb' && rest.length) out.push({ id: 'mid', label: 'Mid-majors', ids: ids(rest) });
    }
    groups.forEach((g) => out.push({ id: 'g:' + g.name, label: g.name, ids: ids([g]) }));
    return out;
  }, [lg, st.data]);
}
function Leaders({ lg }) {
  const q = useQuery(`leaders:${lg}`, () => getLeaders(lg), () => 600000);
  const filters = useLeaderFilters(lg);
  const [fid, setFid] = useSticky('filter:' + lg, 'all');
  if (q.loading && !q.data) return <div style={{ marginTop: 12 }}><Loading rows={6} /></div>;
  if (q.error && !q.data) return <div style={{ marginTop: 12 }}><Problem error={q.error} retry={q.reload} /></div>;
  if (!q.data.cats.length) return <Empty>No leaders listed for {LEAGUE[lg].name} right now.</Empty>;
  const f = filters.find((x) => x.id === fid);
  const pickFilter = (v) => setFid(v);
  return (
    <>
      {filters.length ? (
        <div className="sechead" style={{ marginTop: 12 }}>
          <span />
          <Picker label="Filter leaders" value={fid} onChange={pickFilter}>
            <option value="all">{lg === 'cfb' ? 'All FBS' : LEAGUE[lg].college ? 'All Division I' : `All ${LEAGUE[lg].short}`}</option>
            {filters.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </Picker>
        </div>
      ) : null}
      {q.data.cats.map((c) => <LeaderCard key={c.key} lg={lg} c={c} f={f} />)}
      <Stamp at={q.updatedAt} />
    </>
  );
}
// One stat's leaders. Top 10 comes with the page; filtering or asking for more pulls that stat's full board.
function LeaderCard({ lg, c, f }) {
  const [n, setN] = useState(5);
  useEffect(() => setN(5), [f?.id]);
  const deepOk = canGoDeep(lg, c.key);
  const wantDeep = deepOk && (!!f || n > 5);
  const deep = useQuery(wantDeep ? `deep:${lg}:${c.key}` : null, () => getDeepLeader(lg, c.key), () => 600000);
  const base = wantDeep && deep.data?.length ? deep.data : c.rows;
  const list = f ? base.filter((r) => r.team && f.ids.has(r.team.id)) : base;
  const rows = list.slice(0, n);
  const place = places(list.map((r) => r.value));
  const loadingDeep = wantDeep && deep.loading && !deep.data;
  const total = !wantDeep && deepOk ? null : list.length; // unknown until the full board loads
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="shead"><span className="nm">{c.title}</span>{c.abbr ? <span>{c.abbr}</span> : null}</div>
      {loadingDeep && f ? <div className="lead"><span className="nm" style={{ color: 'var(--mute)', fontWeight: 700 }}>Loading the full list...</span></div>
        : !rows.length ? <div className="lead"><span className="nm" style={{ color: 'var(--mute)', fontWeight: 700 }}>No one from {f?.label} {deepOk ? 'has this stat yet.' : 'in the top 10.'}</span></div> : null}
      {(loadingDeep && f ? [] : rows).map((r, i) => (
        <button key={i} className={'lead' + (/^T?1$/.test(place[i]) ? ' top' : '')} onClick={() => (r.player?.id ? go(`player/${lg}/${r.player.id}`) : r.team ? go(`team/${lg}/${r.team.id}`) : null)}>
          <span className="pos">{place[i]}</span>
          {r.team ? <Blob team={r.team} /> : null}
          <span className="nm">{r.player?.name || r.team?.full}{r.player?.pos ? <small> {r.player.pos}</small> : null}</span>
          <span className="v">{pct1(c.title, r.value)}</span>
        </button>
      ))}
      {(list.length > 5 || (deepOk && !wantDeep)) && !(loadingDeep && f) ? (
        <div className="morebar">
          {n < list.length || (deepOk && !wantDeep) ? <button className="link" onClick={() => setN(n + 25)}>{loadingDeep ? 'Loading...' : total == null ? 'Show more' : `Show ${Math.min(25, list.length - n)} more`}</button> : null}
          {total != null && n < list.length && list.length - n > 25 ? <button className="link" onClick={() => setN(list.length)}>All {list.length}</button> : null}
          {n > 5 ? <button className="link" onClick={() => setN(5)}>Show fewer</button> : null}
        </div>
      ) : null}
    </div>
  );
}
// Places with ties shown the sports way: 1, 2, T3, T3, 5. Equal values share the first place they reach.
function places(values) {
  const key = (v) => String(v).replace(/,/g, '').trim();
  return values.map((v, i) => {
    let first = i; while (first > 0 && key(values[first - 1]) === key(v)) first--;
    const tied = (first < i) || (i + 1 < values.length && key(values[i + 1]) === key(v));
    return (tied ? 'T' : '') + (first + 1);
  });
}
const numOf = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : -Infinity; };
function TeamStats({ lg }) {
  const q = useQuery(`teamstats:${lg}`, () => getTeamStats(lg), () => 600000);
  const [catKey, setCat] = useState(null);
  const [sort, setSort] = useState({ col: 0, dir: -1 });
  useEffect(() => { if (q.data) ensureColors(q.data.teams.map((t) => t.team), 40); }, [q.data]);
  if (q.loading && !q.data) return <div style={{ marginTop: 12 }}><Loading rows={6} /></div>;
  if (q.error && !q.data) return <div style={{ marginTop: 12 }}><Problem error={q.error} retry={q.reload} /></div>;
  const cats = q.data.cats;
  if (!cats.length) return <Empty>No team stats listed for {LEAGUE[lg].name} right now.</Empty>;
  const cat = cats.find((c) => c.key === catKey) || cats[0];
  const rows = q.data.teams.filter((t) => t.stats[cat.key]).sort((a, b) => (numOf(b.stats[cat.key][sort.col]) - numOf(a.stats[cat.key][sort.col])) * -sort.dir || a.team.name.localeCompare(b.team.name));
  const place = places(rows.map((t) => t.stats[cat.key][sort.col] ?? ''));
  const pickCol = (i) => setSort(sort.col === i ? { col: i, dir: -sort.dir } : { col: i, dir: -1 });
  return (
    <>
      <div className="statbar" style={{ marginTop: 12 }}>
        {cats.length > 1 ? <Picker label="Stat group" value={cat.key} onChange={(v) => { setCat(v); setSort({ col: 0, dir: -1 }); }}>{cats.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}</Picker> : null}
        <span className="stamp" style={{ margin: 0 }}>Sorted by {cat.names[sort.col] || cat.labels[sort.col]}, {sort.dir < 0 ? 'most first' : 'fewest first'}. Tap a column to sort.</span>
      </div>
      <div className="card pbox" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th scope="col" className="who">{cat.title}</th>{cat.labels.map((l, i) => <th scope="col" key={i} className={'sort' + (sort.col === i ? ' on' : '')} aria-sort={sort.col === i ? (sort.dir < 0 ? 'descending' : 'ascending') : undefined} onClick={() => pickCol(i)}>{l}{sort.col === i ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}</th>)}</tr></thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={t.team.id} className="tap" onClick={() => go(`team/${lg}/${t.team.id}`)}>
                <th scope="row" className="who"><span className="rk">{place[i]}</span>{t.team.name}</th>
                {cat.labels.map((_, j) => <td key={j} className={sort.col === j ? 'on' : undefined}>{pct1(cat.labels[j], t.stats[cat.key][j] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Stamp at={q.updatedAt} />
    </>
  );
}

/* ---------- Team ---------- */
function TeamPage({ lg, id }) {
  const [yr, setYr] = useSticky('yr', null); // null = this season
  const q = useQuery(`team:${lg}:${id}${yr ? ':' + yr : ''}`, () => getTeam(lg, id, yr), () => 300000);
  const cur = q.data?.currentSeason || null;
  const isPast = !!yr && yr !== cur;
  const yearLabel = (y) => (LEAGUE[lg].sport === 'football' || LEAGUE[lg].sport === 'baseball' || lg === 'mls' || lg === 'wnba' ? String(y) : `${y - 1}-${String(y).slice(2)}`);
  const favs = useFavs();
  const t = q.data?.team;
  const pinned = t && favs.some((f) => favKey(f) === favKey(t));
  const sched = q.data?.schedule || [];
  const [viewRaw, setView] = useSticky('view', 'schedule');
  const full = isCovered(useCovered(lg), id);
  const view = full ? viewRaw : 'schedule';
  const ro = useQuery(view === 'roster' ? `roster:${lg}:${id}` : null, () => getRoster(lg, id), () => 0);
  const recs = useQuery(`records:${lg}`, () => getRecords(lg), () => 600000).data || {};
  // Ranked colleges: show where they sit in each poll (CFP, AP, Coaches).
  const polls = useQuery(LEAGUE[lg].college ? `rankings:${lg}` : null, () => getRankings(lg), () => 1800000).data?.polls || [];
  // Each poll gets a short name and a level: top division (CFP, AP, Coaches) or a lower one (FCS, D2, D3).
  const pollName = (p) => { const t = p.name + ' ' + p.full + ' ' + p.type;
    return /cfp|playoff/i.test(t) ? ['CFP', 'top'] : /\bfcs\b/i.test(t) ? ['FCS', 'fcs'] : /div(ision)?\.?\s*iii\b|\bd3\b/i.test(t) ? ['D3', 'd3'] : /div(ision)?\.?\s*ii\b|\bd2\b/i.test(t) ? ['D2', 'd2']
      : /\bap\b/i.test(t) ? ['AP', 'top'] : /coach|usa/i.test(t) ? ['Coaches', 'top'] : [p.name, 'other']; };
  const pollRanks = polls.map((p) => { const [name, level] = pollName(p); return { name, level, poll: p, r: p.ranks.find((x) => x.team.id === String(id))?.rank }; })
    .filter((x) => x.r && x.level !== 'other');
  // The gold number comes from the team's main poll: CFP (or AP before it is out) for the top division,
  // or the one poll a lower-division team appears in (FCS Coaches, AFCA Div II, AFCA Div III).
  const lower = pollRanks.find((x) => x.level !== 'top');
  const mainPoll = lower ? lower.poll : polls[0];
  const topRank = mainPoll ? (mainPoll.ranks.find((x) => x.team.id === String(id))?.rank || null) : (q.data?.rank || null);
  const row = (g) => {
    const home = g.home.id === String(id), me = home ? g.home : g.away, them = home ? g.away : g.home;
    const fin = g.state === 'final', w = +me.score > +them.score, tie = +me.score === +them.score;
    return (
      <button key={g.id} className="lrow" onClick={() => go(`game/${lg}/${g.id}`)}>
        <Blob team={them} />
        <span className="nm">{g.note ? <span className="gnote">{shortEvent(g.note)}</span> : null}{home ? 'vs' : 'at'} {them.name}{(isPast ? them.record : recs[them.id] || them.record) ? <small className="orec"> {isPast ? them.record : recs[them.id] || them.record}</small> : null}<span className="sub">{fmtDate(g.date)}{isPast ? `, ${new Date(g.date).getFullYear()}` : ''}</span></span>
        <span className="res">{fin ? (<><b style={{ background: w ? 'var(--win-bg)' : 'var(--rule)', color: w ? 'var(--lime)' : 'var(--soft)' }}>{tie ? 'T' : w ? 'W' : 'L'}</b>{me.score}-{them.score}</>)
          : g.state === 'live' ? <span style={{ color: 'var(--pink)' }}>LIVE {me.score}-{them.score}</span>
            : g.state === 'off' ? <span style={{ color: 'var(--mute)' }}>{g.statusText || 'Postponed'}</span>
              : <span style={{ color: 'var(--teal)' }}>{g.tbd ? 'TBD' : fmtTime(g.date)}</span>}</span>
      </button>
    );
  };
  return (
    <>
      <SubHeader title={t ? (t.full.length > 18 ? t.name : t.full) : LEAGUE[lg].name} />
      <Page>
        {q.loading && !q.data ? <Loading rows={6} /> : q.error && !q.data ? <Problem error={q.error} retry={q.reload} /> : (
          <>
            <div className="teamhero" style={{ background: `linear-gradient(rgba(12,17,36,.3), rgba(12,17,36,.55)), ${t.color}` }}>
              <Blob team={t} size={58} radius={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2>{t.full}</h2>
                <p>{[isPast ? `${yearLabel(yr)}: ${q.data.record || 'no games'}` : q.data.record, q.data.standing].filter(Boolean).join(' · ') || LEAGUE[lg].name}</p>
                {!isPast && (topRank || pollRanks.length) ? <p className="hrank">{topRank ? <b>No. {topRank}</b> : null}{lower ? <span>{lower.poll.name}</span> : pollRanks.length ? <span>{pollRanks.map((x) => `${x.name} ${x.r}`).join(' · ')}</span> : null}</p> : null}
              </div>
            </div>
            <div className="teambar">
              <button className={'star' + (pinned ? ' on' : '')} aria-pressed={pinned} aria-label={pinned ? 'Unpin team' : 'Pin team'} onClick={() => toggleFav(t)}>
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 L14.7 8.6 L21 9.3 L16.3 13.6 L17.6 19.9 L12 16.7 L6.4 19.9 L7.7 13.6 L3 9.3 L9.3 8.6 Z" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => go(`league/${lg}/${id}`)}><LgTag lg={lg} /> Standings</button>
              {(view === 'schedule' || view === 'stats') && cur ? (
                <Picker label="Season" value={String(yr || cur)} onChange={(v) => setYr(Number(v) === cur ? null : Number(v))}>
                  {Array.from({ length: Math.max(1, cur - 2002) }, (_, i) => cur - i).map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
                </Picker>
              ) : null}
            </div>
            {full ? (
              <div className="seg" role="group" aria-label="Team sections" style={{ marginTop: 14 }}>
                <button aria-pressed={view === 'schedule'} onClick={() => setView('schedule')}>Schedule</button>
                <button aria-pressed={view === 'roster'} onClick={() => setView('roster')}>Roster</button>
                <button aria-pressed={view === 'stats'} onClick={() => setView('stats')}>Stats</button>
              </div>
            ) : <div style={{ marginTop: 14 }}><H2>Schedule</H2></div>}
            {view === 'stats' ? <TeamSeason lg={lg} id={id} season={yr || cur} team={t} /> : view === 'schedule' ? (
              <section className="sec" style={{ marginTop: 12 }}>
                {sched.length ? <div className="card">{sched.map(row)}</div> : <Empty>{q.data.scheduleMissing ? 'The schedule did not load. Pull up the team again in a bit.' : 'No games on the schedule yet.'}</Empty>}
              </section>
            ) : ro.loading && !ro.data ? <div style={{ marginTop: 12 }}><Loading rows={6} /></div> : ro.error && !ro.data ? <div style={{ marginTop: 12 }}><Problem error={ro.error} retry={ro.reload} /></div>
              : !ro.data?.groups.length ? <Empty>No roster listed for this team right now.</Empty>
                : ro.data.groups.map((gr) => (
                  <section className="sec" key={gr.title} style={{ marginTop: 12 }}>
                    <div className="card">
                      {ro.data.groups.length > 1 ? <div className="shead"><span className="nm">{gr.title}</span></div> : null}
                      {gr.players.map((p) => (
                        <button key={p.id} className="lrow" onClick={() => go(`player/${lg}/${p.id}`)}>
                          <span className="jersey" style={{ background: t.color, color: inkOn(t.color) }}>{p.jersey || '·'}</span>
                          <span className="nm">{p.name}<span className="sub">{[p.pos, p.cls, p.ht, p.wt].filter(Boolean).join(' · ')}</span></span>
                          <span className="chev" aria-hidden="true">›</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
          </>
        )}
      </Page>
    </>
  );
}

/* ---------- one team's season: leaders and key stats ---------- */
function TeamSeason({ lg, id, season, team }) {
  const [open, setOpen] = useState({});
  const q = useQuery(season ? `teamseason:${lg}:${id}:${season}` : null, () => getTeamStatsFor(lg, id, season), () => 600000);
  if (!season || (q.loading && !q.data)) return <div style={{ marginTop: 12 }}><Loading rows={5} /></div>;
  if (q.error && !q.data) return <div style={{ marginTop: 12 }}><Problem error={q.error} retry={q.reload} /></div>;
  const { groups, leaders } = q.data;
  if (!groups.length && !leaders.length) return <Empty>No stats for this season yet.</Empty>;
  return (
    <>
      {leaders.length ? (
        <section className="sec" style={{ marginTop: 12 }}>
          <H2>Team Leaders</H2>
          <div className="card">
            {leaders.map((c) => (open[c.key] ? c.rows : c.rows.slice(0, 1)).map((r, i) => (
              <button key={c.key + r.id + i} className={'lead tl' + (i === 0 ? ' top' : ' more')} onClick={() => r.id && go(`player/${lg}/${r.id}`)}>
                <span className="jersey" style={{ width: 30, height: 30, fontSize: 12, background: team.color, color: inkOn(team.color) }}>{r.jersey || '·'}</span>
                <span className="nm">{i === 0 ? <small className="lcat">{c.title}</small> : null}{r.name}{r.pos ? <small> {r.pos}</small> : null}{i === 0 && r.detail && r.detail !== r.value ? <small className="ldet">{r.detail}</small> : null}</span>
                <span className="v">{pct1(c.title, r.value)}</span>
                {i === 0 && c.rows.length > 1 ? <span className="lmore" role="button" aria-label={open[c.key] ? 'Show fewer' : 'Show the next two'} onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [c.key]: !open[c.key] }); }}>{open[c.key] ? '▴' : '▾'}</span> : <span className="lmore" />}
              </button>
            )))}
          </div>
        </section>
      ) : null}
      {groups.map((g) => (
        <div className="card pad" key={g.title} style={{ marginTop: 12 }}>
          <div className="ptitle">{g.title}</div>
          <div className="kv">{g.items.map((x) => <div key={x.label}><span>{x.label}</span><b>{pct1(x.label, x.value)}</b>{x.rank ? <em className="krank">{ordinal(x.rank)}</em> : null}</div>)}</div>
        </div>
      ))}
    </>
  );
}

/* ---------- percentages: one decimal everywhere (57 -> 57.0, 73.333 -> 73.3) ---------- */
// Win percentages and save percentages written as .700 / .945 are left as they are.
const isPctLabel = (l) => /%|pct|percent/i.test(String(l || ''));
const pct1 = (label, v) => {
  const t = String(v ?? '').trim();
  if (!isPctLabel(label) || !/^-?\d+(\.\d+)?%?$/.test(t)) return v;
  return Number(t.replace('%', '')).toFixed(1) + (t.endsWith('%') ? '%' : '');
};

/* ---------- Player ---------- */
const ordinal = (n) => { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); };
const fmtShort = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }); };
function PlayerPage({ lg, id }) {
  const q = useQuery(`player:${lg}:${id}`, () => getPlayer(lg, id), () => 600000);
  const [tab, setTab] = useSticky('tab', 'season');
  const d = q.data, p = d?.player;
  const color = p?.team?.color || '#2B3352';
  const log = d?.gamelog, career = d?.career || [];
  // This season = each stat group's most recent row.
  const season = career.map((c) => ({ ...c, row: c.rows[c.rows.length - 1] })).filter((c) => c.row);
  const tabs = [['season', 'Season'], ['log', 'Game Log'], ['career', 'Career']];
  return (
    <>
      <SubHeader title={p?.name || 'Player'} />
      <Page>
        {q.loading && !d ? <Loading rows={6} /> : q.error && !d ? <Problem error={q.error} retry={q.reload} /> : (
          <>
            <div className="teamhero" style={{ background: `linear-gradient(rgba(12,17,36,.3), rgba(12,17,36,.55)), ${color}` }}>
              <span className="jersey big" style={{ background: color, color: inkOn(color) }}>{p.jersey || p.pos || '·'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2>{p.name || 'Player'}</h2>
                <p>{[p.posName || p.pos, p.team?.full, p.cls].filter(Boolean).join(' · ')}</p>
                <p style={{ fontWeight: 600 }}>{[p.ht, p.wt, p.from].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            {p.team ? <div style={{ display: 'flex', marginTop: 12 }}><button className="btn" style={{ flex: 1 }} onClick={() => go(`team/${lg}/${p.team.id}`)}><Blob team={p.team} size={28} /> {p.team.full}</button></div> : null}
            <div className="gtabs" role="tablist" aria-label="Player sections">
              {tabs.map(([k, label]) => <button key={k} role="tab" className="chipb" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
            </div>

            {tab === 'season' ? (
              <>
                {d.summary.items.length ? <div className="tiles">{d.summary.items.map((x) => <div className="tile" key={x.label}><b>{pct1(x.label, x.value)}</b><span>{x.label}</span>{x.rank ? <em className="trank">{x.tied ? 'T' : ''}{ordinal(x.rank)} in {LEAGUE[lg].college && lg === 'cfb' ? 'FBS' : LEAGUE[lg].short}</em> : null}</div>)}</div> : null}
                {season.map((c) => (
                  <div className="card pad" key={c.key + c.title} style={{ marginTop: 12 }}>
                    <div className="ptitle">{c.row.season} {c.title}</div>
                    <div className="kv">{c.labels.map((l, i) => <div key={i}><span>{l}</span><b>{pct1(l, c.row.stats[i] ?? '')}</b></div>)}</div>
                  </div>
                ))}
                {!d.summary.items.length && !season.length ? <Empty>{d.missing.career ? 'Season stats did not load. Try again in a bit.' : 'No stats on record for this season.'}</Empty> : null}
              </>
            ) : null}

            {tab === 'log' ? (
              log.seasons.length ? log.seasons.map((sn, si) => (
                <div className="card pbox" key={sn.title + si} style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      {log.spans.length ? <tr className="span"><th className="who" />{log.spans.map((x, i) => <th key={i} colSpan={x.count}>{x.title}</th>)}</tr> : null}
                      <tr><th scope="col" className="who">{sn.title || 'Games'}</th>{log.labels.map((l, i) => <th scope="col" key={i}>{l}</th>)}</tr>
                    </thead>
                    <tbody>
                      {sn.rows.map((r) => (
                        <tr key={r.id} className="tap" onClick={() => go(`game/${lg}/${r.id}`)}>
                          <th scope="row" className="who">{[fmtShort(r.date), r.at, r.opp].filter(Boolean).join(' ')}<small className={'res ' + (r.result === 'W' ? 'w' : '')}>{[r.result, r.score].filter(Boolean).join(' ')}</small></th>
                          {log.labels.map((l, j) => <td key={j}>{pct1(l, r.stats[j] ?? '')}</td>)}
                        </tr>
                      ))}
                      {sn.totals ? <tr className="tot"><th scope="row" className="who">Total</th>{log.labels.map((l, j) => <td key={j}>{pct1(l, sn.totals[j] ?? '')}</td>)}</tr> : null}
                    </tbody>
                  </table>
                </div>
              )) : <Empty>{d.missing.gamelog ? 'The game log did not load. Try again in a bit.' : 'No games logged yet.'}</Empty>
            ) : null}

            {tab === 'career' ? (
              career.length ? career.map((c) => (
                <div className="card pbox" key={c.key + c.title} style={{ marginTop: 12 }}>
                  <table>
                    <thead><tr><th scope="col" className="who">{c.title}</th>{c.labels.map((l, i) => <th scope="col" key={i}>{l}</th>)}</tr></thead>
                    <tbody>
                      {c.rows.map((r, i) => <tr key={r.season + r.team + i}><th scope="row" className="who">{r.season}{r.team && r.team !== p.team?.abbr ? <small className="was"> {r.team}</small> : null}</th>{c.labels.map((l, j) => <td key={j}>{pct1(l, r.stats[j] ?? '')}</td>)}</tr>)}
                      {c.totals ? <tr className="tot"><th scope="row" className="who">Career</th>{c.labels.map((l, j) => <td key={j}>{pct1(l, c.totals[j] ?? '')}</td>)}</tr> : null}
                    </tbody>
                  </table>
                </div>
              )) : <Empty>{d.missing.career ? 'Career stats did not load. Try again in a bit.' : 'No career stats on record.'}</Empty>
            ) : null}
            <Stamp at={q.updatedAt} />
          </>
        )}
      </Page>
    </>
  );
}

/* ---------- Game ---------- */
const PERIOD_WORD = { football: 'Q', basketball: 'Q', hockey: 'P', soccer: 'H', baseball: '' };

// Score chart: both teams' scores climbing through the game. Chunky stepped lines with a purple drop shadow,
// like a late-80s broadcast graphic. Each line is the team's primary color with its secondary as the drop shadow.
function niceStep(max) { const raw = max / 3, pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))); const f = raw / pow; return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow); }
function ScoreChart({ chart, game, L }) {
  const W = 340, H = 196, x0 = 30, x1 = 332, y0 = 14, y1 = 158;
  const step = niceStep(chart.max), top = Math.max(step, Math.ceil(chart.max / step) * step);
  const x = (t) => x0 + t * (x1 - x0), y = (v) => y1 - (v / top) * (y1 - y0);
  const path = (k) => chart.points.map((p, i) => (i === 0 ? `M${x(p.t).toFixed(1)} ${y(p[k]).toFixed(1)}` : chart.stepped ? `H${x(p.t).toFixed(1)} V${y(p[k]).toFixed(1)}` : `L${x(p.t).toFixed(1)} ${y(p[k]).toFixed(1)}`)).join(' ');
  const end = chart.points[chart.points.length - 1];
  const reg = L.periods || chart.periods, word = PERIOD_WORD[L.sport] ?? '';
  const label = (i) => (i < reg ? `${word}${i + 1}` : chart.periods - reg > 1 ? `OT${i - reg + 1}` : 'OT');
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const cc = chartColors(game.away, game.home);
  const sides = [[game.away, 'a', cc.away.main, cc.away.second], [game.home, 'h', cc.home.main, cc.home.second]];
  return (
    <section className="sec">
      <H2>Score Chart</H2>
      <div className="card pad chart">
        <div className="legend">
          {sides.map(([t, k, c, c2]) => <span key={k} className="lg" style={{ background: c, color: inkOn(c), boxShadow: `3px 3px 0 ${c2}` }}>{t.abbr} <b>{end[k]}</b></span>)}
        </div>
        <div role="img" aria-label={`Score over time. ${game.away.name} ${end.a}, ${game.home.name} ${end.h}.`}>
          <svg className="flow" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
            {ticks.map((v) => <g key={v}><path d={`M${x0} ${y(v)} H${x1}`} style={{ stroke: v === 0 ? 'var(--line3)' : 'var(--rule)' }} strokeWidth={v === 0 ? 2 : 1} /><text x={x0 - 6} y={y(v) + 3.5} textAnchor="end" className="ax">{v}</text></g>)}
            {chart.bounds.slice(0, -1).map((b, i) => <path key={i} d={`M${x(b)} ${y0} V${y1}`} style={{ stroke: 'var(--line3)' }} strokeDasharray="2 4" />)}
            {chart.bounds.map((b, i) => { const a = i ? chart.bounds[i - 1] : 0; return <text key={i} x={x((a + b) / 2)} y={H - 18} textAnchor="middle" className="per">{label(i)}</text>; })}
            {sides.map(([, k, , c2]) => <path key={'s' + k} d={path(k)} transform="translate(3 3)" fill="none" stroke={c2} strokeWidth="4" strokeLinejoin="miter" strokeLinecap="square" />)}
            {sides.map(([, k, c]) => <path key={k} d={path(k)} fill="none" stroke={c} strokeWidth="4" strokeLinejoin="miter" strokeLinecap="square" />)}
            {sides.map(([, k, c, c2]) => <rect key={'e' + k} x={x(end.t) - 5} y={y(end[k]) - 5} width="10" height="10" fill={c} stroke={c2} strokeWidth="2" />)}
            <path d={`M${x0} ${H - 8} H${x1}`} stroke="#22D3D6" strokeWidth="2" /><path d={`M${x0} ${H - 5} H${x1}`} stroke="#F5F5F7" strokeWidth="2" /><path d={`M${x0} ${H - 2} H${x1}`} stroke="#8B5CF6" strokeWidth="2" />
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ---------- football: drives ---------- */
// Touchdowns and field goals read differently at a glance:
// a touchdown is a solid gold bar that runs into a lit-up end zone; a field goal is a lime bar that stops at the
// spot of the kick, with a dotted kick sailing through the uprights.
const DRIVE_COLOR = { td: '#FFBE2E', fg: '#9BE33A', turnover: '#FF3D7F', other: '#22D3D6' };
function DriveField({ d, game }) {
  if (d.x0 == null || d.x1 == null) return null;
  const W = 300, H = 30, ez = 22, mid = H / 2, fx = (v) => ez + (v / 100) * (W - ez * 2);
  const a = fx(d.x0), b = fx(d.x1), dir = d.side === 'away' ? 1 : -1;
  const color = DRIVE_COLOR[d.kind] || DRIVE_COLOR.other;
  const tip = Math.abs(b - a) < 3 ? a + dir * 3 : b; // show at least a stub for a drive that went nowhere
  const goal = dir === 1 ? W - ez : ez; // the goal line this offense is driving at
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="field" aria-hidden="true">
      <rect x="0" y="2" width={W} height={H - 4} rx="3" fill="#123524" />
      <rect x="0" y="2" width={ez} height={H - 4} fill={game.away.color} /><rect x={W - ez} y="2" width={ez} height={H - 4} fill={game.home.color} />
      {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${fx((i + 1) * 10)} 2 V${H - 2}`} stroke={i === 4 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.22)'} />)}
      {d.kind === 'td' ? <rect x={dir === 1 ? W - ez : 0} y="2" width={ez} height={H - 4} fill="none" stroke={color} strokeWidth="3" /> : null}
      <path d={`M${a} ${mid + 2} H${tip}`} stroke="#6E3AB5" strokeWidth="7" transform="translate(2 2)" />
      <path d={`M${a} ${mid} H${tip}`} stroke={color} strokeWidth="7" />
      {d.kind === 'fg' ? (
        <>
          <rect x={tip - 3.5} y={mid - 7} width="7" height="14" fill={color} stroke="#0C1124" strokeWidth="1" />
          <path d={`M${tip + dir * 6} ${mid} H${goal + dir * 8}`} stroke={color} strokeWidth="2.5" strokeDasharray="2 5" strokeLinecap="round" />
          <path d={`M${goal + dir * 11} ${mid - 9} V${mid + 9} M${goal + dir * 11} ${mid} H${goal + dir * 4}`} stroke="#F5F5F7" strokeWidth="2.5" strokeLinecap="round" fill="none" transform={`rotate(${dir === 1 ? 0 : 0})`} />
        </>
      ) : (
        <path d={`M${tip + dir * (d.kind === 'td' ? 10 : 7)} ${mid} L${tip} ${mid - (d.kind === 'td' ? 9 : 7)} V${mid + (d.kind === 'td' ? 9 : 7)} Z`} fill={color} stroke="#0C1124" strokeWidth="1" />
      )}
    </svg>
  );
}
function Drives({ drives, game }) {
  const live = game.state === 'live';
  const list = live ? [...drives].reverse() : drives; // newest first while the game is on
  const [open, setOpen] = useState(() => drives.find((d) => d.live)?.id ?? null);
  const team = (d) => (d.side === 'home' ? game.home : game.away);
  return (
    <section className="sec">
      <H2>Drives</H2>
      <div className="card">
        {list.map((d) => { const t = team(d), isOpen = open === d.id; const color = d.kind === 'td' ? 'var(--yellow)' : d.kind === 'fg' ? 'var(--lime)' : d.turnover ? '#FF7AA6' : 'var(--teal)'; return (
          <div className="drive" key={d.id}>
            <button className="dhead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>
              <Blob team={t} />
              <span className="dmain">
                <span className="dres" style={{ color }}>{d.live ? <><span className="dot" aria-hidden="true" style={{ marginRight: 6 }} />On the field</> : (d.result || 'Drive')}
</span>
                <span className="dsum">{[d.summary, d.startText ? `from ${d.startText}` : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="dwhen"><span>{d.period ? `Q${d.period}` : ''} {d.clock}<i aria-hidden="true">{isOpen ? '▴' : '▾'}</i></span>
                {d.scoreChanged && !d.live ? <span className="dscore" aria-label={`Score: ${game.away.abbr} ${d.score.away}, ${game.home.abbr} ${d.score.home}`}><b className={d.side === 'away' ? 'hit' : ''}>{d.score.away}</b>-<b className={d.side === 'home' ? 'hit' : ''}>{d.score.home}</b></span> : null}</span>
            </button>
            <DriveField d={d} game={game} />
            {isOpen ? (
              <ol className="dplays">
                {d.plays.map((p, i) => <li key={i}>{p.down ? <b>{p.down}</b> : null}<span style={p.scoring ? { color: 'var(--yellow)', fontWeight: 800 } : undefined}>{p.text}</span></li>)}
                {!d.plays.length ? <li>No plays listed for this drive.</li> : null}
              </ol>
            ) : null}
          </div>); })}
      </div>
    </section>
  );
}

/* ---------- basketball: shot chart ---------- */
function ShotChart({ shots, game, lg }) {
  const [side, setSide] = useState(0);
  const [per, setPer] = useState(0);
  const teams = [game.away, game.home];
  const mine = shots.filter((s) => s.teamId === teams[side].id);
  const periods = [...new Set(shots.map((s) => s.period))].filter(Boolean).sort((a, b) => a - b);
  const shown = mine.filter((s) => !per || s.period === per);
  const made = shown.filter((s) => s.made).length, threes = shown.filter((s) => s.three), made3 = threes.filter((s) => s.made).length;
  // Court in feet: x 0 to 50, basket at (25, 0), baseline 5.25 behind it. Six px per foot.
  const pro = lg === 'nba', K = 6, top = 5.25, depth = 40;
  const X = (v) => v * K, Y = (v) => (v + top) * K;
  const r3 = pro ? 23.75 : 22.15, corner = pro ? 22 : 21.65, yc = Math.sqrt(r3 * r3 - corner * corner), lane = pro ? 8 : 6;
  const court = [
    `M0 0 H${X(50)} V${Y(depth)} H0 Z`,
    `M${X(25 - lane)} 0 V${Y(13.75)} H${X(25 + lane)} V0`,
    `M${X(19)} ${Y(13.75)} A${6 * K} ${6 * K} 0 0 0 ${X(31)} ${Y(13.75)}`,
    `M${X(25 - corner)} 0 V${Y(yc)} A${r3 * K} ${r3 * K} 0 0 0 ${X(25 + corner)} ${Y(yc)} V0`,
    `M${X(22)} ${Y(-1.25)} H${X(28)}`,
  ].join(' ');
  const pctTxt = (m, n) => (n ? ` · ${Math.round((100 * m) / n)}%` : '');
  return (
    <section className="sec">
      <H2>Shot Chart</H2>
      <div className="seg" role="group" aria-label="Team" style={{ marginTop: 10 }}>
        {teams.map((t, i) => <button key={t.id} aria-pressed={side === i} onClick={() => setSide(i)}>{t.name}</button>)}
      </div>
      {periods.length > 1 ? (
        <div className="chips" role="group" aria-label="Period" style={{ marginTop: 8 }}>
          <button className="chipb" aria-pressed={per === 0} onClick={() => setPer(0)}>All</button>
          {periods.map((p) => <button key={p} className="chipb" aria-pressed={per === p} onClick={() => setPer(p)}>{p <= (LEAGUE[lg].periods || 4) ? `${LEAGUE[lg].periods === 2 ? 'H' : 'Q'}${p}` : 'OT'}</button>)}
        </div>
      ) : null}
      <div className="card pad shotbox">
        <div className="legend">
          <span className="lg" style={{ background: '#FFBE2E' }}>MADE <b>{made}</b></span>
          <span className="lg" style={{ background: '#FF7AA6' }}>MISSED <b>{shown.length - made}</b></span>
        </div>
        <div role="img" aria-label={`${teams[side].name} shots: ${made} made of ${shown.length}.`}>
          <svg viewBox={`-6 -6 ${X(50) + 12} ${Y(depth) + 12}`} className="court" aria-hidden="true">
            <rect x="0" y="0" width={X(50)} height={Y(depth)} fill="#10162C" />
            <path d={court} fill="none" stroke="#6E3AB5" strokeWidth="3" transform="translate(2.5 2.5)" />
            <path d={court} fill="none" stroke="#22D3D6" strokeWidth="3" strokeLinejoin="miter" />
            <circle cx={X(25)} cy={Y(0)} r="5" fill="none" stroke="#FF7A1A" strokeWidth="3" />
            {shown.filter((s) => !s.made).map((s, i) => { const x = X(Math.max(0.6, Math.min(49.4, s.x))), y = Y(Math.max(-4.6, Math.min(depth - 0.6, s.y))); return <path key={'m' + i} d={`M${x - 4.5} ${y - 4.5} L${x + 4.5} ${y + 4.5} M${x + 4.5} ${y - 4.5} L${x - 4.5} ${y + 4.5}`} stroke="#FF7AA6" strokeWidth="2.6" strokeLinecap="square" />; })}
            {shown.filter((s) => s.made).map((s, i) => { const x = X(Math.max(0.6, Math.min(49.4, s.x))), y = Y(Math.max(-4.6, Math.min(depth - 0.6, s.y))); return <rect key={'k' + i} x={x - 5} y={y - 5} width="10" height="10" fill="#FFBE2E" stroke="#0C1124" strokeWidth="1.6" />; })}
          </svg>
        </div>
        <p className="stamp" style={{ marginTop: 10 }}>Field goals {made}-{shown.length}{pctTxt(made, shown.length)} · Threes {made3}-{threes.length}{pctTxt(made3, threes.length)}</p>
      </div>
    </section>
  );
}

/* ---------- hockey: every shot on the rink. Away team shoots right, home team shoots left. ---------- */
export function IceChart({ ice, game }) {
  const [per, setPer] = useState(0);
  const cc = chartColors(game.away, game.home);
  const col = (id) => (id === game.away.id ? cc.away.main : cc.home.main);
  const periods = [...new Set(ice.map((s) => s.period))].filter(Boolean).sort((a, b) => a - b);
  const shown = ice.filter((s) => !per || s.period === per);
  const K = 3, W = 200 * K, H = 85 * K;
  const X = (v) => (Math.max(-98, Math.min(98, v)) + 100) * K, Y = (v) => (42.5 - Math.max(-40.5, Math.min(40.5, v))) * K;
  const count = (id, kind) => shown.filter((s) => s.teamId === id && (!kind || s.kind === kind)).length;
  const dots = [25, 175].flatMap((x) => [20.5, 64.5].map((y) => [x * K, y * K]));
  const order = { miss: 0, save: 1, goal: 2 };
  return (
    <section className="sec">
      <H2>Ice Chart</H2>
      {periods.length > 1 ? (
        <div className="chips" role="group" aria-label="Period" style={{ marginTop: 8 }}>
          <button className="chipb" aria-pressed={per === 0} onClick={() => setPer(0)}>All</button>
          {periods.map((p) => <button key={p} className="chipb" aria-pressed={per === p} onClick={() => setPer(p)}>{p <= 3 ? `P${p}` : 'OT'}</button>)}
        </div>
      ) : null}
      <div className="card pad shotbox">
        <div className="icekey">
          {[game.away, game.home].map((t, i) => (
            <span key={t.id} style={{ textAlign: i ? 'right' : 'left' }}><b style={{ color: col(t.id) }}>{t.abbr} {i ? '←' : '→'}</b><small>{count(t.id, 'goal')} goals · {count(t.id)} shots</small></span>
          ))}
        </div>
        <div role="img" aria-label={`Shot locations. ${game.away.name}: ${count(game.away.id, 'goal')} goals on ${count(game.away.id)} shots. ${game.home.name}: ${count(game.home.id, 'goal')} goals on ${count(game.home.id)} shots.`}>
          <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} className="court" aria-hidden="true">
            <rect x="2.5" y="2.5" width={W} height={H} rx={28 * K} fill="none" stroke="#6E3AB5" strokeWidth="3" />
            <rect x="0" y="0" width={W} height={H} rx={28 * K} fill="#10162C" stroke="#22D3D6" strokeWidth="3" />
            <path d={`M${100 * K} 0 V${H}`} stroke="#FF3D7F" strokeWidth="3" />
            <path d={`M${75 * K} 0 V${H} M${125 * K} 0 V${H}`} stroke="#22D3D6" strokeWidth="4" opacity="0.8" />
            <path d={`M${11 * K} ${6 * K} V${H - 6 * K} M${189 * K} ${6 * K} V${H - 6 * K}`} stroke="#FF3D7F" strokeWidth="1.5" opacity="0.7" />
            <circle cx={100 * K} cy={H / 2} r={15 * K} fill="none" stroke="#22D3D6" strokeWidth="1.5" opacity="0.6" />
            {dots.map(([x, y], i) => <circle key={i} cx={x + (x < W / 2 ? 6 * K : -6 * K)} cy={y} r={15 * K} fill="none" stroke="#FF3D7F" strokeWidth="1.5" opacity="0.45" />)}
            <path d={`M${11 * K} ${H / 2 - 4 * K} a${6 * K} ${4 * K} 0 0 1 0 ${8 * K} Z M${189 * K} ${H / 2 - 4 * K} a${6 * K} ${4 * K} 0 0 0 0 ${8 * K} Z`} fill="rgba(34,211,214,.25)" stroke="#22D3D6" strokeWidth="1.5" />
            {[...shown].sort((a, b) => order[a.kind] - order[b.kind]).map((s, i) => {
              const x = X(s.x), y = Y(s.y), c = col(s.teamId);
              if (s.kind === 'miss') return <path key={i} d={`M${x - 4.5} ${y - 4.5} L${x + 4.5} ${y + 4.5} M${x + 4.5} ${y - 4.5} L${x - 4.5} ${y + 4.5}`} stroke={c} strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />;
              if (s.kind === 'save') return <circle key={i} cx={x} cy={y} r="5" fill="#10162C" stroke={c} strokeWidth="2.6" />;
              return <g key={i}><rect x={x - 8} y={y - 8} width="16" height="16" fill="#FFBE2E" stroke="#0C1124" strokeWidth="2" transform={`rotate(45 ${x} ${y})`} /><circle cx={x} cy={y} r="4" fill={c} stroke="#0C1124" strokeWidth="1.2" /></g>;
            })}
          </svg>
        </div>
        <div className="legend" style={{ margin: '12px 0 0', flexWrap: 'wrap' }}>
          <span className="lg" style={{ background: '#FFBE2E' }}>◆ GOAL</span>
          <span className="lg" style={{ background: '#CBD2EA' }}>○ SAVED</span>
          <span className="lg" style={{ background: '#CBD2EA' }}>✕ MISSED</span>
        </div>
        <p className="stamp" style={{ marginTop: 10, textAlign: 'left' }}>Each team's shots are turned to face one goal, so the ends do not flip between periods.</p>
      </div>
    </section>
  );
}

/* ---------- soccer: every shot on the pitch. Away attacks right, home attacks left. ---------- */
const PITCH_KINDS = [['goal', 'Goal'], ['save', 'Saved'], ['miss', 'Off target'], ['block', 'Blocked'], ['post', 'Woodwork']];
function PitchChart({ shots, game }) {
  const [per, setPer] = useState(0);
  const [off, setOff] = useState({}); // kinds switched off
  const cc = chartColors(game.away, game.home);
  const col = (side) => (side === 'away' ? cc.away.main : cc.home.main);
  const periods = [...new Set(shots.map((s) => s.period))].filter(Boolean).sort((a, b) => a - b);
  const shown = shots.filter((s) => (!per || s.period === per) && !off[s.kind]);
  const K = 4, W = 105 * K, H = 68 * K;
  const X = (v) => (v / 100) * W, Y = (v) => (v / 100) * H;
  const n = (side, kind) => shots.filter((s) => s.side === side && (!per || s.period === per) && (!kind || s.kind === kind || (kind === 'on' && (s.kind === 'goal' || s.kind === 'save')))).length;
  const box = (x, w, h) => <rect x={x} y={(H - h * K) / 2} width={w * K} height={h * K} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />;
  const mark = (s, i) => {
    const x = X(s.x), y = Y(s.y), c = col(s.side);
    if (s.kind === 'goal') return <g key={i}><circle cx={x} cy={y} r="8" fill="#FFBE2E" stroke="#0C1124" strokeWidth="2" /><circle cx={x} cy={y} r="3" fill="#0C1124" /></g>;
    if (s.kind === 'save') return <circle key={i} cx={x} cy={y} r="6" fill={c} stroke="#fff" strokeWidth="1.8" />;
    if (s.kind === 'post') return <rect key={i} x={x - 5} y={y - 5} width="10" height="10" fill="#fff" stroke={c} strokeWidth="2.4" transform={`rotate(45 ${x} ${y})`} />;
    if (s.kind === 'block') return <g key={i}><circle cx={x} cy={y} r="6" fill="#123524" stroke={c} strokeWidth="2.2" /><path d={`M${x - 3.5} ${y - 3.5} L${x + 3.5} ${y + 3.5}`} stroke={c} strokeWidth="2" /></g>;
    return <circle key={i} cx={x} cy={y} r="6" fill="none" stroke={c} strokeWidth="2.4" />;
  };
  const order = { miss: 0, block: 1, post: 2, save: 3, goal: 4 };
  return (
    <section className="sec">
      <H2>Shot Map</H2>
      {periods.length > 1 ? (
        <div className="chips" role="group" aria-label="Half" style={{ marginTop: 8 }}>
          <button className="chipb" aria-pressed={per === 0} onClick={() => setPer(0)}>Full match</button>
          {periods.map((p) => <button key={p} className="chipb" aria-pressed={per === p} onClick={() => setPer(p)}>{p === 1 ? '1st half' : p === 2 ? '2nd half' : p <= 4 ? `Extra time ${p - 2}` : 'Extra'}</button>)}
        </div>
      ) : null}
      <div className="card pad shotbox">
        <div className="icekey">
          {[['away', game.away], ['home', game.home]].map(([side, t]) => (
            <span key={side} style={{ textAlign: side === 'home' ? 'right' : 'left' }}><b style={{ color: col(side) }}>{t.abbr} {side === 'home' ? '←' : '→'}</b><small>{n(side, 'goal')} goals · {n(side, 'on')} on target · {n(side)} shots</small></span>
          ))}
        </div>
        <div role="img" aria-label={`Shot map. ${game.away.name}: ${n('away')} shots, ${n('away', 'on')} on target. ${game.home.name}: ${n('home')} shots, ${n('home', 'on')} on target.`}>
          <svg viewBox={`-6 -6 ${W + 12} ${H + 12}`} className="court" aria-hidden="true">
            <rect x="2.5" y="2.5" width={W} height={H} rx="6" fill="none" stroke="#6E3AB5" strokeWidth="3" />
            <rect x="0" y="0" width={W} height={H} rx="6" fill="#123524" />
            {Array.from({ length: 10 }, (_, i) => i % 2 ? <rect key={i} x={(i * W) / 10} y="0" width={W / 10} height={H} fill="rgba(255,255,255,.035)" /> : null)}
            <rect x="0" y="0" width={W} height={H} rx="6" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
            <path d={`M${W / 2} 0 V${H}`} stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
            <circle cx={W / 2} cy={H / 2} r={9.15 * K} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
            <circle cx={W / 2} cy={H / 2} r="2.5" fill="rgba(255,255,255,.7)" />
            {box(0, 16.5, 40.3)}{box(W - 16.5 * K, 16.5, 40.3)}{box(0, 5.5, 18.3)}{box(W - 5.5 * K, 5.5, 18.3)}
            <circle cx={11 * K} cy={H / 2} r="2.5" fill="rgba(255,255,255,.7)" /><circle cx={W - 11 * K} cy={H / 2} r="2.5" fill="rgba(255,255,255,.7)" />
            <path d={`M${16.5 * K} ${H / 2 - 7.3 * K} A${9.15 * K} ${9.15 * K} 0 0 1 ${16.5 * K} ${H / 2 + 7.3 * K}`} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
            <path d={`M${W - 16.5 * K} ${H / 2 - 7.3 * K} A${9.15 * K} ${9.15 * K} 0 0 0 ${W - 16.5 * K} ${H / 2 + 7.3 * K}`} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.5" />
            <rect x={-4} y={H / 2 - 3.66 * K} width="4" height={7.32 * K} fill="#fff" /><rect x={W} y={H / 2 - 3.66 * K} width="4" height={7.32 * K} fill="#fff" />
            {[...shown].sort((a, b) => order[a.kind] - order[b.kind]).map(mark)}
          </svg>
        </div>
        <div className="chips" role="group" aria-label="Show shots" style={{ marginTop: 12 }}>
          {PITCH_KINDS.filter(([k]) => shots.some((s) => s.kind === k)).map(([k, label]) => (
            <button key={k} className="chipb" aria-pressed={!off[k]} onClick={() => setOff({ ...off, [k]: !off[k] })}>{label}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- play-by-play (not football) ---------- */
function PlayByPlay({ pbp, game, L }) {
  const periods = [...new Set(pbp.map((p) => p.period))].sort((a, b) => a - b);
  const [per, setPer] = useState(null);
  const [show, setShow] = useState(true);
  const cur = per ?? periods[periods.length - 1];
  const live = game.state === 'live';
  let rows = pbp.filter((p) => p.period === cur);
  if (live) rows = [...rows].reverse();
  const reg = L.periods || 4, word = PERIOD_WORD[L.sport] ?? '';
  const label = (p) => (!p ? 'Game' : p <= reg || L.sport === 'baseball' ? `${word || (L.sport === 'baseball' ? 'Inn ' : '')}${p}` : periods.filter((x) => x > reg).length > 1 ? `OT${p - reg}` : 'OT');
  const team = (id) => (id === game.home.id ? game.home : id === game.away.id ? game.away : null);
  return (
    <section className="sec">
      <div className="sechead"><H2>Play-by-Play</H2><button className="link" aria-expanded={show} onClick={() => setShow(!show)}>{show ? 'Hide' : `Show ${pbp.length} plays`}</button></div>
      {show ? (
        <>
          {periods.length > 1 ? <div className="chips" role="group" aria-label="Period" style={{ marginTop: 8 }}>{periods.map((p) => <button key={p} className="chipb" aria-pressed={cur === p} onClick={() => setPer(p)}>{label(p)}</button>)}</div> : null}
          <div className="card pad">
            {rows.map((p, i) => { const t = team(p.teamId); return (
              <div className="prow" key={i}>
                {t ? <Blob team={t} /> : <span style={{ width: 28, flex: 'none' }} />}
                <span className="txt" style={p.scoring ? { fontWeight: 800 } : { color: 'var(--soft)' }}>{p.text}</span>
                <span className="sc">{p.scoring && Number.isFinite(p.away) && Number.isFinite(p.home) ? <span style={{ color: 'var(--yellow)' }}>{p.away}-{p.home}</span> : ''}<small>{p.clock}</small></span>
              </div>); })}
          </div>
        </>
      ) : null}
    </section>
  );
}

const Pct = ({ label, v, skip }) => { const p = !skip && PCT_COLS.has(label) ? pctOf(v, 1) : ''; return p ? <small className="pct"> {p}</small> : null; };
function BoxScore({ box, game, sport }) {
  const [side, setSide] = useState(0);
  const teams = [game.away, game.home];
  const cur = box[side];
  const linkPlayers = isCovered(useCovered(game.lg), teams[side].id); // no player pages for small-college opponents
  const hasBench = sport === 'basketball';
  const noPm = sport === 'basketball' && cur.groups.length > 0 && !cur.groups.some((g) => g.labels.includes('+/-'));
  return (
    <section className="sec">
      <H2>Box Score</H2>
      <div className="seg" role="group" aria-label="Team" style={{ marginTop: 10 }}>
        {teams.map((t, i) => <button key={t.id} aria-pressed={side === i} onClick={() => setSide(i)}>{t.name}</button>)}
      </div>
      {cur.groups.length ? cur.groups.map((gr) => {
        const bench = hasBench ? gr.rows.findIndex((r, i) => i > 0 && !r.starter && gr.rows[i - 1].starter) : -1;
        return (
          <div className="card pbox" key={gr.key + gr.title}>
            <table>
              <thead><tr><th scope="col" className="who">{gr.title}</th>{gr.labels.map((l, i) => <th scope="col" key={i} className={l === '+/-' ? 'hot' : undefined}>{l}</th>)}</tr></thead>
              <tbody>
                {gr.rows.map((r, i) => (
                  <React.Fragment key={r.id || r.name + i}>
                    {i === bench ? <tr className="bench"><th scope="colgroup" className="who">Bench</th><td colSpan={gr.labels.length} /></tr> : null}
                    <tr><th scope="row" className="who">{r.id && linkPlayers ? <button className="plink" onClick={() => go(`player/${game.lg}/${r.id}`)}>{r.name}</button> : r.name}{r.pos ? <small> {r.pos}</small> : null}</th>{r.stats.map((v, j) => <td key={j} className={gr.labels[j] === '+/-' ? (parseFloat(v) > 0 ? 'up' : parseFloat(v) < 0 ? 'down' : undefined) : undefined}>{pct1(gr.labels[j], v)}<Pct label={gr.labels[j]} v={v} skip={gr.labels.some((l) => /PCT|%/i.test(l))} /></td>)}</tr>
                  </React.Fragment>
                ))}
                {gr.totals ? <tr className="tot"><th scope="row" className="who">Team</th>{gr.totals.map((v, j) => <td key={j}>{pct1(gr.labels[j], v)}<Pct label={gr.labels[j]} v={v} skip={gr.labels.some((l) => /PCT|%/i.test(l))} /></td>)}</tr> : null}
              </tbody>
            </table>
          </div>
        );
      }) : <Empty>No player stats for {teams[side].name} yet.</Empty>}
      {noPm ? <p className="stamp" style={{ textAlign: 'left' }}>+/- is not available for this game. The feed does not send it for this league, and the play-by-play did not log every substitution, so it could not be counted.</p> : null}
    </section>
  );
}

function GamePage({ lg, id }) {
  const L = LEAGUE[lg];
  const q = useQuery(`game:${lg}:${id}`, () => getGame(lg, id), (d) => (d?.game?.state === 'live' ? 20000 : d?.game?.state === 'pre' ? 120000 : 0));
  const d = q.data, g = d?.game;
  const title = g ? `${g.away.abbr} at ${g.home.abbr}` : L.name;
  const started = g && (g.state === 'live' || g.state === 'final');
  const periods = g ? Math.max(g.home.lines.length, g.away.lines.length) : 0;
  const [picked, setTab] = useSticky('tab', 'summary');
  // Only offer the sections this game actually has.
  const tabs = !d || !started ? [] : [
    ['summary', 'Summary'],
    d.drives.length ? ['drives', 'Drives'] : null,
    d.shots.length ? ['shots', 'Shot Chart'] : null,
    d.ice?.length ? ['ice', 'Ice Chart'] : null,
    d.pitch?.length ? ['pitch', 'Shot Map'] : null,
    d.pbp.length ? ['plays', 'Plays'] : null,
    d.box.length ? ['box', 'Box Score'] : null,
    d.stats.length ? ['stats', 'Team Stats'] : null,
  ].filter(Boolean);
  const tab = tabs.some(([k]) => k === picked) ? picked : 'summary';
  const perLabel = (i) => (i < (L.periods || 4) || L.sport === 'baseball' ? `${PERIOD_WORD[L.sport] ?? ''}${i + 1}` : periods - (L.periods || 4) > 1 ? `OT${i - (L.periods || 4) + 1}` : 'OT');
  return (
    <>
      <SubHeader title={title} />
      <Page>
        {q.loading && !d ? <Loading rows={5} /> : q.error && !d ? <Problem error={q.error} retry={q.reload} /> : (
          <>
            <div className="board" style={{ background: `linear-gradient(rgba(12,17,36,.38), rgba(12,17,36,.5)), linear-gradient(115deg, ${g.away.color} 0 44%, ${g.home.color} 56% 100%)` }}>
              <div className="top">
                <span className="pill num" style={g.state === 'live' ? { background: 'var(--pink)', color: '#0C1124' } : g.state === 'final' ? { background: '#232C50', color: '#F5F5F7' } : { background: 'var(--teal)', color: '#0C1124' }}>
                  {g.state === 'live' ? <span className="dot" aria-hidden="true" style={{ background: '#0C1124', marginRight: 6 }} /> : null}{g.state === 'pre' ? 'UPCOMING' : statusLabel(g).toUpperCase()}
                </span>
                <LgTag lg={lg} />
              </div>
              <div className="grid">
                {[g.away, null, g.home].map((t, i) => t ? (
                  <button key={t.id} className="tm" onClick={() => go(`team/${lg}/${t.id}`)} aria-label={`Open ${t.full}`}>
                    <span style={{ borderRadius: 16, boxShadow: '0 0 0 2px #fff, 3px 3px 0 2px #0C1124' }}><Blob team={t} size={58} radius={16} /></span>
                    <span className="nm" style={t.name.length > 12 ? { fontStretch: '87.5%', fontSize: 12 } : t.name.length > 9 ? { fontStretch: '100%', fontSize: 13 } : undefined}>{t.name}</span>
                    <span className="rc">{t.rank ? <b className="brk">No. {t.rank}</b> : null}{t.rank && t.record ? ' · ' : ''}{t.record}</span>
                  </button>
                ) : started ? <div key="s" className="score" aria-label={`${g.away.score} to ${g.home.score}`}>{g.away.score}<span style={{ opacity: 0.7 }}> · </span>{g.home.score}</div>
                  : <div key="s" className="when">{g.state === 'off' ? (g.statusText || 'Postponed') : <>{g.tbd ? 'TBD' : fmtTime(g.date)}<div style={{ fontSize: 12, color: '#fff', textShadow: 'none', fontStyle: 'normal', fontWeight: 800 }}>{fmtDate(g.date)}</div></>}</div>)}
              </div>
              {g.note || d.venue ? <p style={{ marginTop: 12, textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>{[g.note, d.venue].filter(Boolean).join(' · ')}</p> : null}
            </div>

            {tabs.length > 1 ? (
              <div className="gtabs" role="tablist" aria-label="Game sections">
                {tabs.map(([k, label]) => <button key={k} role="tab" className="chipb" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
              </div>
            ) : null}

            {tab === 'summary' ? (
              <div className="gtab">
                {started && periods > 0 ? (
                  <section className="card pad linesbox" style={{ marginTop: 12 }}>
                    <table className="lines">
                      <thead><tr><th scope="col"><span style={{ position: 'absolute', left: -9999 }}>Team</span></th>{Array.from({ length: periods }, (_, i) => <th scope="col" key={i}>{perLabel(i)}</th>)}<th scope="col">T</th></tr></thead>
                      <tbody>{[g.away, g.home].map((t) => <tr key={t.id}><td>{t.abbr}</td>{Array.from({ length: periods }, (_, i) => <td key={i}>{t.lines[i] ?? ''}</td>)}<td>{t.score}</td></tr>)}</tbody>
                    </table>
                  </section>
                ) : null}
                {d.chart ? <ScoreChart chart={d.chart} game={g} L={L} /> : null}
                {d.plays.length ? (
                  <section className="sec">
                    <H2>Scoring</H2>
                    <div className="card pad">
                      {d.plays.map((p, i) => { const t = p.teamId === g.home.id ? g.home : p.teamId === g.away.id ? g.away : null; return (
                        <div className="prow" key={i}>
                          {t ? <Blob team={t} /> : <span style={{ width: 28 }} />}
                          <span className="txt">{p.kind ? <span className="kind" style={{ color: 'var(--yellow)' }}>{p.kind}</span> : null}{p.text}</span>
                          <span className="sc">{Number.isFinite(p.away) && Number.isFinite(p.home) ? `${p.away}-${p.home}` : ''}<small>{p.period ? `${PERIOD_WORD[L.sport] ?? ''}${p.period}` : ''} {p.clock}</small></span>
                        </div>); })}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
            {tab === 'drives' ? <div className="gtab solo"><Drives drives={d.drives} game={g} /></div> : null}
            {tab === 'shots' ? <div className="gtab solo"><ShotChart shots={d.shots} game={g} lg={lg} /></div> : null}
            {tab === 'ice' ? <div className="gtab solo"><IceChart ice={d.ice} game={g} /></div> : null}
            {tab === 'pitch' ? <div className="gtab solo"><PitchChart shots={d.pitch} game={g} /></div> : null}
            {tab === 'plays' ? <div className="gtab solo"><PlayByPlay pbp={d.pbp} game={g} L={L} /></div> : null}
            {tab === 'box' ? <div className="gtab solo"><BoxScore box={d.box} game={g} sport={L.sport} /></div> : null}
            {tab === 'stats' ? (
              <div className="gtab solo">
                <section className="sec">
                  <H2>Team Stats</H2>
                  <div className="card pad">
                    {d.stats.map((s, i) => { const barC = chartColors(g.away, g.home); const max = Math.max(s.awayN, s.homeN) || 1; return (
                      <div className="statrow" key={s.label}>
                        <div className="lab"><span>{s.label}</span></div>
                        {[[g.away, s.away, s.awayN, barC.away.main, s.awayPct], [g.home, s.home, s.homeN, barC.home.main, s.homePct]].map(([t, v, n, c, pc]) => (
                          <div className="bar" key={t.id}><span>{t.abbr}</span><span className="track"><span className="fill" style={{ display: 'block', width: `${Math.round((n / max) * 100)}%`, background: c, animationDelay: `${120 + i * 70}ms` }} /></span><span className="val">{pct1(s.label, v)}{pc ? <small> {pc}</small> : null}</span></div>
                        ))}
                      </div>); })}
                  </div>
                </section>
              </div>
            ) : null}

            {!started && d.preview ? <Preview p={d.preview} game={g} lg={lg} /> : !started && g.state === 'pre' ? <Empty>Scoring and stats show up here once the game starts.</Empty> : null}
            <Stamp at={q.updatedAt} live={g.state === 'live'} />
          </>
        )}
      </Page>
    </>
  );
}

/* ---------- Before the game: how the two teams stack up ---------- */
function Preview({ p, game, lg }) {
  const names = useQuery(`names:${lg}`, () => getTeamNames(lg), () => 0).data || {};
  const cc = chartColors(game.away, game.home);
  const both = [game.away, game.home];
  const [l5, setL5] = useSticky('l5', game.away.id);
  const inGroup = (gr, id) => gr.rows.some((r) => r.id === id);
  const shared = p.standings.find((gr) => inGroup(gr, game.away.id) && inGroup(gr, game.home.id));
  const groups = shared ? [shared] : p.standings;
  const [gi, setGi] = useSticky('stand', 0);
  const gr = groups[Math.min(gi, groups.length - 1)];
  const leaderKeys = [...new Set(both.flatMap((t) => (p.leaders[t.id] || []).map((x) => x.key)))];
  const lead = (t, k) => (p.leaders[t.id] || []).find((x) => x.key === k);
  return (
    <>
      {p.compare.length ? (
        <section className="sec">
          <H2>Team Stats</H2>
          <div className="card pad">
            <div className="vshead">{both.map((t, i) => <span key={t.id} style={{ flexDirection: i ? 'row-reverse' : 'row' }}><Blob team={t} size={26} /><b>{t.abbr}</b>{p.streak[t.id] ? <small>{p.streak[t.id]}</small> : null}</span>)}<em>Season averages</em></div>
            {p.compare.map((r) => {
              const tot = Math.abs(r.awayN) + Math.abs(r.homeN) || 1;
              const aBest = r.awayN === r.homeN ? null : (r.awayN > r.homeN) !== r.lowerBetter;
              return (
                <div className="vsrow" key={r.key}>
                  <div className="vsnums"><b className={aBest === true ? 'best' : ''}>{r.away}</b><span>{r.label}</span><b className={aBest === false ? 'best' : ''}>{r.home}</b></div>
                  {r.pct ? (
                    <div className="vsbar two"><i style={{ width: `${Math.min(100, r.awayN)}%`, background: cc.away.main }} /><i style={{ width: `${Math.min(100, r.homeN)}%`, background: cc.home.main }} /></div>
                  ) : (
                    <div className="vsbar"><i style={{ width: `${(Math.abs(r.awayN) / tot) * 100}%`, background: cc.away.main }} /><i style={{ width: `${(Math.abs(r.homeN) / tot) * 100}%`, background: cc.home.main }} /></div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {leaderKeys.length ? (
        <section className="sec">
          <H2>Season Leaders</H2>
          <div className="card pad">
            {leaderKeys.map((k) => {
              const a = lead(game.away, k), h = lead(game.home, k);
              const side = (x, right) => (x ? (
                <button className={'vslead' + (right ? ' r' : '')} onClick={() => x.player.id && go(`player/${lg}/${x.player.id}`)}>
                  <b>{x.value}<small> {x.unit}</small></b>
                  <span className="who">{x.player.name}{x.player.jersey ? <small> #{x.player.jersey}</small> : null}</span>
                  {x.sub ? <span className="sub">{x.sub}</span> : null}
                </button>
              ) : <span className="vslead" />);
              return (
                <div className="vsleadrow" key={k}>
                  {side(a, false)}
                  <span className="mid">{(a || h).title}</span>
                  {side(h, true)}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {Object.keys(p.last5).length ? (
        <section className="sec">
          <H2>Last Five Games</H2>
          <div className="seg" role="group" aria-label="Team" style={{ marginBottom: 10 }}>
            {both.filter((t) => p.last5[t.id]).map((t) => <button key={t.id} aria-pressed={l5 === t.id} onClick={() => setL5(t.id)}>{t.name}</button>)}
          </div>
          <div className="card">
            {(p.last5[l5] || p.last5[game.away.id] || p.last5[game.home.id] || []).map((e) => (
              <button key={e.id} className="lrow" onClick={() => e.id && go(`game/${lg}/${e.id}`)}>
                {e.opp ? <Blob team={e.opp} /> : null}
                <span className="nm">{e.at === '@' ? 'at' : 'vs'} {names[e.opp?.id] || e.opp?.name || ''}<span className="sub">{e.date ? new Date(e.date).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }) : ''}</span></span>
                <span className="res">{e.result ? <b style={{ background: e.result === 'W' ? 'var(--win-bg)' : 'var(--rule)', color: e.result === 'W' ? 'var(--lime)' : 'var(--soft)' }}>{e.result}</b> : null}{e.score}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {gr ? (
        <section className="sec">
          <H2>Standings</H2>
          {groups.length > 1 ? (
            <div className="seg" role="group" aria-label="Conference" style={{ marginBottom: 10 }}>
              {groups.map((x, i) => <button key={x.title} aria-pressed={gr === x} onClick={() => setGi(i)}>{x.title}</button>)}
            </div>
          ) : null}
          <div className="card">
            <div className="shead"><span className="nm">{gr.title}</span>{gr.cols.map((c) => <span key={c} className="col">{c}</span>)}</div>
            {gr.rows.map((r, i) => (
              <button key={r.id || i} className={'srow' + (r.id === game.away.id || r.id === game.home.id ? ' me' : '')} onClick={() => r.id && go(`team/${lg}/${r.id}`)}>
                <span className="pos">{i + 1}</span>
                <span className="nm">{r.name}</span>
                {r.stats.map((v, j) => <span key={j} className="col">{v}</span>)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

/* ---------- Appearance ---------- */
function Appearance() {
  const [t, setT] = useState(getTheme);
  const pick = (v) => { setTheme(v); setT(v); };
  return (
    <section className="sec">
      <H2>Appearance</H2>
      <div className="seg" role="group" aria-label="Appearance" style={{ marginTop: 10 }}>
        {[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match phone']].map(([k, label]) => <button key={k} aria-pressed={t === k} onClick={() => pick(k)}>{label}</button>)}
      </div>
    </section>
  );
}

/* ---------- Search ---------- */
function Search() {
  const [text, setText] = useState('');
  const q0 = useQuery('teams:all', loadAllTeams, () => 0);
  const lower = useQuery(q0.data ? 'teams:lower' : null, loadLowerTeams, () => 0); // small schools join once the main list is in
  const q = useMemo(() => {
    if (!q0.data) return q0;
    const have = new Set(q0.data.map((t) => `${t.lg}:${t.id}`));
    return { ...q0, data: [...q0.data, ...(lower.data || []).filter((t) => !have.has(`${t.lg}:${t.id}`))] };
  }, [q0, lower.data]);
  const favs = useFavs();
  const term = text.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!term || !q.data) return [];
    const score = (t) => { const n = t.name.toLowerCase(), f = t.full.toLowerCase(); return n.startsWith(term) || f.startsWith(term) ? 0 : t.abbr.toLowerCase() === term ? 0 : f.includes(term) ? 1 : -1; };
    return q.data.map((t) => [score(t), t]).filter(([s]) => s >= 0).sort((a, b) => a[0] - b[0] || a[1].full.localeCompare(b[1].full)).slice(0, 40).map(([, t]) => t);
  }, [term, q.data]);
  // Players come from the feed's own search, asked a beat after typing stops.
  const [asked, setAsked] = useState('');
  useEffect(() => { const h = setTimeout(() => setAsked(term.length >= 3 ? term : ''), 350); return () => clearTimeout(h); }, [term]);
  const pq = useQuery(asked ? `psearch:${asked}` : null, () => searchPlayers(asked), () => 0);
  const players = asked && asked === term ? (pq.data || []) : [];
  const playersBusy = term.length >= 3 && (asked !== term || (pq.loading && !pq.data));
  // Real colors for what is on screen, once typing pauses. Lookups go two at a time (bursts get refused),
  // and anything that failed gets a second try a moment later.
  useEffect(() => {
    if (!hits.length) return undefined;
    let h2 = null;
    const h = setTimeout(async () => { await ensureColors(hits, 10); h2 = setTimeout(() => ensureColors(hits, 10), 1500); }, 200);
    return () => { clearTimeout(h); clearTimeout(h2); };
  }, [hits]);
  const leagues = term ? LEAGUES.filter((l) => l.name.toLowerCase().includes(term) || l.short.toLowerCase().includes(term)) : [];
  const TeamRow = ({ t }) => (
    <button className="lrow" onClick={() => go(`team/${t.lg}/${t.id}`)}>
      <Blob team={t} size={36} radius={10} /><span className="nm">{t.full || t.name}{t.div ? <span className="sub">{t.div}</span> : null}</span><LgTag lg={t.lg} />
    </button>
  );
  return (
    <>
      <SubHeader>
        <label className="search">
          <span style={{ position: 'absolute', left: -9999 }}>Search teams, players and leagues</span>
          <input id="search-box" autoFocus type="search" enterKeyHint="search" placeholder="Teams, players, leagues" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </SubHeader>
      <Page>
        {!term ? (
          <>
            {favs.length ? <section className="sec"><H2>Your Teams</H2><div className="card">{favs.map((t) => <TeamRow key={favKey(t)} t={{ ...t, full: t.name }} />)}</div></section> : null}
            <Empty>Type a team, player or league. Open a team and tap Pin to put its games on top.</Empty>
          </>
        ) : q.loading && !q.data ? <Loading /> : q.error && !q.data ? <Problem error={q.error} retry={q.reload} /> : !hits.length && !leagues.length && !players.length && !playersBusy ? <Empty>Nothing matches "{text.trim()}".</Empty> : (
          <>
            {leagues.length ? <div className="card">{leagues.map((l) => <button key={l.id} className="lrow" onClick={() => go(`league/${l.id}`)}><span className="blob" aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 10, background: l.color, color: '#0C1124', fontSize: 9 }}>{l.short}</span><span className="nm">{l.name}</span><span className="chev" aria-hidden="true">›</span></button>)}</div> : null}
            {hits.length ? <div className="card">{hits.map((t) => <TeamRow key={favKey(t)} t={t} />)}</div> : null}
            {players.length ? (
              <section className="sec" style={{ marginTop: 14 }}>
                <H2>Players</H2>
                <div className="card">{players.map((p) => (
                  <button key={p.lg + p.id} className="lrow" onClick={() => go(`player/${p.lg}/${p.id}`)}>
                    <span className="nm">{p.name}{p.team ? <span className="sub">{p.team}</span> : null}</span><LgTag lg={p.lg} />
                  </button>
                ))}</div>
              </section>
            ) : playersBusy ? <p className="stamp">Looking for players...</p> : null}
          </>
        )}
      </Page>
    </>
  );
}

/* ---------- About, with a feed check so a broken feed is easy to diagnose ---------- */
function About() {
  const [checks, setChecks] = useState(null);
  const run = async () => {
    const out = []; const push = (name, ok, detail) => { out.push({ name, ok, detail }); setChecks([...out]); };
    setChecks([]);
    let gameId = null, teamId = null;
    try { const r = await getScoreboard('nfl'); gameId = r.games[0]?.id; push('Scores', true, `${r.games.length} NFL games on the slate`); } catch (e) { push('Scores', false, e.message); }
    try { const r = await getStandings('nfl'); teamId = r.groups[0]?.rows[0]?.team.id; push('Standings', r.groups.length > 0, `${r.groups.length} groups, ${r.groups.reduce((n, g) => n + g.rows.length, 0)} teams`); } catch (e) { push('Standings', false, e.message); }
    try { const r = await getTeams('nfl'); teamId = teamId || r[0]?.id; push('Team search', r.length > 0, `${r.length} teams, read from the ${r.source || 'feed'}`); } catch (e) { push('Team search', false, e.message); }
    if (teamId) { try { const r = await getTeam('nfl', teamId); push('Team page', !!r.team.id && !r.scheduleMissing, `${r.team.full} ${r.record || '(no record)'}, ${r.schedule.length} on the schedule${r.scheduleMissing ? ', schedule did not load' : ''}`); } catch (e) { push('Team page', false, e.message); } }
    else push('Team page', false, 'No team to test with');
    try { const r = await listTeams('cfb'); push('Team colors', r.length > 0, `${r.length} college football teams with colors`); } catch (e) { push('Team colors', true, 'Using the colors built into the app (the feed\'s team list did not load, which is fine)'); }
    try { const got = []; for (const d of DIVISIONS.cfb.slice(1)) { const r = await getStandings('cfb', d.id); if (r.groups.length) got.push(`${d.label} ${r.groups.reduce((n, g) => n + g.rows.length, 0)}`); } push('College divisions', got.length > 0, got.join(', ') || 'Only FBS came back'); } catch (e) { push('College divisions', false, e.message); }
    try { const r = await getRankings('cfb'); push('Rankings', r.polls.some((p) => p.type === 'cfp'), r.polls.map((p) => `${p.name} (wk ${p.week || '?'})`).join(', ') || 'No polls'); } catch (e) { push('Rankings', false, e.message); }
    try { const r = await getLeaders('nfl'); push('League leaders', r.cats.length > 0, `${r.cats.length} stat categories, up to ${Math.max(0, ...r.cats.map((c) => c.rows.length))} players deep`); } catch (e) { push('League leaders', false, e.message); }
    try { const r = await getTeamStats('nfl'); push('Team stats', r.cats.length > 0 && r.teams.length > 0, `${r.teams.length} teams, ${r.cats.length} stat groups`); } catch (e) { push('Team stats', false, e.message); }
    let playerId = null;
    if (teamId) { try { const r = await getRoster('nfl', teamId); const n = r.groups.reduce((k, g) => k + g.players.length, 0); playerId = r.groups[0]?.players[0]?.id; push('Roster', n > 0, `${n} players`); } catch (e) { push('Roster', false, e.message); } }
    if (playerId) { try { const r = await getPlayer('nfl', playerId); const miss = Object.entries(r.missing).filter(([, v]) => v).map(([k]) => k); push('Player page', !miss.length, `${r.player.name}: ${r.gamelog.seasons.reduce((k, x) => k + x.rows.length, 0)} games logged, ${r.career.length} career tables${miss.length ? ', did not load: ' + miss.join(', ') : ''}`); } catch (e) { push('Player page', false, e.message); } }
    else push('Player page', false, 'No player to test with');
    try { const r = await searchPlayers('allen'); push('Player search', r.length > 0, `${r.length} players for "allen"`); } catch (e) { push('Player search', false, e.message); }
    if (gameId) { try { const r = await getGame('nfl', gameId); push('Game page', true, `${r.game.away.abbr} at ${r.game.home.abbr}: ${r.stats.length} stat rows, ${r.plays.length} scoring plays`); } catch (e) { push('Game page', false, e.message); } }
    else push('Game page', false, 'No game on the slate to test with');
  };
  return (
    <>
      <section className="card pad" style={{ marginTop: 4 }}>
        <p className="prose"><b>Pure sports. No odds. No ads.</b> Scores, standings and schedules for the teams you care about, and nothing that tells you what to bet.</p>
        <p className="prose">Betting lines are stripped out before anything reaches your screen. Your pinned teams are saved on this device only. There are no accounts and no tracking.</p>
        <p className="prose">Teams show as colors and abbreviations, not logos.</p>
      </section>
      <section className="sec">
        <H2>Feed Check</H2>
        <div className="card pad">
          <p className="prose">Tests each kind of data the app reads{isDemo() ? ' (demo data right now)' : ''}.</p>
          <button className="btn on" style={{ marginTop: 12 }} onClick={run}>Run the check</button>
          {checks ? <div style={{ marginTop: 12 }}>{checks.map((c) => (
            <div className="check" key={c.name}><b style={{ background: c.ok ? 'var(--lime)' : 'var(--pink)' }}>{c.ok ? '✓' : '!'}</b><span>{c.name}<small>{c.detail}</small></span></div>
          ))}</div> : null}
        </div>
      </section>
      <Appearance />
      <section className="sec">
        <H2>Demo Mode</H2>
        <div className="card pad">
          <p className="prose">Demo mode swaps in made-up games so you can click around without the live feed.</p>
          {demoLocked ? <p className="prose">This preview only runs on demo data.</p> : <button className="btn" style={{ marginTop: 12 }} onClick={() => setDemo(!isDemo())}>{isDemo() ? 'Turn demo mode off' : 'Turn demo mode on'}</button>}
        </div>
      </section>
      <p className="stamp">Fumblerooski beta 0.1</p>
    </>
  );
}
