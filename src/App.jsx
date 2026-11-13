import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LEAGUES, LEAGUE } from './data/leagues.js';
import { getStandings, getFootballSlate, DIVISIONS, FULL_DIVISIONS, getTeam, getTeamConference, getGame, getScoreboard, getTeams, getRoster, getPlayer, searchPlayers, getRankings, getRecords, getTeamNames, getTeamStatsFor, getLeaders, getDeepLeader, canGoDeep, EXTRA_BOARDS, qualifiedRule, getTeamStats, getPlusMinus, getTeamPlusMinus, breakClock, touchbackSpot, getSchedulePollRanks, fieldMoment, scoringRun, getSummary, gameFromSummary, replaySteps, replayMoments, replayCut, getNbaCup, getGamelog, hasPlusMinus, hasLeaguePlusMinus, getLeaguePlusMinus, signed, ensureColors, onColors, listTeams, pctOf, PCT_COLS, pickClock, CALLED_BACK } from './data/espn.js';
import { useQuery, useDay, boardRefresh, gameRefresh, useFavs, toggleFav, favKey, isFavGame, sortGames, dayOffset, loadAllTeams, loadLowerTeams, isDemo, setDemo, demoLocked, getTheme, setTheme, useLeaguePrefs, orderLeagues, shownLeagues, isLeagueOn, setLeagueOrder, toggleLeague, resetLeagues } from './data/store.js';
import { chartColors, inkOn, brighten } from './data/colors.js';
import { headlineGames, footballModes, freshFinal, isToday, MORNING_UNTIL } from './data/headlines.js';
import { go, swap, useRoute, Blob, Ball, LgTag, H2, GameRow, Loading, Problem, Empty, Stamp, RootHeader, SubHeader, TabBar, DemoBar, statusLabel, fmtDate, fmtTime, shortTv, enterRoute, useSticky, saveScroll, savedScroll, shortEvent, GameNote, overflows, RankBlob, shortStatus, StarCut } from './ui.jsx';

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
  const [name = '', a, b, c, e4] = parts;
  const root = ROOTS.has(name);
  let title = '', body, tab = name;
  if (name === '' || name === 'scores') { tab = ''; body = <Scores />; }
  else if (name === 'leagues') body = <Leagues />;
  else if (name === 'stats') body = <Stats key={a || 'x'} start={LEAGUE[a] ? a : null} />;
  else if (name === 'league' && LEAGUE[a]) { title = LEAGUE[a].name; tab = 'leagues'; body = <LeaguePage key={a + (b || '') + (c || '')} lg={a} focus={b === 'scores' ? undefined : b} start={b === 'scores' ? 'scores' : undefined} startDay={b === 'scores' && /^\d{8}$/.test(c || '') ? c : undefined} />; }
  else if (name === 'team' && LEAGUE[a] && b) { tab = 'leagues'; body = <TeamPage key={a + b + (c || '')} lg={a} id={b} season={/^\d{4}$/.test(c || '') ? Number(c) : null} />; }
  else if (name === 'leaders' && LEAGUE[a] && b) { tab = 'stats'; body = <LeaderPage key={a + b + (c || '') + (e4 || '')} lg={a} cat={b} focus={c} season={/^\d{4}$/.test(e4 || '') ? Number(e4) : null} />; }
  else if (name === 'player' && LEAGUE[a] && b) { tab = 'leagues'; body = <PlayerPage key={a + b + (c || '')} lg={a} id={b} season={/^\d{4}$/.test(c || '') ? c : ''} />; }
  else if (name === 'game' && LEAGUE[a] && b) { tab = ''; body = <GamePage key={a + b} lg={a} id={b} />; }
  else if (name === 'replay' && LEAGUE[a] && b) { tab = ''; body = <ReplayPage key={a + b} lg={a} id={b} start={Number(c) || 0} />; }
  else if (name === 'search') { tab = ''; body = <Search />; }
  else if (name === 'about') { title = 'About'; tab = 'leagues'; body = <About />; }
  else if (name === 'settings') { title = 'Settings'; tab = 'leagues'; body = <Settings />; }
  else { title = 'Not found'; body = <Empty>That page does not exist. <br /><button className="btn" onClick={() => go('')}>Go home</button></Empty>; }

  // Team, game and search screens draw their own header (they know the title or own the search box).
  const ownHeader = name === 'team' || name === 'game' || name === 'replay' || name === 'search' || name === 'player';
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
  const prefs = useLeaguePrefs();
  const favs = useFavs();
  const groups = useMemo(() => {
    const favSet = new Set(favs.map(favKey));
    const rank = { live: 0, final: 1, pre: 2, off: 3 };
    const pool = [...(morning ? (yest.data?.games || []) : []), ...(today.data?.games || [])];
    // Leagues switched off in Settings stay off the crawl, except games with a pinned team.
    return orderLeagues(prefs).map((l) => ({ l, games: pool.filter((g) => g.lg === l.id && (isLeagueOn(l.id, prefs) || isFavGame(g, favSet))).sort((a, b) => rank[a.state] - rank[b.state] || String(a.date).localeCompare(String(b.date))) })).filter((x) => x.games.length);
  }, [today.data, yest.data, morning, prefs, favs]);
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
            <span className={fin && a < h ? 'dim' : undefined}>{g.away.rank && g.away.rank <= 25 ? <small className="trk">{g.away.rank}</small> : null}{g.away.abbr}{g.poss && g.poss === String(g.away.id) ? <Ball red={g.redZone} /> : null}{pre ? '' : <b> {g.away.score}</b>}</span>
            <span className="at">{pre ? 'at' : ''}</span>
            <span className={fin && h < a ? 'dim' : undefined}>{g.home.rank && g.home.rank <= 25 ? <small className="trk">{g.home.rank}</small> : null}{g.home.abbr}{g.poss && g.poss === String(g.home.id) ? <Ball red={g.redZone} /> : null}{pre ? '' : <b> {g.home.score}</b>}</span>
            <span className="tstk"><span className="tst" style={{ color: g.state === 'live' ? 'var(--pink)' : g.state === 'pre' ? 'var(--teal)' : 'var(--mute)' }}>{shortStatus(statusLabel(g)).toUpperCase()}</span>
              {!fin && g.tv?.national?.length ? <span className="ttv">{shortTv(g.tv.national[0])}</span> : null}
            </span>
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
const isMorning = () => new Date().getHours() < MORNING_UNTIL;

// One day's games: your teams first, then each league in its own card.
function Board({ games, pick, favSet, title }) {
  const shown = games.filter((g) => pick === 'all' || g.lg === pick);
  const mine = sortGames(shown.filter((g) => isFavGame(g, favSet)), favSet);
  const prefs = useLeaguePrefs();
  const leagues = orderLeagues(prefs).filter((l) => shown.some((g) => g.lg === l.id && !isFavGame(g, favSet)));
  return (
    <>
      {title ? <div className="sechead" style={{ marginTop: 22 }}><H2>{title}</H2></div> : null}
      {!shown.length ? <Empty>No {pick === 'all' ? '' : LEAGUE[pick].short + ' '}games.</Empty> : null}
      {mine.length ? (
        <div className="card">
          <div className="lghead" style={{ cursor: 'default' }}><b style={{ color: 'var(--yellow)' }}>Your Teams</b><span>{mine.length} {mine.length === 1 ? 'game' : 'games'}</span></div>
          {mine.map((g) => <GameRow key={g.lg + g.id} g={g} showLg={false} />)}
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

// The day's best games per league for Headliners: your teams, then live, then ranked matchups, then by start time.
const RANKED = (g) => (g.away.rank && g.away.rank <= 25 ? 1 : 0) + (g.home.rank && g.home.rank <= 25 ? 1 : 0);
function topOf(games, favSet, n) {
  const now = new Date();
  // Live first; in the morning, last night's finals next; then today's games; then games on other days.
  const order = (g) => (g.state === 'live' ? 0 : freshFinal(g, now) ? 1 : isToday(g, now) ? (g.state === 'pre' ? 2 : 3) : g.state === 'pre' ? 4 : g.state === 'final' ? 5 : 6);
  return [...games].sort((a, b) => (isFavGame(b, favSet) - isFavGame(a, favSet)) || (order(a) - order(b)) || (RANKED(b) - RANKED(a)) || String(a.date).localeCompare(String(b.date))).slice(0, n);
}
// Headliners' games: each league's slate by the rhythm of its sport (see data/headlines.js).
function useHeadlines(prefs) {
  const now = new Date();
  const today = useDay(0);
  const morning = now.getHours() < MORNING_UNTIL;
  const yest = useDay(-1); // Your Teams keeps last night's results all day
  const modes = footballModes(now, today.data?.seasons?.cfb || '');
  const cfbW = useQuery(isLeagueOn('cfb', prefs) && modes.cfb ? `hl:cfb:${modes.cfb}` : null, () => getFootballSlate('cfb', modes.cfb === 'done'), boardRefresh);
  const nflW = useQuery(isLeagueOn('nfl', prefs) && modes.nfl ? `hl:nfl:${modes.nfl}` : null, () => getFootballSlate('nfl', modes.nfl === 'done'), boardRefresh);
  const games = useMemo(() => headlineGames({
    now: new Date(), today: today.data?.games || [], yest: morning ? (yest.data?.games || []) : [],
    weeks: { cfb: cfbW.data?.games, nfl: nflW.data?.games }, seasons: today.data?.seasons || {},
  }), [today.data, yest.data, cfbW.data, nflW.data, morning]);
  return { games, q: today, yest: yest.data?.games || [] };
}

function Scores() {
  const [lg, setLg] = useSticky('lg', 'top');
  const favs = useFavs();
  const favSet = useMemo(() => new Set(favs.map(favKey)), [favs]);
  const prefs = useLeaguePrefs();
  const pickL = LEAGUE[lg] && isLeagueOn(lg, prefs) ? lg : null;
  // A league's own slate: today, or this week for football.
  const sb0 = useQuery(pickL ? `board:${pickL}` : null, () => getScoreboard(pickL), boardRefresh);
  // The feed's default slate is its latest match day, which can be finished. When it is, add the next game day underneath.
  const todayKey = ymdOf(new Date());
  const baseDay = sb0.data?.current?.day ? sb0.data.current.day.replace(/-/g, '') : null;
  const nextDay = sb0.data?.dates && baseDay && baseDay < todayKey ? [...sb0.data.dates].map((x) => x.replace(/-/g, '')).sort().find((x) => x >= todayKey) : null;
  const sbNext = useQuery(pickL && nextDay ? `board:${pickL}:d${nextDay}` : null, () => getScoreboard(pickL, nextDay), boardRefresh);
  const sb = sb0;
  const hl = useHeadlines(prefs);
  const today = hl.games;
  // Your Teams: whatever Headliners shows for them, plus any game of theirs today, always (even in the morning results
  // window), plus how they did last night: that result stays all day, even after Headliners moves the league on to today.
  const mine = useMemo(() => {
    const seen = new Set();
    // ...unless that team plays again today: then last night's game follows the league's usual morning rule.
    const todayAll = [...today, ...(hl.q.data?.games || [])];
    const playsToday = (g, side) => todayAll.some((t) => t.lg === g.lg && t.id !== g.id && (t.away.id === g[side].id || t.home.id === g[side].id));
    const lastNight = hl.yest.filter((g) => g.state === 'final' && !['away', 'home'].some((sd) => favSet.has(favKey({ lg: g.lg, id: g[sd].id })) && playsToday(g, sd)));
    return sortGames([...today, ...(hl.q.data?.games || []), ...lastNight].filter((g) => isFavGame(g, favSet) && !seen.has(g.lg + g.id) && seen.add(g.lg + g.id)), favSet);
  }, [today, hl.q.data, hl.yest, favSet]);
  // Leagues with games today (live or not) sit above leagues showing only other days; your own league order holds within each group.
  const leagues = useMemo(() => {
    const now = new Date();
    const has = (l) => today.some((g) => g.lg === l.id && !isFavGame(g, favSet) && isToday(g, now));
    const list = shownLeagues(prefs).filter((l) => today.some((g) => g.lg === l.id && !isFavGame(g, favSet)));
    return [...list.filter(has), ...list.filter((l) => !has(l))];
  }, [today, favSet, prefs]);
  const q = pickL ? sb : hl.q;
  const gf = useGameFilter(pickL || 'top');
  return (
    <>
      <div className="chips" role="group" aria-label="League">
        <button className="chipb rchip" aria-pressed={!pickL} aria-label="Headliners" title="Headliners" onClick={() => setLg('top')}><StarCut /></button>
        {shownLeagues(prefs).map((l) => <button key={l.id} className="chipb" aria-pressed={pickL === l.id} onClick={() => setLg(l.id)}>{l.short}</button>)}
      </div>
      {q.loading && !q.data ? <Loading rows={5} /> : q.error && !q.data ? <Problem error={q.error} retry={q.reload} /> : !pickL ? (
        !today.length && !mine.length ? <Empty>No games on the board right now.</Empty> : (
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
          {gf.el ? <div className="filters" style={{ margin: '0 0 10px' }}>{gf.el}</div> : null}
          {baseDay && !sb.data.weeks && baseDay !== todayKey ? <p className="stamp" style={{ textAlign: 'left', margin: '0 0 8px' }}>{baseDay < todayKey ? 'Last played' : 'Next up'}: {dateOf(baseDay).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</p> : null}
          {sb.data.weeks && sb.data.current.week ? <p className="stamp" style={{ textAlign: 'left', margin: '0 0 8px' }}>{(sb.data.weeks.find((w) => w.week === sb.data.current.week && w.type === sb.data.current.type) || {}).label || ''}</p> : null}
          {gf.apply(sb.data.games).length ? <Board games={gf.apply(sb.data.games)} pick="all" favSet={favSet} /> : gf.on && sb.data.games.length ? <Empty>No {gf.label} games on this slate.</Empty> : <Empty>No {LEAGUE[pickL].short} games right now. Pick dates or weeks on its <button className="link" onClick={() => go(`league/${pickL}`)}>league page</button>.</Empty>}
          {nextDay && sbNext.data?.games?.length ? (
            <>
              <div className="sechead" style={{ marginTop: 22 }}><H2>{nextDay === todayKey ? 'Today' : `Next: ${dateOf(nextDay).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`}</H2></div>
              <Board games={gf.apply(sbNext.data.games)} pick="all" favSet={favSet} />
            </>
          ) : nextDay && sbNext.loading ? <Loading rows={2} /> : null}
        </>
      )}
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
  const base = useQuery(`board:${lg}`, () => getScoreboard(lg), boardRefresh);
  const [wk, setWk] = useSticky('wk', null); // 'type:week'
  const [yr, setYr] = useSticky('yr', null); // football season year; null = this season
  const [day, setDay] = useSticky('day', startDay || null); // 'YYYYMMDD'
  const [cal, setCal] = useState(false);
  const [month, setMonth] = useState(null); // first of the month shown in the calendar
  const gf = useGameFilter(lg);
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
  const games = gf.apply(q.data?.games || []);
  return (
    <>
      {weekMode ? (
        <>
          <div className="filters">
            <Picker label="Season" value={String(yr || thisYear)} onChange={(v) => { const y = Number(v); if (y === thisYear) { setYr(null); setWk(null); } else { setYr(y); setWk('2:1'); } }}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Picker>
            <Picker label="Week" value={wkKey || ''} onChange={setWk}>{weekList.map((w) => <option key={`${w.type}:${w.week}`} value={`${w.type}:${w.week}`}>{w.label}</option>)}</Picker>
            {gf.el}
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
            {gf.el ? <span style={{ marginLeft: 'auto', minWidth: 0, flex: '0 1 150px', display: 'flex' }}>{gf.el}</span> : null}
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
        games.length ? <Board games={games} pick="all" favSet={favSet} /> : <Empty>No {gf.on ? `${gf.label} ` : `${L.short} `}games {weekMode ? 'this week' : 'on this day'}.</Empty>}
      <Stamp at={q.updatedAt} live={games.some((g) => g.state === 'live')} />
    </>
  );
}

/* ---------- Leagues ---------- */
function Leagues() {
  const q = useDay(0);
  const count = (id) => (q.data?.games || []).filter((g) => g.lg === id).length;
  const prefs = useLeaguePrefs();
  return (
    <>
      <section className="sec">
        <H2>Leagues</H2>
        <div className="card">
          {orderLeagues(prefs).map((l) => { const n = count(l.id), season = q.data?.seasons?.[l.id]; return (
            <button key={l.id} className="lrow" onClick={() => go(`league/${l.id}`)}>
              <span className="blob" aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, background: l.color, color: '#0C1124', overflow: 'hidden', fontStretch: l.short.length > 4 ? '100%' : undefined, fontSize: l.short.length > 4 ? 9 : l.short.length > 3 ? 10 : 11 }}>{l.short}</span>
              <span className="nm">{l.name}<span className="sub">{n ? `${n} ${n === 1 ? 'game' : 'games'} today` : season || 'No games today'}</span></span>
              {/* Hidden on Scores: a tiny crossed-out eye. Tap it to show the league on Scores again. */}
              {isLeagueOn(l.id, prefs) ? null : (
                <span className="lhid" role="button" tabIndex={0} aria-label={`${l.name} is hidden on Scores. Show it`} title="Hidden on Scores. Tap to show"
                  onClick={(e) => { e.stopPropagation(); toggleLeague(l.id); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleLeague(l.id); } }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12 C5 7.5 8.3 5.5 12 5.5 S19 7.5 21.5 12 C19 16.5 15.7 18.5 12 18.5 S5 16.5 2.5 12 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M4 20 L20 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                </span>)}
              <span className="chev" aria-hidden="true">›</span>
            </button>); })}
        </div>
      </section>
      <div style={{ textAlign: 'center', marginTop: 18, display: 'flex', justifyContent: 'center', gap: 22 }}><button className="link" onClick={() => go('settings')}>Settings</button><button className="link" onClick={() => go('about')}>About Fumblerooski</button></div>
    </>
  );
}

// NBA Cup group play: six groups of five. Group winners and the best second-place team in each conference move on.
function CupGroups({ cup, lg, focus }) {
  return (
    <>
      <p className="cupnote">{cup.played < cup.total ? `Group play · ${cup.played} of ${cup.total} games played. ` : 'Group play is over. '}Group winners (seeded 1, 2, 3 in their conference) and the best second-place team in each (WC, wild card) reach the knockout round.</p>
      {cup.groups.map((gr) => (
        <div className="card cupcard" key={gr.name}>
          <div className="shead"><span className="nm">{gr.name}</span><span style={{ width: 44, textAlign: 'right' }}>REC</span><span style={{ width: 46, textAlign: 'right' }}>DIFF</span></div>
          {gr.rows.map((r, j) => (
            <button key={r.id} className={'srow' + (focus && r.id === String(focus) ? ' me' : '')} onClick={() => go(`team/${lg}/${r.id}`)}>
              <span className="pos">{j + 1}</span><Blob team={r.team} /><span className="nm">{r.team.name}{r.tag ? <span className={'stag ' + (r.tag === 'lead' ? 'div' : 'wc')} title={r.tag === 'lead' ? `Leads the group: the ${r.seed || ''} seed` : 'Wild card spot'}>{r.tag === 'lead' ? r.seed || '1' : 'WC'}</span> : null}</span>
              <span className="v">{r.w}-{r.l}</span><span className="v2">{r.pd > 0 ? '+' : ''}{r.pd}</span>
            </button>
          ))}
        </div>
      ))}
      <p className="cupnote">Ties go to head-to-head, then point differential, then points scored.</p>
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
  // NBA Cup groups: only looked up in Cup season (October to early January).
  const mo = new Date().getMonth();
  const cupQ = useQuery(lg === 'nba' && !yr && (mo >= 9 || (mo === 0 && new Date().getDate() <= 10)) ? 'nbacup' : null, () => getNbaCup(), () => 600000);
  // It shows from the first group night until about three weeks after the last one (the final is mid-December).
  const cup = cupQ.data && Date.now() < new Date(cupQ.data.last).getTime() + 25 * 864e5 ? cupQ.data : null;
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
      {confNames.length ? <Picker label="Conference" value={confNames.includes(conf) ? conf : 'all'} onChange={(v) => { setAll(true); setConf(v); }} shown={confNames.includes(conf) && shortConf(conf) !== conf ? shortConf(conf) : undefined}><option value="all">All {L.college || curView?.id === 'conference' && curView?.label === 'Conference' ? 'confs' : curView?.id === 'division' ? 'divisions' : 'teams'}</option>{confNames.map((n) => <option key={n} value={n}>{n}</option>)}</Picker> : null}
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
            const views = [...(st.data.views || [{ id: 'conference', label: 'Conference', groups: st.data.groups }]), ...(cup ? [{ id: 'cup', label: 'NBA Cup', groups: [] }] : [])];
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
            {view.id === 'cup' ? <CupGroups cup={cup} lg={lg} focus={focus} /> : null}
            {shown.map((gr, i) => (
              <div className={'card' + (gr.rows.some((r) => /^\d+-\d+-\d+/.test(r.overall || '')) ? ' rec3' : '')} key={view.id + gr.name + i}>
                <div className="shead"><span className="nm">{gr.name}</span><span className="vh" style={{ textAlign: 'right' }}>REC</span><span style={{ width: 52, textAlign: 'right' }}>{gr.col2Label}</span></div>
                {(gr.subs || [{ name: null, rows: gr.rows }]).map((sub) => (
                  <React.Fragment key={sub.name || 'all'}>
                    {sub.name ? <div className="subhead">{sub.name}</div> : null}
                    {sub.rows.map((r, j) => (
                      <button key={r.team.id} className={'srow' + (focus && r.team.id === String(focus) ? ' me' : '')} aria-current={focus && r.team.id === String(focus) ? 'true' : undefined} onClick={() => go(`team/${lg}/${r.team.id}${yr ? '/' + yr : ''}`)}>
                        <span className="pos">{j + 1}</span><Blob team={r.team} /><span className="nm">{r.team.name}{r.tag ? <span className={'stag ' + r.tag.kind} title={r.tag.title} aria-label={r.tag.title}>{r.tag.text}</span> : null}</span>
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
  const [pid, setPid] = useSticky(`poll:${lg}`, null); // the picked poll survives a trip to a team and back
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
// Short conference names for a closed picker.
const CONF_SHORT = [[/^mountain west/i, 'MW'], [/independent/i, 'Ind'], [/^conference usa/i, 'CUSA'], [/^mid-american/i, 'MAC'], [/^atlantic coast/i, 'ACC'], [/^southeastern/i, 'SEC'], [/^american athletic/i, 'American'], [/^missouri valley/i, 'MVC'], [/^west coast/i, 'WCC']];
const shortConf = (n) => (CONF_SHORT.find(([re]) => re.test(n)) || [null, n])[1];
// shown: a shorter text for the closed button (the list still reads in full), e.g. "MW" for Mountain West.
const Picker = ({ label, value, onChange, children, shown }) => (
  <label className={'pick' + (shown ? ' masked' : '')}>
    <span style={{ position: 'absolute', left: -9999 }}>{label}</span>
    {shown ? <span className="shown" aria-hidden="true">{shown}</span> : null}
    <select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </label>
);
const remember = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } } };
function Stats({ start }) {
  const prefs = useLeaguePrefs();
  const [lg, setLgRaw] = useSticky('lg', () => start || (LEAGUE[remember.get('fr.stats.lg', '')] ? remember.get('fr.stats.lg', '') : 'nfl'));
  const setLg = (v) => { setLgRaw(v); remember.set('fr.stats.lg', v); };
  const [view, setView] = useSticky('view', 'leaders');
  return (
    <>
      <div className="sechead" style={{ marginTop: 4 }}>
        <H2>Stats</H2>
        <Picker label="League" value={lg} onChange={setLg}>{orderLeagues(prefs).map((l) => <option key={l.id} value={l.id}>{l.short}</option>)}</Picker>
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
// College slates are huge: one dropdown narrows them to ranked teams, the power leagues, or a single conference.
function useGameFilter(lg) {
  const college = !!LEAGUE[lg]?.college;
  const div = DIVISIONS[lg]?.[0]?.id;
  const st = useQuery(college ? `standings:${lg}${div ? ':' + div : ''}` : null, () => getStandings(lg, div), () => 600000);
  const [fid, setFid] = useSticky('gf:' + lg, 'all');
  const opts = useMemo(() => {
    const groups = st.data?.groups || [];
    const ids = (gs) => new Set(gs.flatMap((g) => g.rows.map((r) => r.team.id)));
    const out = [{ id: 'top25', label: 'Top 25' }];
    const p = groups.filter((g) => isPower(lg, g.name)), rest = groups.filter((g) => !isPower(lg, g.name) && !/independ/i.test(g.name));
    if (p.length) out.push({ id: 'power', label: lg === 'cfb' ? 'Power 4' : 'Power conferences', ids: ids(p) });
    if (rest.length) out.push({ id: 'rest', label: lg === 'cfb' ? 'Group of 6' : 'Mid-majors', ids: ids(rest) });
    [...groups].sort((a, b) => a.name.localeCompare(b.name)).forEach((g) => out.push({ id: 'g:' + g.name, label: g.name, ids: ids([g]) }));
    return out;
  }, [lg, st.data]);
  if (!college) return { el: null, apply: (g) => g, on: false };
  const f = opts.find((x) => x.id === fid);
  const apply = (games) => (!f ? games : f.id === 'top25' ? games.filter((g) => g.home.rank || g.away.rank) : games.filter((g) => f.ids.has(g.home.id) || f.ids.has(g.away.id)));
  const el = (
    <Picker label="Games" value={f ? fid : 'all'} onChange={setFid} shown={f && f.id.startsWith('g:') ? shortConf(f.label) : undefined}>
      <option value="all">All games</option>
      {opts.slice(0, opts.findIndex((o) => o.id.startsWith('g:')) < 0 ? opts.length : opts.findIndex((o) => o.id.startsWith('g:'))).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      {opts.some((o) => o.id.startsWith('g:')) ? <optgroup label="Conferences">{opts.filter((o) => o.id.startsWith('g:')).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup> : null}
    </Picker>
  );
  return { el, apply, on: !!f, label: f?.label };
}
// A player's headline stat → the leader board it ranks on (the names differ for some hoops stats).
const BOARD_ALIAS = { avgPoints: 'pointsPerGame', avgRebounds: 'reboundsPerGame', avgAssists: 'assistsPerGame', fieldGoalPct: 'fieldGoalPercentage' };
// A tile's stat → its qualified board, if it has one (a QB's INT is picks thrown).
function qualKey(lg, key, items) {
  if (key === 'interceptions' && items.some((x) => /^passing/.test(x.key))) return qualifiedRule(lg, 'interceptionsThrown') ? 'interceptionsThrown' : null;
  const k = LEAGUE[lg]?.sport === 'basketball' ? BOARD_ALIAS[key] || key : key;
  return qualifiedRule(lg, k) ? k : null;
}
// A tile's stat → the full list it ranks on in a past season (qualified boards, or the plain full lists).
function pastBoard(lg, key, items) {
  const q = qualKey(lg, key, items);
  if (q) return q;
  const k = BOARD_ALIAS[key] || key;
  return canGoDeep(lg, k) ? k : null;
}
function boardFor(key, items, cats, lg) {
  if (qualKey(lg, key, items)) return qualKey(lg, key, items);
  const k = BOARD_ALIAS[key] || key;
  if (EXTRA_BOARDS[k] && canGoDeep(lg, k)) return k;
  // A quarterback's INT is picks thrown; the INT board is picks made.
  if (k === 'interceptions' && items.some((x) => /^passing/.test(x.key))) return null;
  return cats.some((c) => c.key === k) ? k : null;
}
// One stat's full leader board, opened from a player's rank tile, with that player lit up and in view.
function LeaderPage({ lg, cat, focus, season }) {
  const q = useQuery(`leaders:${lg}`, () => getLeaders(lg), () => 600000);
  if (q.loading && !q.data) return <Loading rows={8} />;
  if (q.error && !q.data) return <Problem error={q.error} retry={q.reload} />;
  // A past season: that year's full list for the stat (the title from this season's board when there is one).
  const now = q.data.cats.find((x) => x.key === cat);
  const feedCard = season ? (now || qualifiedRule(lg, cat) || canGoDeep(lg, cat) ? { key: cat, title: now?.title || qualifiedRule(lg, cat)?.title || EXTRA_BOARDS[cat] || cat, abbr: qualifiedRule(lg, cat)?.min || now?.abbr || '', rows: [] } : null) : now;
  const c = (feedCard && qualifiedRule(lg, cat) ? { ...feedCard, abbr: qualifiedRule(lg, cat).min } : feedCard) || (qualifiedRule(lg, cat) ? { key: cat, title: qualifiedRule(lg, cat).title, abbr: qualifiedRule(lg, cat).min, rows: [] } : EXTRA_BOARDS[cat] && canGoDeep(lg, cat) ? { key: cat, title: EXTRA_BOARDS[cat], abbr: '', rows: [] } : null);
  if (!c) return <Empty>No {LEAGUE[lg].short} leader board for that stat right now.</Empty>;
  return (
    <>
      <div className="sechead" style={{ marginTop: 4 }}><H2>{season ? `${seasonLabel(lg, season)} ` : ''}{LEAGUE[lg].short} Leaders</H2></div>
      <LeaderCard lg={lg} c={c} focus={focus} season={season} />
      <div style={{ textAlign: 'center', marginTop: 14 }}><button className="btn" onClick={() => go(`stats/${lg}`)}>All {LEAGUE[lg].short} leaders</button></div>
    </>
  );
}
// A season as people say it: football and baseball by year, winter sports by both years ("2018-19").
export const seasonLabel = (lg, y) => (LEAGUE[lg].sport === 'football' || LEAGUE[lg].sport === 'baseball' || lg === 'mls' || lg === 'wnba' ? String(y) : `${y - 1}-${String(y).slice(2)}`);
// How far back each league's full stat lists hold up (checked live); soccer's leaders feed has no past seasons.
const LEADER_FROM = { mlb: 2003, nba: 2003, nhl: 2003, nfl: 2003, cfb: 2004, ncaam: 2006, ncaaw: 2020, wnba: 2019 };
function Leaders({ lg }) {
  const [yr, setYr] = useSticky('lyr:' + lg, null);
  const base = useQuery(`leaders:${lg}`, () => getLeaders(lg), () => 600000);
  const past = useQuery(yr ? `leaders:${lg}:${yr}` : null, () => getLeaders(lg, yr), () => 0);
  const q = yr ? past : base;
  const filters = useLeaderFilters(lg);
  const [fid, setFid] = useSticky('filter:' + lg, 'all');
  // Pro hoops: +/- has no feed board, so it is built separately and slots in after blocks once it lands. This season only.
  const pmq = useQuery(hasLeaguePlusMinus(lg) && !yr ? `leaguepm:${lg}` : null, () => getLeaguePlusMinus(lg), () => 1800000);
  const cur = base.data?.current || null;
  const from = LEADER_FROM[lg];
  const yearPick = cur && from ? (
    <Picker label="Season" value={String(yr || cur)} onChange={(v) => setYr(Number(v) === cur ? null : Number(v))}>
      {Array.from({ length: Math.max(1, cur - from + 1) }, (_, i) => cur - i).map((y) => <option key={y} value={y}>{seasonLabel(lg, y)}</option>)}
    </Picker>
  ) : null;
  if (q.loading && !q.data) return <div style={{ marginTop: 12 }}>{yearPick ? <div className="sechead">{yearPick}<span /></div> : null}<Loading rows={6} /></div>;
  if (q.error && !q.data) return <div style={{ marginTop: 12 }}>{yearPick ? <div className="sechead">{yearPick}<span /></div> : null}<Problem error={q.error} retry={q.reload} /></div>;
  if (!q.data.cats.length) return <>{yearPick ? <div className="sechead" style={{ marginTop: 12 }}>{yearPick}<span /></div> : null}<Empty>No leaders listed for {LEAGUE[lg].name} {yr ? `in ${seasonLabel(lg, yr)}` : 'right now'}.</Empty></>;
  const f = filters.find((x) => x.id === fid);
  const pickFilter = (v) => setFid(v);
  let cats = q.data.cats;
  if (pmq.data) {
    const at = cats.findIndex((c) => c.key === 'blocksPerGame');
    const i = at < 0 ? Math.min(6, cats.length) : at + 1;
    cats = [...cats.slice(0, i), pmq.data, ...cats.slice(i)];
  }
  return (
    <>
      {filters.length || yearPick ? (
        <div className="sechead" style={{ marginTop: 12 }}>
          {yearPick || <span />}
          {filters.length ? (
            <Picker label="Filter leaders" value={fid} onChange={pickFilter}>
              <option value="all">{lg === 'cfb' ? 'All FBS' : LEAGUE[lg].college ? 'All Division I' : `All ${LEAGUE[lg].short}`}</option>
              {filters.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </Picker>
          ) : <span />}
        </div>
      ) : null}
      {cats.map((c) => <LeaderCard key={c.key + (yr || '')} lg={lg} c={c} f={f} season={yr} />)}
      <Stamp at={q.updatedAt} />
    </>
  );
}
// One stat's leaders. Top 10 comes with the page; filtering or asking for more pulls that stat's full board.
function LeaderCard({ lg, c, f, focus, season }) {
  // Opened for one player: start on the full board (25 deep), then grow to reach them.
  const [n, setN] = useState(focus ? 25 : 5);
  useEffect(() => { if (!focus) setN(5); }, [f?.id]);
  const deepOk = canGoDeep(lg, c.key);
  const wantDeep = deepOk && (!!f || n > 5);
  const deep = useQuery(wantDeep ? `deep:${lg}:${c.key}${season ? ':' + season : ''}` : null, () => getDeepLeader(lg, c.key, season), () => 600000);
  const base = wantDeep && deep.data?.length ? deep.data : c.rows;
  const list = f ? base.filter((r) => r.team && f.ids.has(r.team.id)) : base;
  const rows = list.slice(0, n);
  const place = places(list.map((r) => r.value));
  const loadingDeep = wantDeep && deep.loading && !deep.data;
  const total = !wantDeep && deepOk ? null : list.length; // unknown until the full board loads
  const at = focus ? list.findIndex((r) => r.player?.id === String(focus)) : -1;
  useEffect(() => { if (at >= n) setN(Math.ceil((at + 1) / 25) * 25); }, [at, n]);
  useEffect(() => {
    if (at < 0 || at >= n) return;
    const el = document.querySelector('.lead.me');
    if (el) el.scrollIntoView({ block: 'center' });
  }, [at, n >= at + 1]);
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="shead"><span className="nm">{c.title}</span>{c.abbr ? <span>{c.abbr}</span> : null}</div>
      {loadingDeep && f ? <div className="lead"><span className="nm" style={{ color: 'var(--mute)', fontWeight: 700 }}>Loading the full list...</span></div>
        : !rows.length ? <div className="lead"><span className="nm" style={{ color: 'var(--mute)', fontWeight: 700 }}>No one from {f?.label} {deepOk ? 'has this stat yet.' : 'in the top 10.'}</span></div> : null}
      {(loadingDeep && f ? [] : rows).map((r, i) => (
        <button key={i} className={'lead' + (/^T?1$/.test(place[i]) ? ' top' : '') + (focus && r.player?.id === String(focus) ? ' me' : '')} onClick={() => (r.player?.id ? go(`player/${lg}/${r.player.id}${season ? '/' + season : ''}`) : r.team ? go(`team/${lg}/${r.team.id}${season ? '/' + season : ''}`) : null)}>
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
        <span className="stamp" style={{ margin: 0 }}>Sorted by {cat.names[sort.col] || cat.labels[sort.col]}, {sort.dir < 0 ? 'most first' : 'fewest first'}</span>
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
function TeamPage({ lg, id, season }) {
  const [yr, setYr] = useSticky('yr', season || null); // null = this season
  const q = useQuery(`team:${lg}:${id}${yr ? ':' + yr : ''}`, () => getTeam(lg, id, yr), () => 300000);
  const cur = q.data?.currentSeason || null;
  const isPast = !!yr && yr !== cur;
  const yearLabel = (y) => seasonLabel(lg, y);
  const favs = useFavs();
  const t = q.data?.team;
  const pinned = t && favs.some((f) => favKey(f) === favKey(t));
  // Division-poll ranks (FCS, D-II, D-III) load after the schedule shows, then get laid onto it.
  const pr = useQuery(q.data?.pollInfo ? `schedranks:${lg}:${id}:${q.data.pollInfo.season}` : null, () => getSchedulePollRanks(lg, q.data.pollInfo), () => 1800000).data;
  const sched = useMemo(() => (q.data?.schedule || []).map((g) => {
    const rk = pr?.byGame?.[g.id];
    if (!rk) return g;
    const up = (sd) => (sd.rank && sd.rank <= 25) || !rk[String(sd.id)] ? sd : { ...sd, rank: rk[String(sd.id)] };
    return { ...g, away: up(g.away), home: up(g.home) };
  }), [q.data, pr]);
  // Long seasons (baseball, hoops, hockey) get split by month so the list is not one endless scroll.
  const monthKey = (g) => { const d = new Date(g.date); return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const months = sched.length > 30 ? [...new Set(sched.map(monthKey).filter(Boolean))] : [];
  const [mo, setMo] = useSticky('month', '');
  // Default: the month with a live or next game, else the last month played.
  const nowKey = monthKey(sched.find((g) => g.state === 'live' || g.state === 'pre') || sched[sched.length - 1] || {});
  const month = months.includes(mo) ? mo : months.includes(nowKey) ? nowKey : months[months.length - 1] || '';
  const shownSched = months.length ? sched.filter((g) => monthKey(g) === month) : sched;
  const monthName = (k) => new Date(Number(k.slice(0, 4)), Number(k.slice(5)) - 1, 1).toLocaleDateString([], { month: 'short' });
  const [viewRaw, setView] = useSticky('view', 'schedule');
  const full = isCovered(useCovered(lg), id);
  const view = full ? viewRaw : 'schedule';
  // Past rosters come from ESPN's season player lists, which are only right for colleges; pros keep today's roster (labeled).
  const pastRo = isPast && LEAGUE[lg].college;
  const ro = useQuery(view === 'roster' ? `roster:${lg}:${id}${pastRo ? ':' + yr : ''}` : null, () => getRoster(lg, id, pastRo ? yr : null), () => 0);
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
  // D-II and D-III teams: their conference instead of the poll's name (or ESPN's "12th in Div II/III").
  const ldiv = q.data?.lowerDiv;
  const smallDiv = lg === 'cfb' && (ldiv === 'd2' || ldiv === 'd3' || (ldiv === '?' && lower && lower.level !== 'fcs') || (lower && (lower.level === 'd2' || lower.level === 'd3')));
  const confName = useQuery(smallDiv ? `conf:${lg}:${id}` : null, () => getTeamConference(lg, id, ldiv === 'd2' || ldiv === 'd3' ? ldiv : lower?.level), () => 0).data || null;
  const mainPoll = lower ? lower.poll : polls[0];
  const topRank = mainPoll ? (mainPoll.ranks.find((x) => x.team.id === String(id))?.rank || null) : (q.data?.rank || pr?.own || null);
  // The schedule feed leaves the score blank while a game is on, so read that one game live.
  const liveId = sched.find((g) => g.state === 'live')?.id;
  const lq = useQuery(liveId ? `game:${lg}:${liveId}` : null, () => getGame(lg, liveId), () => 30000);
  const row = (g0) => {
    const lv = g0.id === liveId && lq.data?.game;
    const g = lv ? { ...g0, state: lv.state, statusText: lv.statusText, away: { ...g0.away, score: lv.away.score }, home: { ...g0.home, score: lv.home.score } } : g0;
    const home = g.home.id === String(id), me = home ? g.home : g.away, them = home ? g.away : g.home;
    // A finished game shows the opponent's record going into it: the feed's record already counts this game, so take it back out.
    const before = (rec, won) => { const m = /^(\d+)-(\d+)(.*)$/.exec(rec || ''); return m ? `${Number(m[1]) - (won ? 1 : 0)}-${Number(m[2]) - (won ? 0 : 1)}${m[3]}` : rec; };
    const decided = g.state === 'final' && them.record && me.score !== '' && them.score !== '' && Number(me.score) !== Number(them.score);
    const oppRec = decided ? before(them.record, Number(them.score) > Number(me.score)) : isPast ? them.record : recs[them.id] || them.record;
    const fin = g.state === 'final', w = +me.score > +them.score, tie = +me.score === +them.score;
    return (
      <button key={g.id} className="lrow" onClick={() => go(`game/${lg}/${g.id}`)}>
        <RankBlob team={them} rank={them.rank} />
        <span className="nm">{g.note ? <GameNote text={shortEvent(g.note)} /> : null}{home ? 'vs' : 'at'} {them.name}{oppRec ? <small className="orec"> {oppRec}</small> : null}<span className="sub">{fmtDate(g.date)}{isPast ? `, ${new Date(g.date).getFullYear()}` : ''}</span></span>
        <span className="res">{fin ? (<><b style={{ background: w ? 'var(--win-bg)' : 'var(--rule)', color: w ? 'var(--lime)' : 'var(--soft)' }}>{tie ? 'T' : w ? 'W' : 'L'}</b>{me.score}-{them.score}</>)
          : g.state === 'live' ? <span className="livesc"><b>{me.score !== '' && me.score != null ? `${me.score}-${them.score}` : 'LIVE'}</b><small>{g.statusText || 'Live'}</small></span>
            : g.state === 'off' ? <span style={{ color: 'var(--mute)' }}>{g.statusText || 'Postponed'}</span>
              : <span className="uptime"><span style={{ color: 'var(--teal)' }}>{g.tbd ? 'TBD' : fmtTime(g.date)}</span>{(() => { const n = g.tv?.national?.[0] || g.tv?.home?.[0] || g.tv?.away?.[0]; return n ? <small className="uptv">{shortTv(n)}</small> : null; })()}</span>}</span>
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
              {/* The rank rides on the logo as a gold tag, so the full name keeps its line to itself. */}
              <span className="hlogo"><Blob team={t} size={58} radius={16} />{!isPast && topRank ? <b className="hrk" aria-label={`Ranked ${topRank}`}>{topRank}</b> : null}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2>{t.full}</h2>
                <p>{[isPast ? `${yearLabel(yr)}: ${q.data.record || 'no games'}` : q.data.record, smallDiv ? '' : q.data.standing].filter(Boolean).join(' · ') || LEAGUE[lg].name}</p>
                {smallDiv ? (confName && !isPast ? <p className="hrank"><span>{confName}</span></p> : null)
                  : !isPast && (topRank || pollRanks.length) ? <p className="hrank">{lower ? <span>{lower.poll.name}</span> : pollRanks.length ? <span>{pollRanks.map((x) => `${x.name} ${x.r}`).join(' · ')}</span> : null}</p> : null}
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
                {months.length > 1 ? (
                  <div className="chips" role="group" aria-label="Month" style={{ marginBottom: 12 }}
                    ref={(el) => { const on = el?.querySelector('[aria-pressed="true"]'); if (on && (on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth || on.offsetLeft < el.scrollLeft)) el.scrollLeft = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2; }}>
                    {months.map((k) => <button key={k} className="chipb" aria-pressed={k === month} onClick={() => setMo(k)}>{monthName(k)}</button>)}
                  </div>
                ) : null}
                {sched.length ? <div className="card">{shownSched.map(row)}</div> : <Empty>{q.data.scheduleMissing ? 'The schedule did not load. Pull up the team again in a bit.' : 'No games on the schedule yet.'}</Empty>}
              </section>
            ) : ro.loading && !ro.data ? <div style={{ marginTop: 12 }}><Loading rows={6} /></div> : ro.error && !ro.data ? <div style={{ marginTop: 12 }}><Problem error={ro.error} retry={ro.reload} /></div>
              : !ro.data?.groups.length ? <Empty>No roster listed for this team right now.</Empty>
                : <>{isPast && !pastRo ? <p className="stamp" style={{ textAlign: 'left', margin: '12px 0 0' }}>Current roster. Past {LEAGUE[lg].short} rosters aren't available.</p> : null}{ro.data.groups.map((gr) => (
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
                ))}</>}
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
  // Hoops: plus-minus slots in as the fifth leader once it has loaded (it takes a few reads more than the rest).
  const pmq = useQuery(season && hasPlusMinus(lg) ? `teampm:${lg}:${id}:${season}` : null, () => getTeamPlusMinus(lg, id, season), () => 1800000);
  if (!season || (q.loading && !q.data)) return <div style={{ marginTop: 12 }}><Loading rows={5} /></div>;
  if (q.error && !q.data) return <div style={{ marginTop: 12 }}><Problem error={q.error} retry={q.reload} /></div>;
  const { groups } = q.data;
  const leaders = pmq.data ? [...q.data.leaders.slice(0, 4), pmq.data, ...q.data.leaders.slice(4)] : q.data.leaders;
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
                {i === 0 && c.rows.length > 1 ? (
                  // Everything right of the name opens the next two; the name side goes to the player.
                  <span className="ltog" role="button" aria-label={open[c.key] ? 'Show fewer' : 'Show the next two'} onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [c.key]: !open[c.key] }); }}>
                    <span className="v">{pct1(c.title, r.value)}</span>
                    <span className="lmore">{open[c.key] ? '▴' : '▾'}</span>
                  </span>
                ) : (
                  <span className="ltog plain"><span className="v">{pct1(c.title, r.value)}</span><span className="lmore" aria-hidden="true" /></span>
                )}
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
function PlayerPage({ lg, id, season: startYr = '' }) {
  const q = useQuery(`player:${lg}:${id}`, () => getPlayer(lg, id), () => 600000);
  const pmq = useQuery(hasPlusMinus(lg) ? `pm:${lg}:${id}` : null, () => getPlusMinus(lg, id), () => 600000);
  const pm = pmq.data;
  const [tab, setTab] = useSticky('tab', 'season');
  const d = q.data, p = d?.player;
  // The league's leader boards, so a "5th in FBS" tile can open the matching board.
  const lq = useQuery(d?.summary?.items?.some((x) => x.rank) ? `leaders:${lg}` : null, () => getLeaders(lg), () => 600000);
  const leaderCats = lq.data?.cats || [];
  // Averages rank on our own qualified board (ESPN's average ranks don't match any minimum). Not qualified: no rank.
  const qKeys = (d?.summary?.items || []).map((x) => qualKey(lg, x.key, d.summary.items)).filter(Boolean);
  const qb = useQuery(qKeys.length ? `qual:${lg}:${qKeys.join(',')}` : null, async () => Object.fromEntries(await Promise.all(qKeys.map(async (k) => [k, await getDeepLeader(lg, k)]))), () => 600000);
  const qRank = (key) => {
    const board = qb.data?.[key];
    if (!board) return null;
    const i = board.findIndex((r) => r.player?.id === String(id));
    if (i < 0) return null;
    const pl = places(board.map((r) => r.value))[i];
    if (Number(pl.replace(/^T/, '')) > 150) return '150+'; // like ESPN: past 150th it's just "150+"
    return pl.startsWith('T') ? 'T' + ordinal(Number(pl.slice(1))) : ordinal(Number(pl));
  };
  const color = p?.team?.color || '#2B3352';
  const career = d?.career || [];
  // One season picker drives both the Season and Game Log tabs. '' = the latest season.
  // Opened from a past season's leaders: start on that season.
  const [logYr, setLogYr] = useSticky('logyr', startYr);
  const careerYears = [...new Set(career.flatMap((c) => c.rows.map((r) => r.year)).filter(Boolean))].sort((a, b) => b - a);
  const years = d?.gamelog?.years?.length ? d.gamelog.years : careerYears.map((y) => ({ value: String(y), label: career.flatMap((c) => c.rows).find((r) => r.year === y)?.season || String(y) }));
  const latest = d?.gamelog?.year || years[0]?.value || '';
  const picked = logYr && logYr !== latest ? logYr : '';
  // The game log's bottom row is the feed's per-game averages, so plus-minus there is an average too.
  // Season tab: each stat group's row for the picked year (latest by default). Hoops adds plus-minus to this season's averages and totals.
  const season = career.map((c) => {
    const row = picked ? c.rows.find((r) => String(r.year) === picked) : c.rows[c.rows.length - 1];
    if (picked || !row || !pm || pm.total == null || (pm.year && row.year && row.year !== pm.year) || !/^(averages|totals)$/.test(c.key)) return { ...c, row };
    const gp = pm.n || Number(career.find((x) => x.key === 'averages')?.rows.at(-1)?.stats[0]) || Object.keys(pm.games).length;
    const v = c.key === 'totals' ? signed(pm.total) : gp ? signed(Math.round((pm.total / gp) * 10) / 10) : '';
    return { ...c, labels: [...c.labels, '+/-'], row: { ...row, stats: [...row.stats, v] } };
  }).filter((c) => c.row).filter((c, _, all) => {
    // Only one season's tables: a QB's one tackle from 2023 is not part of his 2026.
    const top = Math.max(...all.map((x) => x.row.year || 0));
    return !top || !c.row.year || c.row.year === top;
  }).filter((c, _, all) => {
    // A table of nothing but zeros (a tight end's empty passing line, its rating a formula's leftover) says nothing.
    // Games played and ratings don't count as doing something; keep it if it's the only table.
    const did = c.row.stats.some((v, i) => !/^(gp|gs|g|rtg|qbr|rating)$/i.test(String(c.labels[i] || '').trim()) && Number(String(v).replace(/,/g, '')) !== 0 && /\d/.test(String(v)));
    return did || all.length === 1;
  });
  // A past season's headline tiles: the same stats from that season's tables, ranked on that season's boards.
  const pastTiles = picked ? (d?.summary?.items || []).map((x) => {
    for (const c of season) { const i = (c.names || []).indexOf(x.key); if (i >= 0 && /\d/.test(String(c.row.stats[i] ?? ''))) return { ...x, value: c.row.stats[i], board: pastBoard(lg, x.key, d.summary.items) }; }
    return null;
  }).filter(Boolean) : [];
  const pastKeys = [...new Set(pastTiles.map((t) => t.board).filter(Boolean))];
  const pq = useQuery(pastKeys.length ? `pastranks:${lg}:${picked}:${pastKeys.join(',')}` : null,
    async () => Object.fromEntries(await Promise.all(pastKeys.map(async (k) => { try { return [k, await getDeepLeader(lg, k, Number(picked))]; } catch { return [k, null]; } }))), () => 0);
  const pastRank = (k) => {
    const board = k && pq.data?.[k];
    if (!board?.length) return null;
    const i = board.findIndex((r) => r.player?.id === String(id));
    if (i < 0) return !qualifiedRule(lg, k) && board.length >= 150 ? '150+' : null; // off the end of a counting list
    const pl = places(board.map((r) => r.value))[i];
    if (Number(pl.replace(/^T/, '')) > 150) return '150+';
    return pl.startsWith('T') ? 'T' + ordinal(Number(pl.slice(1))) : ordinal(Number(pl));
  };
  const lgq = useQuery(picked ? `gamelog:${lg}:${id}:${picked}` : null, () => getGamelog(lg, id, picked), () => 600000);
  const log0 = picked ? (lgq.data || { labels: [], spans: [], seasons: [] }) : d?.gamelog;
  const pmOn = !picked && pm && Object.keys(pm.games).length && log0?.labels.length;
  const log = !pmOn ? log0 : {
    labels: [...log0.labels, '+/-'],
    spans: log0.spans.length ? [...log0.spans, { title: '', count: 1 }] : [],
    seasons: log0.seasons.map((sn) => {
      const rows = sn.rows.map((r) => ({ ...r, stats: [...r.stats, pm.games[r.id] != null ? signed(pm.games[r.id]) : ''] }));
      const known = sn.rows.filter((r) => pm.games[r.id] != null);
      return { ...sn, rows, totals: sn.totals ? [...sn.totals, known.length ? signed(Math.round((known.reduce((n, r) => n + pm.games[r.id], 0) / known.length) * 10) / 10) : ''] : null };
    }),
  };
  const pmClass = (l, v) => (l === '+/-' ? (parseFloat(v) > 0 ? 'up' : parseFloat(v) < 0 ? 'down' : undefined) : undefined);
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
            {d.other ? (
              <div className="seg" role="group" aria-label="College or pro career" style={{ marginTop: 12 }}>
                {[['college', 'College'], ['pro', 'Pro']].map(([k, label]) => { const here = d.other.kind !== k; return (
                  <button key={k} aria-pressed={here} onClick={() => { if (!here) swap(`player/${d.other.lg}/${d.other.id}`); }}>{label}<small style={{ marginLeft: 6, opacity: 0.7 }}>{LEAGUE[here ? lg : d.other.lg].short}</small></button>); })}
              </div>
            ) : null}
            <div className="gtabs" role="tablist" aria-label="Player sections">
              {tabs.map(([k, label]) => <button key={k} role="tab" className="chipb" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
              {(tab === 'season' || tab === 'log') && years.length > 1 ? (
                <span className="tabyr"><Picker label="Season" value={picked || latest} onChange={(v) => setLogYr(v === latest ? '' : v)}>{years.map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}</Picker></span>
              ) : null}
            </div>

            {tab === 'season' ? (
              <>
                {!picked && d.summary.items.length ? <div className="tiles">{d.summary.items.map((x) => <div className="tile" key={x.label}><b>{pct1(x.label, x.value)}</b><span>{x.label}</span>{(qualKey(lg, x.key, d.summary.items) ? qRank(qualKey(lg, x.key, d.summary.items)) : x.rank) ? (() => {
                  const qr = qualKey(lg, x.key, d.summary.items) ? qRank(qualKey(lg, x.key, d.summary.items)) : null;
                  const txt = qr ? `${qr} in ${LEAGUE[lg].college && lg === 'cfb' ? 'FBS' : LEAGUE[lg].short}` : `${x.rank > 150 ? '150+' : `${x.tied ? 'T' : ''}${ordinal(x.rank)}`} in ${LEAGUE[lg].college && lg === 'cfb' ? 'FBS' : LEAGUE[lg].short}`;
                  const k = boardFor(x.key, d.summary.items, leaderCats, lg);
                  return k ? <button className={'trank tlink' + (txt.length >= 12 ? ' long' : '')} onClick={() => go(`leaders/${lg}/${k}/${id}`)} aria-label={`${txt}: see the ${x.label} leaders`}>{txt}</button> : <em className={'trank' + (txt.length >= 12 ? ' long' : '')}>{txt}</em>;
                })() : null}</div>)}</div> : null}
                {picked && pastTiles.length ? <div className="tiles">{pastTiles.map((x) => {
                  const r = pastRank(x.board);
                  const txt = r ? `${r} in ${LEAGUE[lg].college && lg === 'cfb' ? 'FBS' : LEAGUE[lg].short}` : '';
                  return (
                    <div className="tile" key={x.label}><b>{pct1(x.label, x.value)}</b><span>{x.label}</span>
                      {txt ? <button className={'trank tlink' + (txt.length >= 12 ? ' long' : '')} onClick={() => go(`leaders/${lg}/${x.board}/${id}/${picked}`)} aria-label={`${txt}: see the ${seasonLabel(lg, Number(picked))} ${x.label} leaders`}>{txt}</button> : null}
                    </div>);
                })}</div> : null}
                {season.map((c) => (
                  <div className="card pad" key={c.key + c.title} style={{ marginTop: 12 }}>
                    <div className="ptitle">{c.row.season} {c.title}</div>
                    <div className="kv">{c.labels.map((l, i) => <div key={i}><span>{l}</span><b>{pct1(l, c.row.stats[i] ?? '')}</b></div>)}</div>
                  </div>
                ))}
                {(picked || !d.summary.items.length) && !season.length ? <Empty>{d.missing.career ? 'Season stats did not load. Try again in a bit.' : 'No stats on record for this season.'}</Empty> : null}
              </>
            ) : null}


            {tab === 'log' && picked && lgq.loading && !lgq.data ? <Loading rows={4} /> : tab === 'log' ? (
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
                          {log.labels.map((l, j) => <td key={j} className={pmClass(l, r.stats[j])}>{pct1(l, r.stats[j] ?? '')}</td>)}
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
// Halves read 1H / 2H (men's college hoops, soccer); everything else Q1, P1, or the bare inning.
const perName = (L, n) => (L.periods === 2 || L.sport === 'soccer' ? `${n}H` : `${PERIOD_WORD[L.sport] ?? ''}${n}`);

// Score chart: both teams' scores climbing through the game. Chunky stepped lines with a purple drop shadow,
// like a late-80s broadcast graphic. Each line is the team's primary color with its secondary as the drop shadow.
function niceStep(max) { const raw = max / 3, pow = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))); const f = raw / pow; return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow); }
// Lead tracker: the margin as a line with its area shaded to a center line. Above it the away team leads, below it the home team does,
// in that team's color, so every lead change and how big each lead got reads at a glance.
function LeadChart({ chart, game, L }) {
  const W = 340, H = 196, x0 = 30, x1 = 332, y0 = 10, y1 = 160, mid = (y0 + y1) / 2;
  const pts = chart.points.map((p) => ({ t: p.t, m: p.a - p.h, a: p.a, h: p.h }));
  const most = Math.max(1, ...pts.map((p) => Math.abs(p.m)));
  // The scale fits the game's biggest lead snugly (a 5-goal hockey lead should look huge), with a floor per sport so a
  // one-goal game doesn't fill the chart either.
  const FLOOR = { hockey: 3, soccer: 3, baseball: 4, football: 14, basketball: 10 };
  const NICE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 20, 21, 25, 28, 30, 35, 40, 50, 60, 70, 80, 100];
  const top = NICE.find((n) => n >= Math.max(FLOOR[L.sport] || 4, most * 1.12)) || Math.ceil(most * 1.12);
  const step = top / 2;
  const x = (t) => x0 + t * (x1 - x0), y = (m) => mid - (m / top) * (mid - y0);
  const cc = chartColors(game.away, game.home);
  const reg = L.periods || chart.periods;
  const label = (i) => (i < reg ? perName(L, i + 1) : chart.periods - reg > 1 ? `OT${i - reg + 1}` : 'OT');
  const bigA = Math.max(0, ...pts.map((p) => p.m)), bigH = Math.max(0, ...pts.map((p) => -p.m));
  let changes = 0, prev = 0; for (const p of pts) { const sg = Math.sign(p.m); if (sg && prev && sg !== prev) changes++; if (sg) prev = sg; }
  const end = pts[pts.length - 1];
  // Share of the game so far each team spent ahead (ties count for nobody).
  let upA = 0, upH = 0; pts.slice(0, -1).forEach((p, i) => { const dt = pts[i + 1].t - p.t; if (p.m > 0) upA += dt; else if (p.m < 0) upH += dt; });
  const span = Math.max(1e-9, end.t - (pts[0]?.t || 0));
  // The note follows whoever leads right now; when it's tied, whoever has led longer.
  const lead = end.m > 0 ? [game.away, upA] : end.m < 0 ? [game.home, upH] : upA >= upH ? [game.away, upA] : [game.home, upH];
  const share = Math.round((lead[1] / span) * 100);
  const gl = [top, -top].concat(Number.isInteger(top / 2) ? [top / 2, -top / 2] : []);
  const stat = (t, c, n) => <span className="ls"><i style={{ background: c }} />{t.abbr} <b>{n ? `+${n}` : '—'}</b></span>;
  // Touch and drag across the chart to read the score and game clock at any moment.
  const [scrub, setScrub] = useState(null);
  const svgRef = useRef(null);
  const tAt = (e) => { const r = svgRef.current.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; return Math.max(pts[0].t, Math.min(end.t, (px - x0) / (x1 - x0))); };
  const at = scrub == null ? null : (() => {
    let p = pts[0]; for (const q of pts) { if (q.t <= scrub + 1e-9) p = q; else break; }
    const i = Math.max(0, chart.bounds.findIndex((b) => scrub <= b + 1e-9));
    const a = i ? chart.bounds[i - 1] : 0, b = chart.bounds[i] ?? 1;
    const len = i < reg ? L.periodLen : (L.sport === 'hockey' ? 5 : L.sport === 'football' ? 10 : L.sport === 'basketball' ? 5 : L.periodLen);
    let clock = '';
    // Same clock style as the Plays list: hockey counts up from 0:00, everyone else counts down.
    if (chart.stepped && len) { const f = (scrub - a) / Math.max(1e-9, b - a), v = Math.max(0, len * (L.sport === 'hockey' ? f : 1 - f)); clock = `${Math.floor(v)}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`; }
    return { p, per: label(i), clock };
  })();
  return (
    <section className="sec">
      <H2>Lead Tracker</H2>
      <div className="card pad chart">
        <div className="leadstats">
          <span className="lscap">Biggest lead</span>
          {stat(game.away, cc.away.main, bigA)}
          {stat(game.home, cc.home.main, bigH)}
        </div>
        {at ? (
          <p className="leadnote scrubbing"><b>{[at.per, at.clock].filter(Boolean).join(' · ')}</b><span style={{ color: cc.away.main }}>{game.away.abbr} {at.p.a}</span><span style={{ color: cc.home.main }}>{game.home.abbr} {at.p.h}</span></p>
        ) : <p className="leadnote">{share > 0 ? `${lead[0].abbr} ${game.state === 'final' ? 'led' : 'has led'} for ${share}% of the game · ` : ''}{changes} lead {changes === 1 ? 'change' : 'changes'}</p>}
        <div role="img" aria-label={`Lead over time. Biggest leads: ${game.away.abbr} ${bigA}, ${game.home.abbr} ${bigH}. ${changes} lead changes.`}>
          <svg ref={svgRef} className="flow scrub" viewBox={`0 0 ${W} ${H}`} aria-hidden="true"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); setScrub(tAt(e)); }}
            onPointerMove={(e) => setScrub(tAt(e))}
            onPointerUp={(e) => { if (e.pointerType !== 'mouse') setScrub(null); }} onPointerCancel={() => setScrub(null)} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setScrub(null); }}>
            {gl.map((v) => <g key={v}><path d={`M${x0} ${y(v)} H${x1}`} style={{ stroke: 'var(--rule)' }} strokeWidth="1" /><text x={x0 - 6} y={y(v) + 3.5} textAnchor="end" className="ax">+{Math.abs(v)}</text></g>)}
            {chart.bounds.slice(0, -1).map((b, i) => <path key={i} d={`M${x(b)} ${y0} V${y1}`} style={{ stroke: 'var(--line3)' }} strokeDasharray="2 4" />)}
            <text x={x0 + 4} y={y0 + 9} textAnchor="start" className="per halo" style={{ fill: cc.away.main }}>{game.away.abbr}</text>
            <text x={x0 + 4} y={y1 - 3} textAnchor="start" className="per halo" style={{ fill: cc.home.main }}>{game.home.abbr}</text>
            {(() => {
              // The margin as one stepped line (it only moves when someone scores), shaded back to the center line.
              // Above the line it's the away team's color, below it the home team's, so it changes color as the lead flips.
              const line = pts.map((p, i) => (i ? `H${x(p.t).toFixed(1)} V${y(p.m).toFixed(1)}` : `M${x(p.t).toFixed(1)} ${y(p.m).toFixed(1)}`)).join(' ');
              const area = `${line} V${mid} H${x(pts[0].t).toFixed(1)} Z`;
              const id = `lead${game.id}`;
              return (
                <>
                  <defs>
                    <clipPath id={id + 'a'}><rect x={x0} y={0} width={x1 - x0 + 6} height={mid} /></clipPath>
                    <clipPath id={id + 'h'}><rect x={x0} y={mid} width={x1 - x0 + 6} height={H} /></clipPath>
                  </defs>
                  {[['a', cc.away.main], ['h', cc.home.main]].map(([k, c]) => (
                    <g key={k} clipPath={`url(#${id + k})`}>
                      <path d={area} fill={c} fillOpacity="0.28" />
                      <path d={line} fill="none" stroke={c} strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" />
                    </g>
                  ))}
                </>
              );
            })()}
            <path d={`M${x0} ${mid} H${x1}`} style={{ stroke: 'var(--soft)' }} strokeWidth="1.5" />
            <text x={x0 - 6} y={mid + 3.5} textAnchor="end" className="ax">0</text>
            {at ? <g pointerEvents="none"><path d={`M${x(scrub)} ${y0} V${y1}`} style={{ stroke: 'var(--ink)' }} strokeWidth="1.5" strokeDasharray="3 3" /><circle cx={x(scrub)} cy={y(at.p.a - at.p.h)} r="5" fill={at.p.a > at.p.h ? cc.away.main : at.p.a < at.p.h ? cc.home.main : '#F5F5F7'} stroke="#0C1124" strokeWidth="2" /></g> : null}
            <circle cx={x(end.t)} cy={y(end.m)} r="4.5" fill={end.m > 0 ? cc.away.main : end.m < 0 ? cc.home.main : '#F5F5F7'} stroke="#0C1124" strokeWidth="2" />
            {chart.bounds.map((b, i) => { const a = i ? chart.bounds[i - 1] : 0; return <text key={'p' + i} x={x((a + b) / 2)} y={H - 16} textAnchor="middle" className="per">{label(i)}</text>; })}
            <path d={`M${x0} ${H - 7} H${x1}`} stroke="#22D3D6" strokeWidth="2" /><path d={`M${x0} ${H - 4} H${x1}`} stroke="#F5F5F7" strokeWidth="2" /><path d={`M${x0} ${H - 1} H${x1}`} stroke="#8B5CF6" strokeWidth="2" />
          </svg>
        </div>
      </div>
    </section>
  );
}

// Halftime and intermissions: a countdown to when play should be back (break start by the feed's wall clock plus the
// league's usual break). TV can stretch it, so past zero it just says play is starting soon.
function BreakClock({ lg, game, lastWall }) {
  const b = breakClock(lg, game, lastWall);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!b) return undefined; const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, [!!b]);
  if (!b) return null;
  const left = Math.round((b.until - now) / 1000);
  if (left > 45 * 60) return null; // a stale feed, not a real break
  const mm = Math.floor(Math.max(0, left) / 60), ss = String(Math.max(0, left) % 60).padStart(2, '0');
  return (
    <section className="sec">
      <div className="card breakclock" role="timer" aria-live="off">
        <span className="bk-cap">{b.name}</span>
        <span className="bk-sub">{left > 0 ? <>{b.next} in <b className="bk-t num">{mm}:{ss}</b></> : `${b.next} starting soon`}</span>
      </div>
    </section>
  );
}

/* ---------- football: drives ---------- */
// Touchdowns and field goals read differently at a glance:
// a touchdown is a solid gold bar that runs into a lit-up end zone; a field goal is a lime bar that stops at the
// spot of the kick, with a dotted kick sailing through the uprights.
const DRIVE_COLOR = { td: '#FFBE2E', fg: '#9BE33A', turnover: '#FF3D7F', defTd: '#FF3D7F', other: '#22D3D6' };
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
      {d.kind === 'defTd' ? ( // the other side ran it back the other way into this team's own end zone
        <>
          <rect x={dir === 1 ? 0 : W - ez} y="2" width={ez} height={H - 4} fill="none" stroke="#FFBE2E" strokeWidth="3" />
          <path d={`M${tip} ${mid} H${(dir === 1 ? ez : W - ez) + dir * 10}`} stroke="#FFBE2E" strokeWidth="3" strokeDasharray="4 4" strokeLinecap="round" />
          <path d={`M${(dir === 1 ? ez : W - ez) - dir * 0} ${mid} L${(dir === 1 ? ez : W - ez) + dir * 10} ${mid - 7} V${mid + 7} Z`} fill="#FFBE2E" stroke="#0C1124" strokeWidth="1" />
        </>
      ) : null}
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
/* ---------- football, live: the current drive marching down a bright cartoon field ---------- */
export function fbHead(p) {
  const t = `${p.type} ${p.text}`, y = p.yards, yd = y != null ? `${Math.abs(y)}-yd ` : '';
  if (CALLED_BACK.test(p.text) && !/touchdown/i.test(p.type)) return /safety/i.test(p.text) ? 'Safety Called Back' : 'TD Called Back';
  if (/touchdown/i.test(p.type) || /\btouchdown\b/i.test(p.text) && !/extra point|two-point/i.test(p.type)) return 'Touchdown!';
  if (/field goal/i.test(p.type)) return /good|made/i.test(t) && !/no good|missed/i.test(t) ? 'Field Goal Good' : 'Field Goal Missed';
  if (/extra point/i.test(p.type)) return /good/i.test(p.type) ? 'Extra Point Good' : 'Extra Point Missed';
  if (/penalty/i.test(p.type)) return 'Penalty';
  if (/sack/i.test(p.type)) {
    if (p.kept === false && /fumble/i.test(p.text) && /recovered by/i.test(p.text)) return 'Strip Sack, Fumble Lost';
    const loss = Number((/loss of (\d+) y/i.exec(p.text) || [])[1]) || (y ? Math.abs(y) : 0);
    return `Sack${loss ? `, ${loss} yds` : ''}`;
  }
  if (/intercept/i.test(p.type)) return 'Interception';
  if (/fumble|muff/i.test(p.type) && /\bpunts?\b/i.test(p.text)) return 'Muffed Punt';
  if (/fumble/i.test(p.type)) return 'Fumble';
  if (/incompl/i.test(p.type)) return 'Incomplete';
  if (/pass|reception/i.test(p.type)) return y != null && y < 0 ? `Pass, loss of ${-y}` : `${yd}Pass`;
  if (/rush/i.test(p.type)) return y != null && y < 0 ? `Run, loss of ${-y}` : `${yd}Run`;
  if (/punt/i.test(p.type)) return 'Punt';
  if (/kickoff/i.test(p.type)) return 'Kickoff';
  if (/timeout/i.test(p.type)) return 'Timeout';
  if (/end (of )?(period|quarter|half|game)/i.test(p.type)) return p.type;
  return p.type || 'Play';
}
function LiveField({ drives, game, lg, onAll }) {
  // Right after a kick the feed can open the new drive with no plays yet (and a junk "1st & Goal at the 0"). Until its first
  // snap, stay on the drive that holds the kick, still live, so the field shows the handoff instead.
  const live0 = drives.find((x) => x.live);
  const empty = !!live0 && !live0.plays.length;
  const before = empty ? [...drives].reverse().find((x) => x !== live0 && x.plays.length) : null;
  const d = (empty && before ? { ...before, live: true } : live0) || drives[drives.length - 1];
  const last = d ? d.plays[d.plays.length - 1] : null;
  const lastKey = d ? `${d.id}:${d.plays.length}` : '';
  // The banner calls out a score, a turnover or a kick for a few seconds, then settles back to who has the ball.
  const [flash, setFlash] = useState(true);
  useEffect(() => { setFlash(true); const h = setTimeout(() => setFlash(false), 7000); return () => clearTimeout(h); }, [lastKey]);
  if (!d) return null;
  // Halftime: the drive is over and nobody has the ball. Clear the field and close out the last drive.
  const half = /halftime/i.test(String(game.statusText || ''));
  const t = d.side === 'away' ? game.away : game.home;
  const opp = d.side === 'away' ? game.home : game.away;
  const cc = chartColors(game.away, game.home, true);
  // Field units: yards. Goal lines at 10 and 110, end zones outside. Away drives left to right, home right to left.
  const K = 3, FW = 120 * K, FH = 132, top = 14;
  const Xs = (side, toEnd) => (10 + (side === 'away' ? 100 - toEnd : toEnd)) * K;
  const X = (toEnd) => Xs(d.side, toEnd);
  const other = d.side === 'away' ? 'home' : 'away';
  // Stoppages (timeouts, the two-minute warning, end of a quarter) aren't snaps: the feed's spots on them can be anything.
  const steps = d.plays.filter((p) => p.from != null && p.to != null && p.kept && !/kickoff|punt|extra point|field goal|timeout|two-minute|two minute|end of|end quarter|end half/i.test(p.type));
  const puntBack0 = !!last && /\bpunts?\b/i.test(last.text) && last.kept && last.mine && last.to != null;
  // A muffed punt the kicking team recovers is a new drive: it starts at the recovery spot, with nothing drawn back to the old one.
  const start = puntBack0 ? last.to : steps[0]?.from ?? d.startToEnd ?? last?.from ?? null; // a one-play drive (say, a pick on the first snap) starts where that play did
  const lastKept = [...steps].reverse()[0];
  // A punt the kicking team got back (a muff) moves the ball to where they recovered it.
  const puntBack = !!last && /\bpunts?\b/i.test(last.text) && last.kept && last.mine && last.to != null;
  // A defensive or return touchdown (pick six, scoop and score) ends in the drive team's own end zone.
  const defTd = !!last && /touchdown|\bfor a td\b/i.test(`${last.type} ${last.text}`) && !last.kept && !CALLED_BACK.test(last.text);
  // The return on a pick six or scoop and score: from where the defense got the ball back to the offense's own goal line.
  // A turnover the defense ran back without scoring: they took it from the spot of the turnover to where the play ended.
  const m0 = fieldMoment(last);
  const tRet = !defTd && m0.kind === 'turnover' && last && last.endRaw != null ? Math.max(0, Math.min(100, 100 - last.endRaw)) : null;
  const retEnd = defTd ? 100 : tRet;
  const retYds = (defTd || tRet != null) && /return(?:ed)? for no gain|no return/i.test(last.text) ? 0 : defTd || tRet != null ? (Number((/return(?:ed)?\s+(?:for\s+)?(\d+)\s+y/i.exec(last.text) || /for (\d+) yards, touchdown/i.exec(last.text) || /for (\d+) y(?:ar)?ds?\b[^.]*\btouchdown/i.exec(last.text) || /(\d+) yd (?:interception|fumble)/i.exec(last.text) || [])[1]) || (last.yards > 0 ? last.yards : null)) : null;
  // A pick with no return yardage in the words ("J.Holland to NYG 2 for no gain") was not run back: it ends where it was caught.
  const retGot = retYds ?? (tRet != null ? 0 : null);
  const retFrom = retGot != null && retEnd != null ? Math.max(0, Math.min(100, retEnd - retGot)) : null;
  // On a pick the offense's line stops at the line of scrimmage; the ball turns over where it was caught.
  const picked = tRet != null && /intercept/i.test(`${last.type} ${last.text}`);
  const at = defTd ? (last.from ?? 100) : tRet != null && retFrom != null ? (picked && last.from != null ? last.from : retFrom) : d.kind === 'td' ? 0 : puntBack ? last.to : lastKept ? lastKept.to : start;
  const noRet = tRet != null && retFrom != null && Math.abs(retFrom - tRet) < 0.5; // picked off and downed right there
  const ballAt = tRet != null && retFrom != null ? retFrom : at;
  const going = !half && d.live && last?.kept && last.nextDown > 0 && !(m0.kind === 'punt' && m0.blocked && last.mine);
  const fd = going && last.nextDist != null ? Math.max(0, at - last.nextDist) : null;
  const dirn = d.side === 'away' ? 1 : -1;
  const ord = (n) => ['', '1st', '2nd', '3rd', '4th'][n] || '';
  const recent = [...d.plays].reverse().slice(0, 3);
  const mid = top + (FH - top) / 2;
  const ly = mid + 24; // the drive runs along a lane below midfield, clear of the home team's mark
  const m = fieldMoment(last);
  // Points on the newest play: the score now against the play before it, across the whole game.
  const all = drives.flatMap((x) => x.plays);
  const prev = all[all.length - 2];
  const gain = last && prev && Number.isFinite(last.away) && Number.isFinite(prev.away) ? { away: last.away - prev.away, home: last.home - prev.home } : null;
  const scorer = gain && gain.away > 0 ? 'away' : gain && gain.home > 0 ? 'home' : null;
  const pts = scorer ? gain[scorer] : 0;
  const scoreT = scorer ? game[scorer] : t;
  // A defensive two: the try (PAT or two-point) got blocked or picked and the defense ran it all the way back for 2.
  const defTwo = !!last && /defensive (pat|2pt|two)|return for (a )?defensive (pat|2)/i.test(`${last.type} ${last.text}`);
  const twoBy = defTwo ? (scorer || other) : null; // the side that scored the 2
  const call = !last ? null
    : defTwo ? { text: `${game[twoBy].abbr} +2 · Defensive 2-Pt`, team: game[twoBy], hot: true }
    : m.nulled ? { text: `Flag · ${/safety/i.test(last.text) ? 'Safety' : 'TD'} Called Back`, bad: true }
    : m.kind === 'td' ? { text: `${scoreT.abbr} ${pts ? `+${pts} · ` : ''}${m.how || 'Touchdown'}`, team: scoreT, hot: true }
      : m.kind === 'fg' && m.good ? { text: `${t.abbr} +3 · Field Goal`, team: t, hot: true }
        : m.kind === 'fg' ? { text: m.miss === 'blocked' ? 'Field Goal Blocked' : `No Good${m.label ? ` · ${m.label}` : ''}`, team: t, bad: true }
          : m.kind === 'safety' ? { text: `${scoreT.abbr} +2 · Safety`, team: scoreT, hot: true }
            : m.kind === 'turnover' ? { text: `Turnover · ${m.how}`, team: opp, bad: true }
              : m.kind === 'big' ? { text: `${t.abbr} · ${m.yards}-Yard Gain`, team: t }
                : m.kind === 'punt' && m.recovered ? { text: `Turnover · Muffed Punt`, team: t, bad: true }
                : m.kind === 'punt' ? { text: m.blocked ? 'Punt Blocked' : `Punt${m.yards ? ` · ${m.yards} Yards` : ''}`, team: last.mine ? t : opp }
                  : m.kind === 'kickoff' ? { text: m.touchback ? 'Kickoff · Touchback' : 'Kickoff', team: last.mine ? t : opp } : null;
  // After a punt the other side fields, the kick plays out, then possession changes over: the punting drive is done, and the
  // receiving team has the ball where the play ended (before the feed opens their drive). Spots here are in the kicking team's terms.
  // A kickoff (after a score) belongs to the scoring team's finished drive: show only the kick, not that drive again.
  const kickMine = !!last && m.kind === 'kickoff' && last.mine && !last.kept;
  // A kick this drive's team received: the ball (and the line to gain) show up once the kick has landed and been run back.
  const kickIn = !!last && flash && (m.kind === 'kickoff' || m.kind === 'punt') && !last.mine && !m.recovered ? (m.touchback || m.fairCatch ? 1.4 : 2.3) : 0;
  const handoff = !half && d.live && !flash && !!last && last.mine && !last.kept && (m.kind === 'punt' || m.kind === 'kickoff') && !m.recovered;
  const hSpot = !handoff ? null : m.kind === 'kickoff' && m.touchback ? 100 - touchbackSpot(lg, game.season, 'kickoff') : m.touchback ? 20 : m.blocked ? last.from - (Number.isFinite(last.yards) ? last.yards : 0) : last.endRaw != null ? 100 - last.endRaw : last.from - (m.yards || 0);
  const hText = hSpot == null ? '' : Math.round(hSpot) === 50 ? '50' : hSpot < 50 ? `${opp.abbr} ${Math.round(hSpot)}` : `${t.abbr} ${Math.round(100 - hSpot)}`;
  const banner = half ? { text: 'Halftime' } : handoff ? { text: `${opp.abbr} Ball`, team: opp } : flash && call ? call : going ? { text: `${t.abbr} Ball`, team: t } : call || { text: d.live ? `${t.abbr} Ball` : d.result || `${t.abbr} Drive`, team: t };

  // Goalposts stand up off each end line in a three-quarter view: stem, crossbar, far upright (drawn early) and near upright (drawn last, so a kick passes between them).
  // Goalposts drawn flat, as seen from above: the crossbar runs along the end line, the uprights point out past it.
  const post = (s) => { // s: 1 = right end, -1 = left end
    const x = s > 0 ? FW : 0, hw = 10, U = 15;
    return { s, x, hw, U, N: [x, mid + hw], F: [x, mid - hw], gap: [x + s * 8, mid] };
  };
  const posts = [post(-1), post(1)];
  const GOLD = '#FFBE2E', INK = '#0C1124';
  const bar = (d2, w) => <><path d={d2} fill="none" stroke={INK} strokeWidth={w + 2.2} strokeLinecap="round" strokeLinejoin="round" /><path d={d2} fill="none" stroke={GOLD} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" /></>;
  const ball = (r = 8) => <><ellipse rx={r} ry={r * 0.62} fill="#9A5A2B" stroke={INK} strokeWidth="1.5" /><path d={`M${-r * 0.42} 0 H${r * 0.42} M${-r * 0.22} ${-r * 0.22} V${r * 0.22} M0 ${-r * 0.22} V${r * 0.22} M${r * 0.22} ${-r * 0.22} V${r * 0.22}`} stroke="#fff" strokeWidth="1" strokeLinecap="round" /></>;
  // A ball flying an arc: x runs straight, y rises to a peak and drops. after: an optional bounce.
  const flight = (key, x0, y0, x1, y1, peak, opts = {}) => (
    <g key={key} className={'kfly' + (opts.fade ? ' fade' : '')}>
      <path className="karc" d={`M${x0} ${y0} Q${(x0 + x1) / 2} ${2 * peak - (y0 + y1) / 2} ${x1} ${y1}`} fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="1.5 4" strokeLinecap="round" style={{ '--from': x1 < x0 ? '0 0 0 100%' : '0 100% 0 0' }} />
      <g className={opts.bounce ? 'kbounce' : undefined} style={opts.bounce ? { '--bx': `${opts.bounce[0]}px`, '--by': `${opts.bounce[1]}px` } : undefined}>
        <g className="kx" style={{ '--x0': `${x0}px`, '--x1': `${x1}px` }}><g className="ky" style={{ '--y0': `${y0}px`, '--yt': `${peak}px`, '--y1': `${y1}px` }}>{ball(opts.r || 7)}</g></g>
      </g>
    </g>);

  let show = null, glowSide = null, turned = false;
  if (last && m.kind === 'fg') {
    // The kick flies at the posts it is aimed at. A make splits the uprights; a miss goes where the feed says it went.
    const P = posts[dirn > 0 ? 1 : 0], s = P.s;
    const x0 = X(Math.min(99, (last.from ?? at ?? 20) + 7));
    // Going right, the kicker's left is the top upright; going left, it is the bottom one.
    const yOf = (side) => ((side === 'left') === (s > 0) ? mid - P.hw : mid + P.hw);
    const away = (y) => (y < mid ? -1 : 1);
    let end = P.gap, opts = {}, peak = mid - 40; // a make rests between the uprights until the next play
    const drop = { bounce: [s * 4, 0] };
    if (m.miss === 'left' || m.miss === 'right') { const y = yOf(m.miss); end = [P.x + s * 8, y + away(y) * 9]; opts = drop; }
    else if (m.miss === 'wide') { end = [P.x + s * 8, mid + P.hw + 9]; opts = drop; }
    else if (m.miss === 'leftpost' || m.miss === 'rightpost') { const y = yOf(m.miss.replace('post', '')); end = [P.x + s * 7, y]; opts = { bounce: [-s * 28, away(y) * 10] }; }
    else if (m.miss === 'short') { end = [P.x - s * 26, mid + 2]; peak = ly - 26; opts = {}; }
    else if (m.miss === 'blocked') { end = [x0 + s * 16, ly - 4]; peak = ly - 20; opts = { bounce: [-s * 10, 6] }; }
    show = <g key={'fg' + lastKey}>{flight('k', x0, ly, end[0], end[1], peak, opts)}</g>; // stays drawn until the next play
  } else if (last && (m.kind === 'punt' || m.kind === 'kickoff') && last.from != null && (m.yards || m.touchback || m.blocked)) {
    // Punts and kickoffs: a high arc to where the ball came down, then the return as a line back.
    // A blocked punt pops off the block and skitters to where it ended up, forward or back.
    const side = last.mine ? d.side : other, sgn = side === 'away' ? 1 : -1;
    const bYds = m.blocked ? (Number.isFinite(last.yards) ? last.yards : last.endRaw != null ? last.from - last.endRaw : 0) : 0;
    const land = m.blocked ? last.from - bYds : m.touchback && !m.yards ? -4 : last.from - (m.yards || 0);
    const x0 = Xs(side, last.from), x1 = Xs(side, Math.max(-6, land));
    // The feed counts the end spot from whoever has the ball after the play: the kicking team on a muff they recover.
    const endIsKicker = last.mine ? last.kept : !last.kept;
    const fin = !m.touchback && !m.blocked && last.endRaw != null ? (endIsKicker ? last.endRaw : 100 - last.endRaw) : null;
    const ret = fin != null && Math.abs(fin - land) >= 3 && Math.abs(fin - land) < 100 ? Xs(side, Math.max(0, Math.min(100, fin))) : null;
    show = (
      <g key={'kick' + lastKey} className="fshow">
        {m.blocked
          ? <>{flight('k', x0, ly, x1, ly, ly - Math.min(26, 10 + Math.abs(x1 - x0) * 0.12), { bounce: [(x1 >= x0 ? 1 : -1) * 6, 0] })}<text className="ktag" x={x0} y={ly - 14} textAnchor="middle">BLOCK</text></>
          : flight('k', x0, ly, x1, ly, ly - Math.min(58, 18 + Math.abs(x1 - x0) * 0.22), {})}
        {ret != null ? [['#fff', 5.5], [cc[side === 'away' ? 'home' : 'away'].main, 3]].map(([c, w]) => <path key={w} className="kret" d={`M${x1} ${ly} H${ret}`} stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" style={{ '--from': ret < x1 ? '0 0 0 100%' : '0 100% 0 0' }} />) : null}
        {m.touchback ? <text className="ktag" x={x1 + sgn * 2} y={ly - 12} textAnchor="middle">TB</text> : null}
      </g>);
  } else if (last && m.kind === 'big' && last.from != null && last.to != null) {
    // A big gain: the ball leaves the mascot's three speed lines behind it.
    const a = X(last.from), b = X(last.to);
    show = <g key={'big' + lastKey} className="fshow quick">{[['#2ED9D9', -6], ['#FFFFFF', 0], ['#8B5CF6', 6]].map(([c, dy], i) => <path key={i} className="kstreak" d={`M${a} ${ly + dy - 22} H${b - dirn * 12}`} stroke={c} strokeWidth="3" strokeLinecap="round" fill="none" style={{ '--from': b < a ? '0 0 0 100%' : '0 100% 0 0', animationDelay: `${i * 0.08}s` }} />)}</g>;
  }
  // Stamps: touchdown, turnover, safety. They slam in, sit a few seconds, and clear.
  let stamp = null;
  if (last && defTwo) { stamp = { text: 'DEFENSIVE 2!', color: GOLD, x: 60 * K, cdelay: 1.1 }; glowSide = (twoBy === 'away' ? 110 : 0) * K; } // lights the end zone, like a good two-point try
  else if (last && m.nulled) stamp = null; // a called-back score gets the flag banner only: no stamp, no confetti
  else if (last && m.kind === 'td') {
    const zone = (scorer || d.side) === 'away' ? 110 * K : 0;
    stamp = { text: m.how === 'Pick Six' ? 'PICK SIX!' : m.how === 'Scoop & Score' ? 'SCOOP & SCORE!' : 'TOUCHDOWN!', color: GOLD, x: 60 * K, confetti: [zone + 5 * K, cc[scorer || d.side].main], cdelay: defTd ? 1.15 : 0.9 }; // bursts once the line (or the return) reaches the end zone
    if (defTd) turned = true; // the ball changed hands on the way to the end zone
    if (m.two === 'good') glowSide = zone; // a two-point try that works lights the end zone
  } else if (last && m.kind === 'turnover') { stamp = { text: 'TURNOVER', color: brighten(cc[other].main, 0.25), x: 60 * K }; turned = true; }
  else if (last && m.kind === 'safety') stamp = { text: 'SAFETY', color: GOLD, x: 60 * K };
  else if (last && m.kind === 'punt' && m.recovered) stamp = { text: 'TURNOVER', color: brighten(cc[d.side].main, 0.25), x: 60 * K, delay: 2.3 }; // after the punt and return play out
  const arrow = turned ? -dirn : dirn;
  return (
    <>
      <section className="sec">
        <div className="card livefield">
          <div className={'lcall' + (banner === call && call.hot ? ' hot' : banner === call && call.bad ? ' bad' : '')} key={banner === call ? 'c' + lastKey : 'poss' + t.id} role="status">
            {banner.team ? <Blob team={banner.team} size={22} /> : null}<b>{banner.text}</b>
          </div>
          <div className="lfhead">
            <Blob team={handoff ? opp : t} size={30} />
            <span className="tx">{handoff
              ? <><b>Next Drive</b><small>Starts at {hText} · {t.abbr} {m.kind === 'kickoff' ? 'kicked off' : `punted (${d.summary || `${d.plays.length} plays`})`}</small></>
              : <><b>{d.live && !half ? 'Current Drive' : 'Last Drive'}</b><small>{d.summary || `${d.plays.length} plays`}</small></>}</span>
            {half ? <span className="res">{d.result || 'End of Half'}</span> : d.result && !d.live ? <span className="res">{d.result}</span> : null}
          </div>
          {going ? (
            <div className="lfdown">
              <span><small>Down</small><b>{ord(last.nextDown)} &amp; {at != null && last.nextDist >= at ? 'Goal' : last.nextDist}</b></span>
              <span><small>Ball on</small><b>{(!steps.length && d.startToEnd != null && d.startText) || last.spot || '·'}</b></span>
            </div>
          ) : null}
          <svg viewBox={`-18 0 ${FW + 36} ${FH + 16}`} className="field" role="img" aria-label={`${t.name} drive: ${d.summary}. ${last ? last.text : ''}`}>
            {Array.from({ length: 10 }, (_, n) => <rect key={n} x={(10 + n * 10) * K} y={top} width={10 * K} height={FH - top} fill={n % 2 ? '#39B54A' : '#46C956'} />)}
            <rect x="0" y={top} width={10 * K} height={FH - top} fill={cc.away.main} />
            <rect x={110 * K} y={top} width={10 * K} height={FH - top} fill={cc.home.main} />
            <text className="ez" transform={`translate(${5 * K} ${mid}) rotate(-90)`} textAnchor="middle" dominantBaseline="central" fill={inkOn(cc.away.main)}>{game.away.abbr}</text>
            <text className="ez" transform={`translate(${115 * K} ${mid}) rotate(90)`} textAnchor="middle" dominantBaseline="central" fill={inkOn(cc.home.main)}>{game.home.abbr}</text>
            {Array.from({ length: 11 }, (_, n) => <line key={n} x1={(10 + n * 10) * K} x2={(10 + n * 10) * K} y1={top} y2={FH} stroke="#fff" strokeWidth={n === 0 || n === 10 ? 2.4 : 1.4} opacity={n === 0 || n === 10 ? 1 : 0.85} />)}
            {[10, 20, 30, 40, 50, 40, 30, 20, 10].map((v, n) => <text key={n} className="yd" x={(20 + n * 10) * K} y={FH - 7} textAnchor="middle">{v}</text>)}
            {game.neutral ? null : <text className="ez mid" x={60 * K} y={mid - 8} textAnchor="middle" dominantBaseline="central" fill={game.home.color || cc.home.main}>{game.home.abbr}</text>}
            <rect x="0" y={top} width={FW} height={FH - top} fill="none" stroke="#0C1124" strokeWidth="2.5" />
            {glowSide != null && !half ? <rect key={'two' + lastKey} className="tdglow" x={glowSide} y={top} width={10 * K} height={FH - top} fill="#FFBE2E" stroke="#FFBE2E" strokeWidth="4" /> : null}
            {/* posts, back half: shadow, stem, crossbar, far upright */}
            {posts.map((P) => (
              <g key={P.s}>
                {bar(`M${P.x + P.s * 7} ${mid} H${P.x}`, 3)}
                {bar(`M${P.N[0] + P.s * P.U} ${P.N[1]} H${P.N[0]} V${P.F[1]} H${P.F[0] + P.s * P.U}`, 3)}
                <circle cx={P.x + P.s * 7} cy={mid} r="2.6" fill={GOLD} stroke={INK} strokeWidth="1.2" />
              </g>))}
            {fd != null ? <line className={'lfmove' + (kickIn ? ' lfwait' : '')} x1="0" x2="0" y1={top} y2={FH} style={{ transform: `translateX(${X(fd)}px)`, '--wait': `${kickIn}s` }} stroke="#FFBE2E" strokeWidth="2.4" /> : null}
            {handoff && hSpot != null ? (
              <g className="lfmove" style={{ transform: `translate(${X(hSpot)}px, ${ly}px)` }}>
                <g className="lfball">
                  <path d={`M${-dirn * 3} -6.5 L${-dirn * 11} 0 L${-dirn * 3} 6.5 Z`} fill="#fff" stroke="#0C1124" strokeWidth="1.3" strokeLinejoin="round" />
                  <g transform="translate(0 -19)">{ball(9.5)}</g>
                  <path d="M0 -12.5 V-3.5" stroke="#0C1124" strokeWidth="1.3" strokeDasharray="2 2" />
                </g>
              </g>
            ) : !half && !defTwo && !kickMine && start != null && at != null ? (
              <>
                <rect className="lfmove" x="0" y={ly - 2} width="100" height="4" rx="2" fill="#fff" stroke="#0C1124" strokeWidth="1" vectorEffect="non-scaling-stroke"
                  style={{ transformOrigin: '0 0', transform: `translateX(${Math.min(X(start), X(at))}px) scaleX(${Math.max(0.02, Math.abs(X(at) - X(start)) / 100)})` }} />
                <circle cx={X(start)} cy={ly} r="3.2" fill="#fff" stroke="#0C1124" strokeWidth="1.3" />
                {puntBack0 ? null : steps.slice(0, -1).map((p, i) => <circle key={i} cx={X(p.to)} cy={ly} r="1.5" fill="#0C1124" />)}
                <g className={'lfmove' + (kickIn ? ' lfwait' : '')} style={{ transform: `translate(${X(ballAt)}px, ${ly}px)`, display: retEnd != null && retFrom != null && !noRet ? 'none' : undefined, '--wait': `${kickIn}s` }}>
                  <g className="lfball">
                    <path d={`M${arrow * 3} -6.5 L${arrow * 11} 0 L${arrow * 3} 6.5 Z`} fill="#fff" stroke="#0C1124" strokeWidth="1.3" strokeLinejoin="round" />
                    {m.kind === 'fg' || m.kind === 'punt' ? null : (
                      <g key={turned ? 'spin' + lastKey : 'ball'} className={turned ? 'kspin' : undefined} style={{ transformOrigin: '0 -19px' }}>
                        <ellipse cx="0" cy="-19" rx="9.5" ry="6" fill="#9A5A2B" stroke="#0C1124" strokeWidth="1.5" />
                        <path d="M-4.2 -19 H4.2 M-2.4 -21 V-17 M0 -21 V-17 M2.4 -21 V-17" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
                        <path d="M0 -12.5 V-3.5" stroke="#0C1124" strokeWidth="1.3" strokeDasharray="2 2" />
                      </g>)}
                  </g>
                </g>
              </>
            ) : null}
            {handoff || defTwo || half ? null : show}
            {defTwo && !half ? (() => {
              const kick = twoBy === 'away' ? 'home' : 'away', a = Xs(kick, 3), b = Xs(kick, 100);
              return (
                <g key={'d2' + lastKey}>
                  {[['#fff', 5.5], [cc[twoBy].main, 3]].map(([c, w]) => <path key={w} className="kret" d={`M${a} ${ly} H${b}`} stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" style={{ '--from': b < a ? '0 0 0 100%' : '0 100% 0 0', animationDelay: '0.2s' }} />)}
                  {/block/i.test(`${last.text} ${prev?.text || ''}`) ? <text className="ktag" x={a} y={ly - 12} textAnchor="middle">BLOCK</text> : null}
                  <g transform={`translate(${b} ${ly - 19})`}>{ball(8)}</g>
                </g>);
            })() : null}
            {!half && retEnd != null && retFrom != null && !noRet ? (
              <g key={'ret' + lastKey}>{/* the return stays drawn until the next play; only the stamp fades */}
                {[['#fff', 5.5], [cc[other].main, 3]].map(([c, w]) => <path key={w} className="kret" d={`M${X(retFrom)} ${ly} H${X(retEnd)}`} stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" style={{ '--from': X(retEnd) < X(retFrom) ? '0 0 0 100%' : '0 100% 0 0', animationDelay: '0.2s' }} />)}
                <g transform={`translate(${X(retEnd)} ${ly - 19})`}>{ball(8)}</g>
              </g>) : null}
            {stamp && !half ? (
              <g key={'stamp' + lastKey} className="fshow">
                {stamp.confetti ? Array.from({ length: 18 }, (_, i) => {
                  const a2 = (i / 18) * Math.PI * 2 + (i % 2) * 0.2, r = 30 + (i % 4) * 14;
                  return <rect key={i} className="kconf" x="-3.5" y="-3.5" width="7" height="7" rx="1.5" fill={[stamp.confetti[1], GOLD, '#fff', '#2ED9D9'][i % 4]} stroke={INK} strokeWidth="0.6"
                    style={{ '--cx': `${stamp.confetti[0]}px`, '--cy': `${mid}px`, '--dx': `${Math.cos(a2) * r}px`, '--dy': `${Math.sin(a2) * r * 0.9}px`, animationDelay: `${(stamp.cdelay || 0) + (i % 5) * 0.05}s` }} />;
                }) : null}
                <g transform={`translate(${stamp.x} ${mid - 6})`}><text className="kstamp" textAnchor="middle" dominantBaseline="central" fill={stamp.color} style={{ ...(stamp.text.length > 11 ? { fontSize: 24 } : {}), ...(stamp.delay || stamp.cdelay ? { animationDelay: `${stamp.delay || stamp.cdelay}s` } : {}) /* a score's stamp lands with its confetti */ }}>{stamp.text}</text></g>
              </g>) : null}
          </svg>
          {last ? (
            <div className="lflast" key={lastKey}>
              <span className="hd"><b style={last.scoring ? { color: 'var(--yellow)' } : undefined}>{fbHead(last)}</b><small>Last play{last.clock ? ` · ${last.period ? 'Q' + last.period : ''} ${last.clock}` : ''}</small></span>
              <span className="tx">{last.text}</span>
              {last.down ? <span className="nx">{last.down}</span> : null /* the down it was run on; what's next is in the box above */}
            </div>
          ) : null}
        </div>
      </section>
      {recent.length > 1 ? (
        <section className="sec">
          <H2>This Drive</H2>
          <div className="card feed">
            {recent.slice(1).map((p, i) => (
              <div className={'fitem' + (p.scoring ? ' score' : '')} key={i} style={{ '--tc': cc[d.side].main }}>
                <Blob team={t} size={26} />
                <span className="body"><span className="hd"><b>{fbHead(p)}</b><small>{p.down}</small></span><span className="tx">{p.text}</span></span>
              </div>))}
            {onAll ? <button className="more" onClick={onAll}>All Drives ›</button> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

function Drives({ drives, game }) {
  const live = game.state === 'live';
  // At halftime the drive on the field is over: close it out.
  const half = live && /halftime/i.test(String(game.statusText || ''));
  const shown = half ? drives.map((d) => (d.live ? { ...d, live: false, result: d.result || 'End of Half' } : d)) : drives;
  const list = live ? [...shown].reverse() : shown; // newest first while the game is on
  const [open, setOpen] = useState(() => drives.find((d) => d.live)?.id ?? null);
  const team = (d) => (d.side === 'home' ? game.home : game.away);
  return (
    <section className="sec">
      <H2>Drives</H2>
      <div className="card">
        {list.map((d) => { const t = team(d), isOpen = open === d.id; const color = d.kind === 'td' ? 'var(--yellow)' : d.kind === 'fg' ? 'var(--lime)' : d.turnover ? '#FF7AA6' : 'var(--teal)'; const opp = d.side === 'home' ? game.away : game.home; return (
          <div className="drive" key={d.id}>
            <button className="dhead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>
              <Blob team={t} />
              <span className="dmain">
                <span className="dres" style={{ color }}>{d.live ? <><span className="dot" aria-hidden="true" style={{ marginRight: 6 }} />On the field</> : (d.kind === 'defTd' ? `${d.result} · ${opp.abbr} TD` : d.result || 'Drive')}
</span>
                <span className="dsum">{[d.summary, d.startText ? `from ${d.startText}` : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="dwhen"><span>{d.period ? `Q${d.period}` : ''} {d.clock}<i aria-hidden="true">{isOpen ? '▴' : '▾'}</i></span>
                {d.scoreChanged && !d.live ? <span className="dscore" aria-label={`Score: ${game.away.abbr} ${d.score.away}, ${game.home.abbr} ${d.score.home}`}><b className={(d.scoreSide || d.side) === 'away' ? 'hit' : ''}>{d.score.away}</b>-<b className={(d.scoreSide || d.side) === 'home' ? 'hit' : ''}>{d.score.home}</b></span> : null}</span>
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
// The floor both basketball views share: light hardwood, full court in feet (94 by 50). Away shoots at the left basket, home at the right.
function courtGeom(lg) {
  const K = 4, W = 94 * K, H = 50 * K, B = 5.25, pro = lg === 'nba' || lg === 'wnba';
  const r3 = pro ? 23.75 : 22.15, corner = pro ? 22 : 21.65, cx3 = Math.sqrt(r3 * r3 - corner * corner), lane = pro ? 8 : 6;
  const lines = (flip) => {
    const r = (v) => v * K, ax = (v) => (flip ? W - v : v);
    const e = (x0, y0, x1, y1) => `M${ax(x0)} ${y0} L${ax(x1)} ${y1}`;
    return [
      e(0, r(25 - lane), r(19), r(25 - lane)), e(r(19), r(25 - lane), r(19), r(25 + lane)), e(r(19), r(25 + lane), 0, r(25 + lane)),
      `M${ax(r(19))} ${r(19)} A${r(6)} ${r(6)} 0 0 ${flip ? 0 : 1} ${ax(r(19))} ${r(31)}`,
      e(0, r(25 - corner), r(B + cx3), r(25 - corner)),
      `M${ax(r(B + cx3))} ${r(25 - corner)} A${r(r3)} ${r(r3)} 0 0 ${flip ? 0 : 1} ${ax(r(B + cx3))} ${r(25 + corner)}`,
      e(r(B + cx3), r(25 + corner), 0, r(25 + corner)),
      e(r(4), r(22), r(4), r(28)),
    ].join(' ');
  };
  // A feed spot (x across 0..50, y out from the basket) placed at one end of the full court.
  const place = (xy, end) => {
    const x = Math.max(-1, Math.min(47, xy.y)), y = Math.max(0.8, Math.min(49.2, xy.x));
    return end === 'away' ? { x: (B + x) * K, y: y * K } : { x: W - (B + x) * K, y: H - y * K };
  };
  return { K, W, H, B, lane, court: `M0 0 H${W} V${H} H0 Z M${W / 2} 0 V${H} ${lines(false)} ${lines(true)}`, place };
}
const WOOD = '#EBD5AC', WOODLINE = '#1B2350';
function Hardwood({ lg, game, label, children, defs }) {
  const { K, W, H, B, lane, court } = courtGeom(lg);
  const cc = chartColors(game.away, game.home, true);
  return (
    <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="court full" role="img" aria-label={label}>
      {defs ? <defs>{defs}</defs> : null}
      <rect x="0" y="0" width={W} height={H} fill={WOOD} />
      {Array.from({ length: 9 }, (_, n) => <line key={n} x1="0" x2={W} y1={(n + 1) * (H / 10)} y2={(n + 1) * (H / 10)} stroke="#C9A974" strokeWidth="0.6" opacity="0.45" />)}
      <rect x="0" y={(25 - lane) * K} width={19 * K} height={lane * 2 * K} fill={cc.away.main} opacity="0.55" />
      <rect x={W - 19 * K} y={(25 - lane) * K} width={19 * K} height={lane * 2 * K} fill={cc.home.main} opacity="0.55" />
      {children?.under}
      <path d={court} fill="none" stroke={WOODLINE} strokeWidth="2.2" />
      <circle cx={W / 2} cy={H / 2} r={6 * K} fill={WOOD} stroke={WOODLINE} strokeWidth="2.2" />
      {/* Neutral floors keep a bare center circle; otherwise it is the home team's. */}
      {game.neutral ? null : <text x={W / 2} y={H / 2 + 6} textAnchor="middle" className="ccode" fill={cc.home.main}>{game.home.abbr}</text>}
      {[B * K, W - B * K].map((x) => <circle key={x} cx={x} cy={H / 2} r="4.5" fill="none" stroke="#E2571C" strokeWidth="2.4" />)}
      {children?.over}
    </svg>
  );
}
const made = (x, y, c, r = 5) => <><circle cx={x} cy={y} r={r} fill="none" stroke={c} strokeWidth="1.6" /><circle cx={x} cy={y} r={r * 0.5} fill={c} /></>;
const missed = (x, y, c, r = 3.6, w = 1.8) => <path d={`M${x - r} ${y - r} L${x + r} ${y + r} M${x + r} ${y - r} L${x - r} ${y + r}`} stroke={c} strokeWidth={w} strokeLinecap="round" />;

/* ---------- basketball shot chart: both teams on one floor ---------- */
// Shot Chart: every shot on the floor with those plays underneath. The period chips, made/missed and team toggles filter
// both, and tapping a shot on the floor shows just that play below.
function ShotChart({ shots, game, lg, pbp = [] }) {
  const L = LEAGUE[lg];
  const [per, setPer] = useState(0);
  const [mode, setMode] = useState('shots');
  const [sel, setSel] = useState(null);
  const { place } = courtGeom(lg);
  const cc = chartColors(game.away, game.home, true);
  const sides = [['away', game.away, cc.away.main], ['home', game.home, cc.home.main]];
  const periods = [...new Set([...shots, ...pbp].map((s) => s.period))].filter(Boolean).sort((a, b) => a - b);
  const [kindOn, flipKind0] = useToggles(['made', 'miss']);
  const [teamOn, flipTeam0] = useToggles([game.away.id, game.home.id]);
  const flipKind = (k) => { setSel(null); flipKind0(k); };
  const flipTeam = (k) => { setSel(null); flipTeam0(k); };
  // Only shots are charted, so the list is the shots on the floor: no play-type chips.
  const others = [];
  const modes = [['shots', 'Shots']];
  const m = modes.some(([k]) => k === mode) ? mode : 'shots';
  const floorOn = m === 'shots' || m === 'all';
  const shown = shots.filter((s) => !per || s.period === per);
  const onFloor = floorOn ? shown.filter((s) => kindOn.has(s.made ? 'made' : 'miss') && teamOn.has(s.teamId)) : [];
  const pctTxt = (mm, n) => (n ? ` · ${((100 * mm) / n).toFixed(1)}%` : '');
  // The plays list follows the floor: the shots on it, every play for All, or the picked kind.
  const onIds = new Set(onFloor.map((s) => s.id).filter(Boolean));
  const kre = others.find(([k]) => k === m)?.[2];
  let rows = pbp.filter((p) => (!per || p.period === per) && (m === 'shots' ? onIds.has(p.id) : (!p.teamId || teamOn.has(p.teamId)) && (!kre || kre.test(`${p.type} ${p.text}`))));
  if (game.state === 'live') rows = [...rows].reverse();
  const picked = sel ? pbp.find((p) => p.id === sel) : null;
  if (picked) rows = [picked];
  const pick = (id) => setSel(sel === id ? null : id);
  const reset = (fn) => (v) => { setSel(null); fn(v); };
  const marks = sides.flatMap(([sd, t, c]) => {
    const mine = onFloor.filter((s) => s.teamId === t.id);
    return [...mine.filter((s) => !s.made), ...mine.filter((s) => s.made)].map((s) => ({ s, q: place(s, sd), c }));
  });
  if (sel) marks.sort((x, y) => (x.s.id === sel) - (y.s.id === sel));
  const pickedMark = sel ? marks.find((x) => x.s.id === sel) : null;
  return (
    <section className="sec">
      <H2>Shot Chart</H2>
      {modes.length > 1 ? (
        <div className="chips" role="group" aria-label="Plays to show" style={{ marginTop: 8 }}>
          {modes.map(([k, l]) => <button key={k} className="chipb" aria-pressed={m === k} onClick={() => reset(setMode)(k)}>{l}</button>)}
        </div>
      ) : null}
      {periods.length > 1 ? (
        <div className="chips" role="group" aria-label="Period" style={{ marginTop: 8 }}>
          <button className="chipb" aria-pressed={per === 0} onClick={() => reset(setPer)(0)}>All</button>
          {periods.map((p) => <button key={p} className="chipb" aria-pressed={per === p} onClick={() => reset(setPer)(p)}>{p <= (L.periods || 4) ? perName(L, p) : periods.filter((x) => x > (L.periods || 4)).length > 1 ? `OT${p - (L.periods || 4)}` : 'OT'}</button>)}
        </div>
      ) : null}
      <div className="card pad shotbox">
        <Hardwood lg={lg} game={game} label={`Shot chart: ${game.away.name} on the left, ${game.home.name} on the right.`}>
          {{ over: [
            ...marks.map(({ s, q, c }, i) => <g key={'m' + (s.id || i)} opacity={sel && s.id !== sel ? 0.22 : 1} style={{ transition: 'opacity .2s' }}>{s.made ? made(q.x, q.y, c, 4.6) : missed(q.x, q.y, c, 3.2, 1.6)}</g>),
            pickedMark ? <circle key="ring" cx={pickedMark.q.x} cy={pickedMark.q.y} r="10" fill="none" stroke="#0C1124" strokeWidth="2.2" pointerEvents="none" /> : null,
            ...marks.map(({ s, q }, i) => (s.id ? <circle key={'h' + (s.id || i)} cx={q.x} cy={q.y} r="8" fill="transparent" style={{ cursor: 'pointer' }} onClick={() => pick(s.id)}><title>{s.text}</title></circle> : null)),
          ] }}
        </Hardwood>
        <div className="shotkey">
          {sides.map(([sd, t]) => { const mine = shown.filter((s) => s.teamId === t.id), mm = mine.filter((s) => s.made).length, th = mine.filter((s) => s.three), m3 = th.filter((s) => s.made).length; return (
            <div key={sd} className="sk">
              <span className="who"><Blob team={t} size={22} /><b>{t.abbr}</b></span>
              <span>FG {mm}-{mine.length}{pctTxt(mm, mine.length)}</span>
              <span>3PT {m3}-{th.length}{pctTxt(m3, th.length)}</span>
            </div>); })}
        </div>
        <ShotKey game={game} kindOn={kindOn} flipKind={flipKind} teamOn={teamOn} flipTeam={flipTeam}
          kinds={floorOn ? [['made', '◎ MADE', '#FFBE2E', shown.filter((s) => s.made && teamOn.has(s.teamId)).length], ['miss', '✕ MISSED', '#CBD2EA', shown.filter((s) => !s.made && teamOn.has(s.teamId)).length]] : []} />
      </div>
      {pbp.length ? (
        <>
          <div className="sechead icelist" style={{ marginTop: 14 }}>
            <span className="stamp" style={{ margin: 0, textAlign: 'left' }}>{picked ? '1 play' : `${rows.length} ${rows.length === 1 ? 'play' : 'plays'}`}</span>
            {picked ? <button className="link" onClick={() => setSel(null)}>Show all</button> : null}
          </div>
          <div className="card feed">
            {rows.length ? rows.map((p, i) => <FeedRow key={p.id || i} p={p} game={game} L={L} />) : <p className="stamp" style={{ padding: '16px' }}>Nothing that matches.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}

/* ---------- basketball, live: the court with the latest play on it, and a running feed underneath ---------- */
// A short headline for each play, the way a courtside graphic would put it.
export function playHead(p, L) {
  if (L.sport !== 'basketball') return p.type || (p.scoring ? 'Score' : 'Play');
  const t = `${p.type} ${p.text}`;
  if (p.scoring && p.pts) return `+${p.pts} Point${p.pts > 1 ? 's' : ''}`;
  if (p.shot) return /free throw/i.test(t) ? 'Missed Free Throw' : /three point/i.test(t) ? 'Missed Three' : 'Missed Shot';
  if (/rebound/i.test(p.type)) return /offensive/i.test(p.type) ? 'Offensive Rebound' : 'Rebound';
  if (/block/i.test(t)) return 'Block';
  if (/steal/i.test(t)) return 'Steal';
  if (/turnover|traveling|bad pass|lost ball/i.test(t)) return 'Turnover';
  if (/foul/i.test(t)) return 'Foul';
  if (/timeout/i.test(t)) return 'Timeout';
  if (/jump ?ball/i.test(t)) return 'Jump Ball';
  if (/end (of )?(game|period|half|quarter)/i.test(t)) return /game/i.test(t) ? 'Final' : `End of ${perName(L, p.period)}`;
  return p.type || 'Play';
}
const isSub = (p) => /substitution|subbing/i.test(`${p.type} ${p.text}`);

// One play in a feed: team tile, headline, clock, the play, and the running score.
function FeedRow({ p, game, L }) {
  const sd = p.teamId === game.away.id ? 'away' : p.teamId === game.home.id ? 'home' : null, t = sd ? game[sd] : null;
  const dk = chartColors(game.away, game.home);
  return (
    <div className={'fitem' + (p.scoring ? ' score' : '')} style={{ '--tc': sd ? dk[sd].main : 'var(--rule)' }}>
      {t ? <Blob team={t} size={26} /> : <span className="noteam" aria-hidden="true" />}
      <span className="body">
        <span className="hd"><b>{playHead(p, L)}</b><small>{p.period ? perName(L, p.period) : ''}{p.clock ? ` · ${p.clock}` : ''}</small></span>
        <span className="tx">{p.text}</span>
      </span>
      {Number.isFinite(p.away) && Number.isFinite(p.home) ? (
        <span className="rs" aria-label={`${game.away.abbr} ${p.away}, ${game.home.abbr} ${p.home}`}>
          <span className={p.scoring && sd === 'away' ? 'hot' : undefined}>{p.away}</span>
          <span className={p.scoring && sd === 'home' ? 'hot' : undefined}>{p.home}</span>
        </span>
      ) : null}
    </div>
  );
}
function LiveCourt({ pbp, game, L, lg, onAll }) {
  const { K, W, H, place } = courtGeom(lg);
  const cc = chartColors(game.away, game.home, true), dk = chartColors(game.away, game.home);
  const side = (id) => (id === game.away.id ? 'away' : id === game.home.id ? 'home' : null);
  const teamOf = (id) => (side(id) === 'away' ? game.away : side(id) === 'home' ? game.home : null);
  const plays = pbp.filter((p) => !isSub(p));
  const recent = [...plays].reverse();
  // One play at a time: only the latest shot is marked on the floor.
  // It stays up through the other team's trip down the floor and clears once the shooting team has the ball back.
  const last0 = recent.find((p) => p.shot && p.xy && side(p.teamId));
  const last = (() => {
    if (!last0) return null;
    const mine = side(last0.teamId), theirs = mine === 'away' ? 'home' : 'away';
    const t0 = `${last0.type} ${last0.text}`;
    let who = /free throw/i.test(t0) ? null : last0.scoring ? theirs : null; // after a miss, nobody has it until the rebound
    let lost = who === theirs;
    for (const p of plays.slice(plays.indexOf(last0) + 1)) {
      const sd = side(p.teamId), t = `${p.type} ${p.text}`;
      if (!sd) continue;
      if (p.shot) who = p.scoring && !/free throw/i.test(t) ? (sd === 'away' ? 'home' : 'away') : sd;
      else if (/rebound|steal/i.test(t)) who = sd;
      else if (/turnover|traveling|bad pass|lost ball|offensive foul|out of bounds/i.test(t)) who = sd === 'away' ? 'home' : 'away';
      if (who === theirs) lost = true;
      if (lost && who === mine) return null;
    }
    return last0;
  })();
  const now = recent[0];
  // Who has the ball, worked out by walking the plays in order.
  const poss = useMemo(() => {
    const other = (sd) => (sd === 'away' ? 'home' : sd === 'home' ? 'away' : null);
    let who = null;
    for (const p of plays) {
      const sd = side(p.teamId), t = `${p.type} ${p.text}`;
      if (!sd) continue;
      if (p.shot && /free throw/i.test(t)) { const m = /(\d) of (\d)/.exec(t); who = p.scoring && (!m || m[1] === m[2]) ? other(sd) : sd; }
      else if (p.shot) who = p.scoring ? other(sd) : sd;
      else if (/rebound|steal/i.test(t)) who = sd;
      else if (/turnover|traveling|bad pass|lost ball|offensive foul/i.test(t)) who = other(sd);
    }
    return who;
  }, [pbp]);
  // The banner calls out the newest play for a few seconds, then settles back to who has the ball.
  const [flash, setFlash] = useState(true);
  useEffect(() => { setFlash(true); const h = setTimeout(() => setFlash(false), 4500); return () => clearTimeout(h); }, [now?.id]);
  // At a break (halftime, end of a period) nobody has the ball: no arrows, no possession glow, and the banner names the break.
  const atBreak = /halftime|^end of|intermission/i.test(String(game.statusText || ''));
  const possT = atBreak ? null : poss === 'away' ? game.away : poss === 'home' ? game.home : null;
  const lt = last && !atBreak ? place(last.xy, side(last.teamId)) : null;
  const head = now ? playHead(now, L) : '';
  // A 10-0 run (or better) gets called out while it lasts.
  const run = scoringRun(plays);
  const runT = run ? game[run.side] : null;
  const runTxt = run ? `${run.pts}-0` : '';
  // The banner calls out the run only when this basket carries it past 10, 20, 30...; the chip on the court stays up all along.
  const nowPts = Number((/\+(\d)/.exec(head) || [])[1]) || 0;
  const milestone = !!run && now?.scoring && side(now.teamId) === run.side && nowPts && Math.floor(run.pts / 10) > Math.floor((run.pts - nowPts) / 10);
  const call = flash && now ? { text: milestone ? `${head} · ${runTxt} Run` : head, team: teamOf(now.teamId), hot: now.scoring, bad: /turnover|foul/i.test(head) } : possT ? { text: `${possT.abbr} Ball`, team: possT } : atBreak ? { text: game.statusText } : null;
  // Chevrons march toward the basket the team with the ball is attacking.
  const dir = poss === 'away' ? -1 : 1, pc = poss && !atBreak ? cc[poss].main : null;
  const shown = recent.slice(0, 4);
  return (
    <>
      <section className="sec">
        <div className="card livecourt">
          <div className={'lcall' + (call?.hot ? ' hot' : call?.bad ? ' bad' : '')} key={flash ? now?.id : 'poss' + poss} role="status">
            {call ? <>{call.team ? <Blob team={call.team} size={22} /> : null}<b>{call.text}</b></> : <b>&nbsp;</b>}
          </div>
          <Hardwood lg={lg} game={game} label={now ? `Latest: ${now.text}` : 'Court'}
            defs={<linearGradient id="lcposs" x1={poss === 'away' ? '0' : '1'} x2={poss === 'away' ? '1' : '0'} y1="0" y2="0"><stop offset="0" stopColor={pc || WOOD} stopOpacity="0.5" /><stop offset="1" stopColor={pc || WOOD} stopOpacity="0" /></linearGradient>}>
            {{
              under: pc ? <rect x={poss === 'away' ? 0 : W / 2} y="0" width={W / 2} height={H} fill="url(#lcposs)" /> : null,
              over: <>
                {pc ? [0, 1, 2].map((n) => { const x = W / 2 + dir * (48 + n * 18); return <path key={poss + n} className="chev" style={{ animationDelay: `${n * 0.36}s` }} d={`M${x - dir * 7} ${H / 2 - 16} L${x + dir * 7} ${H / 2} L${x - dir * 7} ${H / 2 + 16}`} fill="none" stroke={pc} strokeWidth="5" />; }) : null}
                {run ? (
                  <g key={'run' + run.side} transform={`translate(${W / 2} 22)`}><g className="runchip">
                    <FitPill text={`${runT.abbr} ${runTxt} RUN`} fill={dk[run.side].main} ink={inkOn(dk[run.side].main)} />
                  </g></g>) : null}
                {lt ? <g key={last.id} className="pop">{last.scoring
                  ? <><circle cx={lt.x} cy={lt.y} r="9" fill="#FFBE2E" stroke="#0C1124" strokeWidth="2" /><circle cx={lt.x} cy={lt.y} r="3.6" fill="#0C1124" /></>
                  : missed(lt.x, lt.y, '#0C1124', 6, 3.2)}</g> : null}
              </>,
            }}
          </Hardwood>
          <div className="feed inl">
            {shown.map((p, i) => <FeedRow key={p.id || i} p={p} game={game} L={L} />)}
            {onAll ? <button className="more" onClick={onAll}>Full Play by Play ›</button> : null}
          </div>
        </div>
      </section>
    </>
  );
}

// A chip drawn on a court or rink, as wide as its words in the real font (it re-measures once the font loads).
function FitPill({ text, fill, ink, h = 30, pad = 15, min = 90 }) {
  const tref = useRef(null);
  const [w, setW] = useState(null);
  useLayoutEffect(() => {
    const t = tref.current;
    if (!t) return undefined;
    let live = true;
    const measure = () => { if (live && t.isConnected) { const n = t.getComputedTextLength(); if (n > 0) setW(n); } };
    measure();
    document.fonts?.ready?.then(measure);
    return () => { live = false; };
  }, [text]);
  const width = Math.max(min, (w || 0) + pad * 2);
  return (
    <>
      <rect x={-width / 2} y={-h / 2} width={width} height={h} rx="9" fill={fill} stroke="#0C1124" strokeWidth="2.4" style={{ visibility: w == null ? 'hidden' : undefined }} />
      <text ref={tref} y="1" textAnchor="middle" dominantBaseline="central" fill={ink} style={{ visibility: w == null ? 'hidden' : undefined }}>{text}</text>
    </>
  );
}

/* ---------- hockey: every shot on the rink. Away team shoots right, home team shoots left. ---------- */
// The key under a shot chart doubles as the filter: tap a pill to hide or show those shots.
// At least one pill in each row stays on, so the floor is never empty by accident.
function useToggles(all) {
  const [on, setOn] = useState(() => new Set(all));
  const flip = (k) => setOn((cur) => { const n = new Set(cur); if (n.has(k)) { if (n.size > 1) n.delete(k); } else n.add(k); return n; });
  return [on, flip];
}
function ShotKey({ kinds, kindOn, flipKind, game, teamOn, flipTeam }) {
  const dk = chartColors(game.away, game.home);
  return (
    <div className="skeys">
      {kinds.length ? <div className="legend kinds" role="group" aria-label="Show shots by result">
        {kinds.map(([k, label, bg, n]) => (
          <button key={k} className="lg" aria-pressed={kindOn.has(k)} onClick={() => flipKind(k)} style={{ background: bg }}>{label}{n != null ? <b>{n}</b> : null}</button>
        ))}
      </div> : null}
      <div className="legend" role="group" aria-label="Show shots by team">
        {[[game.away, dk.away.main], [game.home, dk.home.main]].map(([t, c]) => (
          <button key={t.id} className="lg" aria-pressed={teamOn.has(t.id)} onClick={() => flipTeam(t.id)} style={{ background: c, color: inkOn(c) }}>{t.abbr}</button>
        ))}
      </div>
    </div>
  );
}
// Rink marks for the plays that are not shots. One look per play type, in the team's color.
const ICE_KINDS = {
  hit: { one: 'hit', many: 'hits', chip: 'Hits' },
  block: { one: 'block', many: 'blocks', chip: 'Blocks' },
  take: { one: 'takeaway', many: 'takeaways', chip: 'Takeaways' },
  give: { one: 'giveaway', many: 'giveaways', chip: 'Giveaways' },
  pen: { one: 'penalty', many: 'penalties', chip: 'Penalties' },
};
function burst(x, y, ro, ri, n = 10) {
  return Array.from({ length: n * 2 }, (_, i) => { const r = i % 2 ? ri : ro, a = (Math.PI * i) / n - Math.PI / 2; return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
}
function IceMark({ kind, x, y, c, mins, s = 1, title }) {
  const t = title ? <title>{title}</title> : null;
  if (kind === 'hit') return <polygon points={burst(x, y, 9.5 * s, 4.6 * s)} fill="#fff" stroke={c} strokeWidth={2.2 * s} strokeLinejoin="round">{t}</polygon>;
  if (kind === 'block') return <g>{t}<circle cx={x} cy={y} r={7 * s} fill="#fff" stroke={c} strokeWidth={2.4 * s} /><path d={`M${x - 4.6 * s} ${y + 4.6 * s} L${x + 4.6 * s} ${y - 4.6 * s}`} stroke={c} strokeWidth={2.4 * s} strokeLinecap="round" /></g>;
  if (kind === 'take') return <polygon points={`${x},${y - 8 * s} ${x + 7.5 * s},${y + 5.5 * s} ${x - 7.5 * s},${y + 5.5 * s}`} fill={c} stroke="#0C1124" strokeWidth={1.4 * s} strokeLinejoin="round">{t}</polygon>;
  if (kind === 'give') return <polygon points={`${x},${y + 8 * s} ${x + 7.5 * s},${y - 5.5 * s} ${x - 7.5 * s},${y - 5.5 * s}`} fill="#fff" stroke={c} strokeWidth={2.4 * s} strokeLinejoin="round">{t}</polygon>;
  if (kind === 'pen') return (
    <g>{t}
      <rect x={x - 12 * s} y={y - 9.5 * s} width={24 * s} height={19 * s} rx={4 * s} fill={c} stroke="#0C1124" strokeWidth={2 * s} />
      <text x={x} y={y + 0.5 * s} textAnchor="middle" dominantBaseline="central" fill={inkOn(c)} style={{ fontSize: 13 * s, fontWeight: 900, fontFamily: 'var(--font)' }}>{mins || 'P'}</text>
    </g>
  );
  return null;
}
// Ice Chart: the rink on top and the plays that match it underneath. The chips pick what shows (shots, hits... or every
// play), the period chips and team toggles filter both, and tapping a mark on the ice shows just that play below.
export function IceChart({ ice, events = [], game, pbp = [], L }) {
  const [per, setPer] = useState(0);
  const [mode, setMode] = useState('shots');
  const [sel, setSel] = useState(null);
  const cc = chartColors(game.away, game.home, true), dk = chartColors(game.away, game.home);
  const col = (id) => (id === game.away.id ? cc.away.main : cc.home.main);
  const periods = [...new Set([...ice, ...events, ...pbp].map((s) => s.period))].filter(Boolean).sort((a, b) => a - b);
  const [kindOn, flipKind0] = useToggles(['goal', 'save', 'miss']);
  const [teamOn, flipTeam0] = useToggles([game.away.id, game.home.id]);
  const flipKind = (k) => { setSel(null); flipKind0(k); };
  const flipTeam = (k) => { setSel(null); flipTeam0(k); };
  const modes = [...(pbp.length ? [['all', 'All']] : []), ['shots', 'Shots'], ...Object.entries(ICE_KINDS).filter(([k]) => events.some((e) => e.kind === k)).map(([k, v]) => [k, v.chip])];
  const m = modes.some(([k]) => k === mode) ? mode : 'shots';
  const shots = m === 'shots', every = m === 'all';
  const shown = ice.filter((s) => !per || s.period === per);
  const evShown = events.filter((e) => (every || e.kind === m) && (!per || e.period === per));
  const onIce = shots || every ? shown.filter((s) => kindOn.has(s.kind) && teamOn.has(s.teamId)) : [];
  const evOnIce = shots ? [] : evShown.filter((e) => teamOn.has(e.teamId));
  const nk = (k) => shown.filter((s) => s.kind === k && teamOn.has(s.teamId)).length;
  const K = 3;
  const X = (v) => (Math.max(-98, Math.min(98, v)) + 100) * K, Y = (v) => (42.5 - Math.max(-40.5, Math.min(40.5, v))) * K;
  const count = (id, kind) => shown.filter((s) => s.teamId === id && (!kind || s.kind === kind)).length;
  const evCount = (id) => evShown.filter((e) => e.teamId === id).length;
  const pim = (id) => evShown.filter((e) => e.teamId === id).reduce((n, e) => n + (e.mins || 0), 0);
  const word = (n) => (n === 1 ? ICE_KINDS[m]?.one : ICE_KINDS[m]?.many);
  const evLine = (t) => `${evCount(t.id)} ${word(evCount(t.id))}${m === 'pen' && pim(t.id) ? ` · ${pim(t.id)} PIM` : ''}`;
  const order = { miss: 0, save: 1, goal: 2 };
  const label = shots || every
    ? `Shot locations. ${game.away.name}: ${count(game.away.id, 'goal')} goals on ${count(game.away.id)} shots. ${game.home.name}: ${count(game.home.id, 'goal')} goals on ${count(game.home.id)} shots.`
    : `${ICE_KINDS[m].chip} on the ice. ${game.away.name}: ${evLine(game.away)}. ${game.home.name}: ${evLine(game.home)}.`;
  // The plays list follows the ice: the same marks (every play for All Plays), newest first while live.
  const onIds = new Set([...onIce, ...evOnIce].map((e) => e.id).filter(Boolean));
  let rows = pbp.filter((p) => (!per || p.period === per) && (every ? !p.teamId || teamOn.has(p.teamId) : onIds.has(p.id)));
  if (game.state === 'live') rows = [...rows].reverse();
  const picked = sel ? pbp.find((p) => p.id === sel) : null;
  if (picked) rows = [picked];
  const pick = (id) => setSel(sel === id ? null : id);
  const dim = (id) => (sel && id !== sel ? 0.22 : 1);
  // A bigger, invisible target under each mark so a thumb can hit it.
  const hit = (e) => <circle cx={X(e.x)} cy={Y(e.y)} r="15" fill="transparent" style={{ cursor: 'pointer' }} onClick={() => pick(e.id)}><title>{e.text}</title></circle>;
  const ring = (e) => <circle cx={X(e.x)} cy={Y(e.y)} r="17" fill="none" stroke="#0C1124" strokeWidth="3" className="icesel" pointerEvents="none" />;
  const shotMark = (s) => {
    const x = X(s.x), y = Y(s.y), c = col(s.teamId);
    if (s.kind === 'miss') return <path d={`M${x - 4.5} ${y - 4.5} L${x + 4.5} ${y + 4.5} M${x + 4.5} ${y - 4.5} L${x - 4.5} ${y + 4.5}`} stroke={c} strokeWidth="2.4" strokeLinecap="round" />;
    if (s.kind === 'save') return <circle cx={x} cy={y} r="5" fill="#fff" stroke={c} strokeWidth="2.6" />;
    return <g><rect x={x - 8} y={y - 8} width="16" height="16" fill="#FFBE2E" stroke="#0C1124" strokeWidth="2" transform={`rotate(45 ${x} ${y})`} /><circle cx={x} cy={y} r="4" fill={c} stroke="#0C1124" strokeWidth="1.2" /></g>;
  };
  const marks = [
    ...[...onIce].sort((a, b) => order[a.kind] - order[b.kind]).map((s) => ({ e: s, el: shotMark(s) })),
    ...evOnIce.map((e) => ({ e, el: <IceMark kind={e.kind} x={X(e.x)} y={Y(e.y)} c={col(e.teamId)} mins={e.mins} /> })),
  ];
  if (sel) marks.sort((a, b) => (a.e.id === sel) - (b.e.id === sel)); // the picked one on top
  const reset = (fn) => (v) => { setSel(null); fn(v); };
  return (
    <section className="sec">
      <H2>Ice Chart</H2>
      {modes.length > 1 ? (
        <div className="chips" role="group" aria-label="Plays to show" style={{ marginTop: 8 }}>
          {modes.map(([k, l]) => <button key={k} className="chipb" aria-pressed={m === k} onClick={() => reset(setMode)(k)}>{l}</button>)}
        </div>
      ) : null}
      {periods.length > 1 ? (
        <div className="chips" role="group" aria-label="Period" style={{ marginTop: 8 }}>
          <button className="chipb" aria-pressed={per === 0} onClick={() => reset(setPer)(0)}>All</button>
          {periods.map((p) => <button key={p} className="chipb" aria-pressed={per === p} onClick={() => reset(setPer)(p)}>{p <= 3 ? `P${p}` : p === 4 ? 'OT' : `OT${p - 3}`}</button>)}
        </div>
      ) : null}
      <div className="card pad shotbox">
        <div className="icekey">
          {[game.away, game.home].map((t, i) => (
            <span key={t.id} style={{ textAlign: i ? 'right' : 'left' }}>
              <b style={{ color: i ? dk.home.main : dk.away.main }}>{t.abbr} {i ? '←' : '→'}</b>
              <small>
                {!shots && !every ? <svg viewBox="-12 -11 24 22" width="15" height="14" aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }}><IceMark kind={m} x={0} y={0} c={col(t.id)} mins={2} s={0.95} /></svg> : null}
                {shots || every ? `${count(t.id, 'goal')} goals · ${count(t.id)} shots` : evLine(t)}
              </small>
            </span>
          ))}
        </div>
        <Ice game={game} label={label}>
          {marks.map(({ e, el }, i) => <g key={(e.id || 'm') + i} opacity={dim(e.id)} style={{ transition: 'opacity .2s' }}>{el}</g>)}
          {picked ? (() => { const e = marks.find((x) => x.e.id === sel)?.e; return e ? ring(e) : null; })() : null}
          {marks.map(({ e }, i) => (e.id ? <g key={'h' + (e.id || i)}>{hit(e)}</g> : null))}
        </Ice>
        <ShotKey game={game} kindOn={kindOn} flipKind={flipKind} teamOn={teamOn} flipTeam={flipTeam}
          kinds={shots || every ? [['goal', '◆ GOAL', '#FFBE2E', nk('goal')], ['save', '○ SAVED', '#CBD2EA', nk('save')], ['miss', '✕ MISSED', '#CBD2EA', nk('miss')]] : []} />
      </div>
      {pbp.length ? (
        <>
          <div className="sechead icelist" style={{ marginTop: 14 }}>
            <span className="stamp" style={{ margin: 0, textAlign: 'left' }}>{picked ? '1 play' : `${rows.length} ${rows.length === 1 ? 'play' : 'plays'}`}</span>
            {picked ? <button className="link" onClick={() => setSel(null)}>Show all</button> : null}
          </div>
          <div className="card feed">
            {rows.length ? rows.map((p, i) => <FeedRow key={p.id || i} p={p} game={game} L={L} />) : <p className="stamp" style={{ padding: '16px' }}>Nothing that matches.</p>}
          </div>
        </>
      ) : null}
    </section>
  );
}

// The ice both hockey views share: bright sheet, away shoots right, home shoots left.
function Ice({ game, label, children }) {
  const cc = chartColors(game.away, game.home, true);
  const K = 3, W = 200 * K, H = 85 * K;
  const dots = [31, 169].flatMap((x) => [20.5, 64.5].map((y) => [x * K, y * K]));
  return (
    <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} className="court full" role="img" aria-label={label}>
      <rect x="0" y="0" width={W} height={H} rx={28 * K} fill="#F4FAFF" stroke="#1B2350" strokeWidth="3" />
      <path d={`M${11 * K} ${H / 2 - 4 * K} a${6 * K} ${4 * K} 0 0 1 0 ${8 * K} Z`} fill={cc.home.main} opacity="0.5" />
      <path d={`M${189 * K} ${H / 2 - 4 * K} a${6 * K} ${4 * K} 0 0 0 0 ${8 * K} Z`} fill={cc.away.main} opacity="0.5" />
      <path d={`M${100 * K} 0 V${H}`} stroke="#E0263C" strokeWidth="4" />
      <path d={`M${75 * K} 0 V${H} M${125 * K} 0 V${H}`} stroke="#2A5BD7" strokeWidth="5" />
      <path d={`M${11 * K} ${5 * K} V${H - 5 * K} M${189 * K} ${5 * K} V${H - 5 * K}`} stroke="#E0263C" strokeWidth="1.6" />
      <circle cx={100 * K} cy={H / 2} r={15 * K} fill="#F4FAFF" stroke="#2A5BD7" strokeWidth="2" />
      <text x={100 * K} y={H / 2 + 7} textAnchor="middle" className="ccode" style={{ fontSize: 20 }} fill={cc.home.main}>{game.neutral ? '' : game.home.abbr}</text>
      {dots.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r={15 * K} fill="none" stroke="#E0263C" strokeWidth="1.6" opacity="0.7" /><circle cx={x} cy={y} r="3" fill="#E0263C" /></g>)}
      <path d={`M${11 * K - 9} ${H / 2 - 9} H${11 * K} V${H / 2 + 9} H${11 * K - 9} Z M${189 * K + 9} ${H / 2 - 9} H${189 * K} V${H / 2 + 9} H${189 * K + 9} Z`} fill="none" stroke="#1B2350" strokeWidth="2" />
      {children}
    </svg>
  );
}

/* ---------- hockey, live: bright ice with the latest shot on it, and the newest plays underneath ---------- */
function LiveRink({ ice, pbp, game, L, onAll, rink }) {
  const cc = chartColors(game.away, game.home, true);
  const K = 3, W = 200 * K, H = 85 * K;
  const X = (v) => (Math.max(-98, Math.min(98, v)) + 100) * K, Y = (v) => (42.5 - Math.max(-40.5, Math.min(40.5, v))) * K;
  const recent = [...pbp].reverse();
  const now = recent[0], last = ice[ice.length - 1];
  const sideOf = (id) => (id === game.away.id ? 'away' : id === game.home.id ? 'home' : null);
  const [flash, setFlash] = useState(true);
  useEffect(() => { setFlash(true); const h = setTimeout(() => setFlash(false), 6000); return () => clearTimeout(h); }, [now?.id, pbp.length]);
  const sog = (t) => ice.filter((s) => s.teamId === t.id && s.kind !== 'miss').length;
  const nowT = now && sideOf(now.teamId) ? game[sideOf(now.teamId)] : null;
  const head = now ? playHead(now, L) : '';
  const lc = last ? cc[sideOf(last.teamId)].main : null;
  // The goal light: on while a goal is one of the three newest plays, over the net it went into.
  const g3 = recent.slice(0, 3).find((p) => p.scoring);
  const goalSide = g3 ? sideOf(g3.teamId) : null;
  // Away defends the left net, home the right one.
  const netX = (sd) => (sd === 'away' ? 11 : 189) * K;
  const pp = rink?.pp || null, ppT = pp ? game[pp.side] : null, shortSide = pp ? (pp.side === 'away' ? 'home' : 'away') : null;
  // The save pulse: the newest shot was stopped point-blank.
  const bigSave = last && last.kind === 'save' && Math.hypot(89 - Math.abs(last.x), last.y) <= 15 ? (sideOf(last.teamId) === 'away' ? 'home' : 'away') : null; // a stop from within about 15 feet of the net
  return (
    <section className="sec">
      <div className="card livecourt">
        <div className={'lcall' + (flash && now?.scoring ? ' hot' : flash && /penalty/i.test(head) ? ' bad' : '')} key={flash ? 'p' + pbp.length : 'sog'} role="status">
          {flash && now ? <>{nowT ? <Blob team={nowT} size={22} /> : null}<b>{head}</b></> : <b>Shots · {game.away.abbr} {sog(game.away)} · {game.home.abbr} {sog(game.home)}</b>}
        </div>
        <div className="lchead">
          <span><Blob team={game.away} size={20} /> <b>{game.away.abbr}</b> <small>shoots ▸</small></span>
          <span><small>◂ shoots</small> <b>{game.home.abbr}</b> <Blob team={game.home} size={20} /></span>
        </div>
        <Ice game={game} label={`${pp ? `${ppT.name} power play, ${pp.skaters}. ` : ''}${(rink?.emptyNet || []).map((sd) => `${game[sd].name} net empty. `).join('')}${last ? `Latest shot: ${last.text}` : 'Rink'}`}>
          {pp ? (
            <>
              {/* the short-handed team's end dims while it kills the penalty */}
              <path d={shortSide === 'away' ? `M${W / 2} 0 H${28 * K} A${28 * K} ${28 * K} 0 0 0 0 ${28 * K} V${H - 28 * K} A${28 * K} ${28 * K} 0 0 0 ${28 * K} ${H} H${W / 2} Z` : `M${W / 2} 0 H${W - 28 * K} A${28 * K} ${28 * K} 0 0 1 ${W} ${28 * K} V${H - 28 * K} A${28 * K} ${28 * K} 0 0 1 ${W - 28 * K} ${H} H${W / 2} Z`} fill="#0C1124" opacity="0.13" />
              <g className="ppchip" transform={`translate(${W / 2} ${H - 19})`}>
                <rect x="-84" y="-17" width="168" height="34" rx="9" fill={cc[pp.side].main} stroke="#0C1124" strokeWidth="2.4" />
                <text x="0" y="1" textAnchor="middle" dominantBaseline="central" fill={inkOn(cc[pp.side].main)} textLength={Math.min(146, (ppT.abbr.length + 11) * 10.5)} lengthAdjust="spacingAndGlyphs">{ppT.abbr} POWER PLAY</text>
                <text className="sk" x="0" y="-27" textAnchor="middle" dominantBaseline="central">{pp.skaters}</text>
              </g>
            </>
          ) : null}
          {(rink?.emptyNet || []).map((sd) => (
            <g key={'en' + sd} className="emptynet" transform={`translate(${netX(sd)} ${H / 2})`}>
              <circle r="26" fill="none" stroke="#E0263C" strokeWidth="3" strokeDasharray="6 5" />
              <g transform={`translate(${sd === 'away' ? 46 : -46} -44)`}><rect x="-50" y="-12" width="100" height="24" rx="7" fill="#E0263C" stroke="#0C1124" strokeWidth="2.2" /><text textAnchor="middle" dominantBaseline="central" y="1" fill="#fff">EMPTY NET</text></g>
            </g>))}
          {bigSave ? <g key={'sv' + ice.length} transform={`translate(${netX(bigSave) + (bigSave === 'away' ? 10 : -10)} ${H / 2})`}>{[0, 0.25].map((dl) => <circle key={dl} className="savering" r="14" fill="none" stroke={cc[bigSave].main} strokeWidth="4" style={{ animationDelay: `${dl}s` }} />)}</g> : null}
          {goalSide ? (
            <g key={'gl' + (g3.id || g3.clock)} className="goallamp" transform={`translate(${(goalSide === 'away' ? 189 : 11) * K} ${H / 2 - 62}) scale(1.7)`}>
              <circle r="16" fill="#FF1F3D" className="halo" />
              <path d="M-7 5 V-1 A7 7 0 0 1 7 -1 V5 Z" fill="#FF1F3D" stroke="#0C1124" strokeWidth="1.8" />
              <rect x="-9" y="5" width="18" height="4" rx="1.5" fill="#0C1124" />
            </g>
          ) : null}
          {last ? (
            <g key={ice.length} className="pop">
              {last.kind === 'goal'
                ? <><rect x={X(last.x) - 11} y={Y(last.y) - 11} width="22" height="22" fill="#FFBE2E" stroke="#0C1124" strokeWidth="2.4" transform={`rotate(45 ${X(last.x)} ${Y(last.y)})`} /><circle cx={X(last.x)} cy={Y(last.y)} r="5" fill={lc} stroke="#0C1124" strokeWidth="1.6" /></>
                : last.kind === 'save' ? <><circle cx={X(last.x)} cy={Y(last.y)} r="10" fill="#fff" stroke={lc} strokeWidth="4" /><circle cx={X(last.x)} cy={Y(last.y)} r="3.5" fill="#0C1124" /></>
                : missed(X(last.x), Y(last.y), lc, 8, 4)}
            </g>
          ) : null}
        </Ice>
        <div className="feed inl">
          {recent.slice(0, 4).map((p, i) => <FeedRow key={p.id || i} p={p} game={game} L={L} />)}
          {onAll ? <button className="more" onClick={onAll}>Full Play by Play ›</button> : null}
        </div>
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
// Play filters, by sport: the same kinds the ice chart and shot chart sort by.
const PLAY_KINDS = {
  hockey: [['goal', 'Goals', /\bgoal\b/i], ['shot', 'Shots', /shot/i], ['hit', 'Hits', /\bhit\b/i], ['block', 'Blocks', /blocked/i], ['take', 'Takeaways', /takeaway/i], ['give', 'Giveaways', /giveaway/i], ['pen', 'Penalties', /penalty/i], ['fo', 'Faceoffs', /face ?off/i]],
  basketball: [['made', 'Made', /\bmakes?\b|\bmade\b/i], ['miss', 'Missed', /\bmiss/i], ['reb', 'Rebounds', /rebound/i], ['to', 'Turnovers', /turnover|steal/i], ['foul', 'Fouls', /foul/i]],
};
function PlayByPlay({ pbp, game, L }) {
  const periods = [...new Set(pbp.map((p) => p.period))].sort((a, b) => a - b);
  const [per, setPer] = useState(null);
  const [show, setShow] = useState(true);
  const [kind, setKind] = useState('all');
  const [teamOn, flipTeam] = useToggles([game.away.id, game.home.id]);
  const cur = per ?? 0; // All periods unless one is picked
  const live = game.state === 'live';
  const kinds = (PLAY_KINDS[L.sport] || []).filter(([, , re]) => pbp.some((p) => re.test(`${p.type} ${p.text}`)));
  const kre = kinds.find(([k]) => k === kind)?.[2];
  const teamFilter = teamOn.size < 2;
  let rows = pbp.filter((p) => (cur === 0 || p.period === cur) && (!kre || kre.test(`${p.type} ${p.text}`)) && (!teamFilter || teamOn.has(p.teamId)));
  if (live) rows = [...rows].reverse();
  const reg = L.periods || 4, word = PERIOD_WORD[L.sport] ?? '';
  const label = (p) => (!p ? 'Game' : p <= reg || L.sport === 'baseball' ? (L.sport === 'baseball' ? String(p) : perName(L, p)) : periods.filter((x) => x > reg).length > 1 ? `OT${p - reg}` : 'OT');
  const team = (id) => (id === game.home.id ? game.home : id === game.away.id ? game.away : null);
  return (
    <section className="sec">
      <div className="sechead"><H2>Play-by-Play</H2><button className="link" aria-expanded={show} onClick={() => setShow(!show)}>{show ? 'Hide' : `Show ${pbp.length} plays`}</button></div>
      {show ? (
        <>
          {kinds.length ? <div className="chips" role="group" aria-label="Plays to show" style={{ marginTop: 8 }}>
            {kinds.map(([k, t]) => <button key={k} className="chipb" aria-pressed={kind === k} onClick={() => setKind(kind === k ? 'all' : k)}>{t}</button>) /* nothing picked shows every play; tap a picked one again to go back */}
          </div> : null}
          {/* Periods (with All) on the left, the two teams on the right of the same row. */}
          <div className="pbprow">
            {periods.length > 1 ? <div className="chips" role="group" aria-label="Period">{[0, ...periods].map((p) => <button key={p} className="chipb" aria-pressed={cur === p} onClick={() => setPer(p)}>{p === 0 ? 'All' : label(p)}</button>)}</div> : <span />}
            {kinds.length ? <div className="chips tchips" role="group" aria-label="Teams">
              {[game.away, game.home].map((t) => <button key={t.id} className="chipb tchip" aria-pressed={teamOn.has(t.id)} aria-label={`${t.name} plays`} onClick={() => flipTeam(t.id)}><Blob team={t} size={22} /></button>)}
            </div> : null}
          </div>
          <div className="card feed">
            {rows.length ? rows.map((p, i) => <FeedRow key={p.id || i} p={p} game={game} L={L} />) : <p className="stamp" style={{ padding: '16px' }}>Nothing that matches in this {L.sport === 'hockey' ? 'period' : 'stretch'}.</p>}
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
                    <tr><th scope="row" className="who">{(() => {
                      // Full name, free to wrap, but the last name and position stay together on one line.
                      const words = String(r.name || '').split(' '), lastW = words.pop(), firstW = words.join(' ');
                      const body = <>{firstW ? `${firstW} ` : ''}<span className="nowrap">{lastW}{r.pos ? <small className="bpos">{'\u00a0'}{r.pos}</small> : null}</span></>;
                      return r.id && linkPlayers ? <button className="plink" onClick={() => go(`player/${game.lg}/${r.id}`)}>{body}</button> : body;
                    })()}</th>{r.stats.map((v, j) => <td key={j} className={gr.labels[j] === '+/-' ? (parseFloat(v) > 0 ? 'up' : parseFloat(v) < 0 ? 'down' : undefined) : undefined}>{pct1(gr.labels[j], v)}<Pct label={gr.labels[j]} v={v} skip={gr.labels.some((l) => /PCT|%/i.test(l))} /></td>)}</tr>
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

// Replay: a finished game played back as if live, one play at a time, so every live view and animation can be watched.
const REPLAY_SPORTS = new Set(['football', 'basketball', 'hockey']);
function ReplayPage({ lg, id, start = 0 }) {
  const L = LEAGUE[lg];
  const q = useQuery(`summary:${lg}:${id}`, () => getSummary(lg, id), () => 0);
  const steps = useMemo(() => (q.data ? replaySteps(q.data, L.sport) : []), [q.data]);
  const moments = useMemo(() => replayMoments(steps, L.sport), [steps]);
  const [i, setI] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const n = steps.length;
  useEffect(() => {
    if (!playing || !n) return undefined;
    const h = setInterval(() => setI((x) => { if (x >= n - 1) { setPlaying(false); return x; } return x + 1; }), (L.sport === 'football' ? 3000 : 1800) / speed);
    return () => clearInterval(h);
  }, [playing, speed, n]);
  const feed = useMemo(() => (q.data && n ? gameFromSummary(lg, id, replayCut(q.data, L.sport, i)) : null), [q.data, i, n]);
  const nextMoment = moments.find((m) => m > i);
  const prevMoment = [...moments].reverse().find((m) => m < i);
  const [tucked, setTucked] = useState(false);
  const playBtn = <button className="go" onClick={() => setPlaying((x) => !x)} aria-label={playing ? 'Pause' : 'Play'}><RIcon k={playing ? 'pause' : 'play'} size={16} /></button>;
  // The remote: a slim bar by default, or tucked into a small pill (still with play/pause) so the field has room.
  const bar = !n ? null : tucked ? (
    <div className="replaybar tucked" role="group" aria-label="Replay controls">
      {playBtn}
      <button className="rbopen" onClick={() => setTucked(false)} aria-label="Show replay controls">
        <b>Replay</b><span>{i + 1}/{n}</span><RIcon k="up" size={12} />
      </button>
    </div>
  ) : (
    <div className="replaybar" role="group" aria-label="Replay controls">
      <div className="rbtop">
        <input type="range" min="0" max={n - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} aria-label="Jump to a play" />
        <span>{i + 1}/{n}</span>
      </div>
      <div className="rbrow">
        <button onClick={() => { setPlaying(false); setI(prevMoment ?? 0); }} disabled={i === 0} aria-label="Previous big moment"><RIcon k="prevBig" size={15} /></button>
        <button onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)); }} disabled={i === 0} aria-label="Back one play"><RIcon k="back" size={15} /></button>
        {playBtn}
        <button onClick={() => { setPlaying(false); setI((x) => Math.min(n - 1, x + 1)); }} disabled={i >= n - 1} aria-label="Forward one play"><RIcon k="fwd" size={15} /></button>
        <button onClick={() => { setPlaying(false); if (nextMoment != null) setI(nextMoment); }} disabled={nextMoment == null} aria-label="Next big moment"><RIcon k="nextBig" size={15} /></button>
        <button className="spd" onClick={() => setSpeed((x) => (x === 1 ? 3 : x === 3 ? 6 : 1))} aria-label="Playback speed">{speed}x</button>
        <button className="hide" onClick={() => setTucked(true)} aria-label="Hide replay controls"><RIcon k="down" size={14} /></button>
      </div>
    </div>
  );
  if (!REPLAY_SPORTS.has(L.sport)) return <GamePage lg={lg} id={id} />;
  if (q.loading && !q.data) return <><SubHeader title="Replay" /><Page><Loading rows={5} /></Page></>;
  if (q.error && !q.data) return <><SubHeader title="Replay" /><Page><Problem error={q.error} retry={q.reload} /></Page></>;
  if (!n) return <><SubHeader title="Replay" /><Page><Empty>This game has no play-by-play to replay.</Empty></Page></>;
  return <GamePage lg={lg} id={id} feed={feed} replayBar={bar} />;
}

// The compact score that rides in the game page header while you scroll: both teams, the score, the clock,
// and for football the down, distance and who has the ball. Tap it to jump back to the top.
function MiniScore({ g, L, onTap }) {
  const live = g.state === 'live';
  const has = (t) => live && g.poss && g.poss === t.id;
  const side = (t, right) => (
    <span className={'ms-side' + (right ? ' r' : '')}>
      <Blob team={t} size={26} radius={8} />
      <b style={String(t.score).length > 2 ? { fontSize: 17 } : undefined} className={'ms-sc' + (live || g.state !== 'final' || Number(t.score) >= Number((right ? g.away : g.home).score) ? '' : ' lose')}>{t.score}</b>
      {has(t) ? <span className="ms-pos" aria-label={`${t.abbr} ball`} /> : null}
    </span>
  );
  return (
    <button className="miniscore" onClick={onTap} aria-label={`${g.away.abbr} ${g.away.score}, ${g.home.abbr} ${g.home.score}, ${statusLabel(g)}. Back to top.`}>
      {side(g.away, false)}
      <span className="ms-mid">
        {/* "4:20 - 4th" stacks into two short lines so three-digit scores have room on either side. */}
        {(() => { const st = shortStatus(statusLabel(g)), m = /^(.+?)\s+-\s+(.+)$/.exec(st); return m ? <span className={'ms-clk two' + (live ? ' live' : '')}><span>{m[1]}</span><span>{m[2]}</span></span> : <span className={'ms-clk' + (live ? ' live' : '')}>{st}</span>; })()}
        {g.down ? <span className="ms-sit">{g.down} · {g.spot}</span> : null}
      </span>
      {side(g.home, true)}
    </button>
  );
}

// Replay controls, drawn rather than typed: iPhones turn ▶ ◀ ⏮ ⏭ into color emoji.
const RICON = {
  play: 'M7 4.5 L19.5 12 L7 19.5 Z',
  pause: 'M6.5 4.5 H10.5 V19.5 H6.5 Z M13.5 4.5 H17.5 V19.5 H13.5 Z',
  back: 'M17 4.5 L4.5 12 L17 19.5 Z',
  fwd: 'M7 4.5 L19.5 12 L7 19.5 Z',
  prevBig: 'M4.5 4.5 H7.5 V19.5 H4.5 Z M20 4.5 L8.5 12 L20 19.5 Z',
  nextBig: 'M16.5 4.5 H19.5 V19.5 H16.5 Z M4 4.5 L15.5 12 L4 19.5 Z',
  down: 'M5 8.5 L12 16 L19 8.5',
  up: 'M5 15.5 L12 8 L19 15.5',
};
function RIcon({ k, size = 18 }) {
  const line = k === 'up' || k === 'down';
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: '-0.15em' }}><path d={RICON[k]} fill={line ? 'none' : 'currentColor'} strokeLinejoin="round" strokeLinecap="round" stroke="currentColor" strokeWidth={line ? 3.2 : 1.2} /></svg>;
}

function GamePage({ lg, id, feed, replayBar }) {
  const L = LEAGUE[lg];
  const q0 = useQuery(feed ? null : `game:${lg}:${id}`, () => getGame(lg, id), (d) => gameRefresh(d?.game));
  const q = feed ? { data: feed, loading: false, error: null } : q0;
  // Today's scoreboard (the ticker keeps it fresh) settles the clock when the game feed gets stuck on a bad one.
  const today = useDay(0);
  const boardG = feed ? null : (today.data?.games || []).find((x) => x.lg === lg && String(x.id) === String(id));
  const d = q.data, g = pickClock(d?.game, boardG);
  const title = g ? `${replayBar ? 'Replay: ' : ''}${g.away.abbr} at ${g.home.abbr}` : L.name;
  const pair = usePairFit(g ? [g.away.name, g.home.name] : []);
  const started = g && (g.state === 'live' || g.state === 'final');
  const periods = g ? Math.max(g.home.lines.length, g.away.lines.length, g.state === 'live' ? (L.periods || 4) : 0) : 0;
  const [picked, setTab] = useSticky('tab', 'summary');
  // The big scoreboard: when it scrolls up under the tabs, the header shows a compact score instead of the title.
  const boardRef = useRef(null);
  const [mini, setMini] = useState(false);
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setMini(!e.isIntersecting && e.boundingClientRect.top < 80), { root: el.closest('.page'), threshold: 0, rootMargin: '-64px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [!!d]);
  // Only offer the sections this game actually has.
  const tabs = !d || !started ? [] : [
    ['summary', g.state === 'live' ? 'Live' : 'Summary'],
    d.drives.length ? ['drives', 'Drives'] : null,
    d.shots.length ? ['shots', 'Shot Chart'] : null,
    d.ice?.length ? ['ice', 'Ice Chart'] : null,
    d.pitch?.length ? ['pitch', 'Shot Map'] : null,
    d.pbp.length && !d.ice?.length && !d.shots.length ? ['plays', 'Plays'] : null, // hockey and hoops plays live under their charts
    d.box.length ? ['box', 'Box Score'] : null,
    d.stats.length ? ['stats', 'Team Stats'] : null,
  ].filter(Boolean);
  const tab = tabs.some(([k]) => k === picked) ? picked : 'summary';
  const perLabel = (i) => (i < (L.periods || 4) || L.sport === 'baseball' ? perName(L, i + 1) : periods - (L.periods || 4) > 1 ? `OT${i - (L.periods || 4) + 1}` : 'OT');
  return (
    <>
      <SubHeader title={title} miniOn={mini && started} mini={started ? <MiniScore g={g} L={L} onTap={() => boardRef.current?.closest('.page')?.scrollTo({ top: 0, behavior: 'smooth' })} /> : null} />
      <Page>
        {q.loading && !d ? <Loading rows={5} /> : q.error && !d ? <Problem error={q.error} retry={q.reload} /> : (
          <>
            <div className="board" ref={boardRef} style={{ background: `linear-gradient(rgba(12,17,36,.38), rgba(12,17,36,.5)), linear-gradient(115deg, ${g.away.color} 0 44%, ${g.home.color} 56% 100%)` }}>
              <div className="top">
                <span className="pill num" style={g.state === 'live' ? { background: 'var(--pink)', color: '#0C1124' } : g.state === 'final' ? { background: '#33281E', color: '#F8F2E7' } : { background: 'var(--teal)', color: '#0C1124' }}>
                  {g.state === 'live' ? <span className="dot" aria-hidden="true" style={{ background: '#0C1124', marginRight: 6 }} /> : null}{g.state === 'pre' ? 'UPCOMING' : statusLabel(g).toUpperCase()}
                </span>
                <LgTag lg={lg} />
              </div>
              <div className="grid">
                {[g.away, null, g.home].map((t, i) => t ? (
                  <button key={t.id} className="tm" onClick={() => go(`team/${lg}/${t.id}${g.season ? '/' + g.season : ''}`)} aria-label={`Open ${t.full}`}>
                    <span style={{ position: 'relative' }}><span style={{ display: 'inline-flex', borderRadius: 16, boxShadow: '0 0 0 2px #fff, 3px 3px 0 2px #0C1124' }}><Blob team={t} size={58} radius={16} /></span>{t.rank ? <b className="rtag brd" aria-label={`Ranked ${t.rank}`}>{t.rank}</b> : null}</span>
                    <span ref={i === 0 ? pair.a : pair.b} className="nm" style={pair.style}>{t.name}</span>
                    <span className="rc">{t.record}</span>
                  </button>
                ) : started ? <div key="s" className="score" style={String(g.away.score).length + String(g.home.score).length > 4 ? { fontSize: 30 } : undefined} aria-label={`${g.away.score} to ${g.home.score}`}>{g.away.score}<span style={{ opacity: 0.7 }}> · </span>{g.home.score}</div>
                  : <div key="s" className="when">{g.state === 'off' ? (g.statusText || 'Postponed') : <>{g.tbd ? 'TBD' : fmtTime(g.date)}<div style={{ fontSize: 12, color: '#fff', textShadow: 'none', fontStyle: 'normal', fontWeight: 800 }}>{fmtDate(g.date)}</div></>}</div>)}
              </div>
              {g.state !== 'final' && (g.tv?.national?.length || g.tv?.home?.length || g.tv?.away?.length) ? (
                <p className="htv">
                  <span className="tvb">TV</span>
                  {[g.tv.national[0] || '', g.tv.away.length ? `${g.away.abbr}: ${g.tv.away.join(', ')}` : '', g.tv.home.length ? `${g.home.abbr}: ${g.tv.home.join(', ')}` : ''].filter(Boolean).join('  ·  ')}
                </p>
              ) : null}
              {g.note || d.venue ? <p style={{ marginTop: 12, textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>{[g.note, d.venue].filter(Boolean).join(' · ')}</p> : null}
            </div>

            {tabs.length > 1 ? (
              <>
                <div className="gtabs" role="tablist" aria-label="Game sections">
                  {tabs.map(([k, label]) => <button key={k} role="tab" className="chipb" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
                  {!replayBar && g.state === 'final' && REPLAY_SPORTS.has(L.sport) ? <button className="chipb replaybtn" onClick={() => go(`replay/${lg}/${id}`)}><RIcon k="play" size={13} /> Replay</button> : null}
                </div>
              </>
            ) : null}

            {tab === 'summary' ? (
              <div className="gtab">
                <BreakClock lg={lg} game={g} lastWall={d.lastWall} />
                {g.state === 'live' && L.sport === 'hockey' && d.pbp.length ? <LiveRink ice={d.ice || []} pbp={d.pbp} game={g} L={L} rink={d.rink} onAll={() => { setTab(d.ice?.length ? 'ice' : 'plays'); window.scrollTo(0, 0); }} /> : null}
                {g.state === 'live' && L.sport === 'football' && d.drives.length ? <LiveField drives={d.drives} game={g} lg={lg} onAll={() => { setTab('drives'); window.scrollTo(0, 0); }} /> : null}
                {g.state === 'live' && L.sport === 'basketball' && d.pbp.length ? <LiveCourt pbp={d.pbp} game={g} L={L} lg={lg} onAll={() => { setTab(d.shots.length ? 'shots' : 'plays'); window.scrollTo(0, 0); }} /> : null}
                {started && periods > 0 ? (
                  <section className="card pad linesbox" style={{ marginTop: 12 }}>
                    <table className="lines">
                      <thead><tr><th scope="col"><span style={{ position: 'absolute', left: -9999 }}>Team</span></th>{Array.from({ length: periods }, (_, i) => <th scope="col" key={i}>{perLabel(i)}</th>)}<th scope="col">T</th></tr></thead>
                      <tbody>{[g.away, g.home].map((t) => <tr key={t.id}><td>{t.abbr}</td>{Array.from({ length: periods }, (_, i) => <td key={i}>{t.lines[i] ?? ''}</td>)}<td>{t.score}</td></tr>)}</tbody>
                    </table>
                  </section>
                ) : null}
                {d.chart ? <LeadChart chart={d.chart} game={g} L={L} /> : null}
                {d.plays.length ? (
                  <section className="sec">
                    <H2>Scoring</H2>
                    <div className="card pad">
                      {d.plays.map((p, i) => { const t = p.teamId === g.home.id ? g.home : p.teamId === g.away.id ? g.away : null; return (
                        <div className="prow" key={i}>
                          {t ? <Blob team={t} /> : <span style={{ width: 28 }} />}
                          <span className="txt">{p.kind ? <span className="kind" style={{ color: 'var(--yellow)' }}>{p.kind}</span> : null}{p.text}</span>
                          <span className="sc">{Number.isFinite(p.away) && Number.isFinite(p.home) ? `${p.away}-${p.home}` : ''}<small>{p.period ? perName(L, p.period) : ''} {p.clock}</small></span>
                        </div>); })}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
            {tab === 'drives' ? <div className="gtab solo"><Drives drives={d.drives} game={g} /></div> : null}
            {tab === 'shots' ? <div className="gtab solo"><ShotChart shots={d.shots} game={g} lg={lg} pbp={d.pbp} /></div> : null}
            {tab === 'ice' ? <div className="gtab solo"><IceChart ice={d.ice} events={d.iceEvents || []} game={g} pbp={d.pbp} L={L} /></div> : null}
            {tab === 'pitch' ? <div className="gtab solo"><PitchChart shots={d.pitch} game={g} /></div> : null}
            {tab === 'plays' ? <div className="gtab solo"><PlayByPlay pbp={d.pbp} game={g} L={L} /></div> : null}
            {tab === 'box' ? <div className="gtab solo"><BoxScore box={d.box} game={g} sport={L.sport} /></div> : null}
            {tab === 'stats' ? (
              <div className="gtab solo">
                <section className="sec">
                  <H2>Team Stats</H2>
                  <div className="card pad">
                    {[...d.stats, ...(() => {
                      // Share of the game each side spent ahead, from the score timeline (timed sports only; ties count for nobody).
                      const pts = d.chart?.stepped ? d.chart.points : null;
                      if (!pts || pts.length < 2) return [];
                      let a = 0, h = 0; pts.slice(0, -1).forEach((p, k) => { const dt = pts[k + 1].t - p.t; if (p.a > p.h) a += dt; else if (p.h > p.a) h += dt; });
                      const span = Math.max(1e-9, pts[pts.length - 1].t - pts[0].t), A = Math.round((a / span) * 100), Hh = Math.round((h / span) * 100);
                      return [{ label: 'Time Leading', away: `${A}%`, home: `${Hh}%`, awayN: A, homeN: Hh }];
                    })()].map((s, i) => { const barC = chartColors(g.away, g.home); const max = Math.max(s.awayN, s.homeN) || 1; return (
                      <div className="statrow" key={s.label}>
                        <div className="lab"><span>{s.label}</span></div>
                        {[[g.away, s.away, s.awayN, barC.away.main, s.awayPct, s.awayDet], [g.home, s.home, s.homeN, barC.home.main, s.homePct, s.homeDet]].map(([t, v, n, c, pc, det]) => (
                          <div className={det ? 'bar hasdet' : 'bar'} key={t.id}><span>{t.abbr}</span><span className="track"><span className="fill" style={{ display: 'block', width: `${Math.round((n / max) * 100)}%`, background: c, animationDelay: `${120 + i * 70}ms` }} /></span><span className="val">{pct1(s.label, v)}{pc ? <small> {pc}</small> : null}</span>{det ? <span className="det">{det}</span> : null}</div>
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
        {replayBar}
      </Page>
    </>
  );
}

// A team name under the scoreboard logo: narrows, then shrinks, until the whole name fits ("Kentucky", not "Kentuc...").
// Both team names on the game header share one size. They wrap to a second line before anything shrinks,
// and they shrink together only when a single word is too long for its column (or a name needs a third line).
function usePairFit(names) {
  const a = useRef(null), b = useRef(null);
  const steps = [[14, '112%'], [13, '100%'], [12, '100%'], [11, '87.5%']];
  const [i, setI] = useState(0);
  const [, redo] = useState(0);
  const key = names.join('|');
  useLayoutEffect(() => { setI(0); }, [key]);
  useEffect(() => {
    const again = () => { setI(0); redo((n) => n + 1); };
    let live = true, w = 0;
    document.fonts?.ready?.then(() => { if (live) again(); });
    window.addEventListener('resize', again);
    const box = a.current?.parentElement;
    const ro = box && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(([e]) => { const nw = Math.round(e.contentRect.width); if (w && nw !== w) again(); w = nw; }) : null;
    if (ro) ro.observe(box);
    return () => { live = false; window.removeEventListener('resize', again); ro?.disconnect(); };
  }, [key]);
  useLayoutEffect(() => {
    if (i >= steps.length - 1) return;
    const tooBig = (el) => el && (overflows(el, 0) || el.getBoundingClientRect().height > steps[i][0] * 1.12 * 2 + 3);
    if (tooBig(a.current) || tooBig(b.current)) setI(i + 1);
  });
  return { a, b, style: { fontSize: steps[i][0], fontStretch: steps[i][1], whiteSpace: 'normal', lineHeight: 1.12, overflowWrap: 'normal', textOverflow: 'clip' } };
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

/* ---------- Settings ---------- */
function Settings() {
  return (
    <>
      <LeagueSettings />
      <Appearance />
    </>
  );
}
// League order and on/off. Drag a row by its grip (or use the arrow keys on it) to move it.
function LeagueSettings() {
  const prefs = useLeaguePrefs();
  const list = orderLeagues(prefs);
  const [drag, setDrag] = useState(null); // { id, from, startY, dy, rowH }
  const to = drag ? Math.max(0, Math.min(list.length - 1, drag.from + Math.round(drag.dy / drag.rowH))) : -1;
  const move = (from, dest) => {
    if (from === dest) return;
    const ids = list.map((l) => l.id);
    const [x] = ids.splice(from, 1); ids.splice(dest, 0, x);
    setLeagueOrder(ids);
  };
  const down = (e, i, id) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id, from: i, startY: e.clientY, dy: 0, rowH: e.currentTarget.closest('.setrow').getBoundingClientRect().height });
  };
  const moveP = (e) => { if (drag) setDrag({ ...drag, dy: e.clientY - drag.startY }); };
  const up = () => { if (drag) { move(drag.from, to); setDrag(null); } };
  const shift = (i) => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < to && i > drag.from && i <= to) return -drag.rowH;
    if (to < drag.from && i >= to && i < drag.from) return drag.rowH;
    return 0;
  };
  const offCount = (prefs.off || []).length;
  return (
    <section className="sec">
      <H2>Leagues</H2>
      <div className={'card setlist' + (drag ? ' dragging' : '')}>
        {list.map((l, i) => {
          const on = isLeagueOn(l.id, prefs);
          const me = drag?.id === l.id;
          return (
            <div key={l.id} className={'setrow' + (me ? ' lift' : '')} style={{ transform: `translateY(${me ? drag.dy : shift(i)}px)` }}>
              <button className="grip" aria-label={`Move ${l.name}, ${i + 1} of ${list.length}. Use arrow keys.`}
                onPointerDown={(e) => down(e, i, l.id)} onPointerMove={moveP} onPointerUp={up} onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => { if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); move(i, i - 1); } if (e.key === 'ArrowDown' && i < list.length - 1) { e.preventDefault(); move(i, i + 1); } }}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
              </button>
              <span className="blob" aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 10, background: l.color, color: '#0C1124', opacity: on ? 1 : 0.4, fontStretch: l.short.length > 4 ? '100%' : undefined, fontSize: l.short.length > 4 ? 8 : l.short.length > 3 ? 9 : 10 }}>{l.short}</span>
              <span className="nm" style={{ opacity: on ? 1 : 0.55 }}>{l.name}</span>
              <button className="switch" role="switch" aria-checked={on} aria-label={`Show ${l.name} on Scores and the ticker`} onClick={() => toggleLeague(l.id)} disabled={on && list.length - offCount <= 1}><span /></button>
            </div>
          );
        })}
      </div>
      {(prefs.order || []).length || offCount ? <div style={{ textAlign: 'center', marginTop: 12 }}><button className="link" onClick={resetLeagues}>Reset to default</button></div> : null}
    </section>
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
        {[['dark', 'Dark'], ['light', 'Light'], ['system', 'Device Settings']].map(([k, label]) => <button key={k} aria-pressed={t === k} onClick={() => pick(k)}>{label}</button>)}
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
            <Empty>Type a team, player or league.</Empty>
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
