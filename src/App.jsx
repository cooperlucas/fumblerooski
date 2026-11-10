import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LEAGUES, LEAGUE } from './data/leagues.js';
import { getStandings, getTeam, getGame, getScoreboard, getTeams, getRoster, getPlayer, searchPlayers, ensureColors, onColors, pctOf, PCT_COLS } from './data/espn.js';
import { useQuery, useDay, useFavs, toggleFav, favKey, isFavGame, sortGames, dayOffset, loadAllTeams, isDemo, setDemo, demoLocked } from './data/store.js';
import { chartColors, inkOn } from './data/colors.js';
import { go, useRoute, Blob, LgTag, H2, GameRow, Loading, Problem, Empty, Stamp, RootHeader, SubHeader, TabBar, DemoBar, statusLabel, fmtDate, fmtTime } from './ui.jsx';

/* ---------- router ---------- */
const ROOTS = new Set(['', 'scores', 'leagues']);

export default function App() {
  const parts = useRoute();
  const [, repaint] = useState(0);
  useEffect(() => onColors(() => repaint((n) => n + 1)), []);
  const [name = '', a, b] = parts;
  const root = ROOTS.has(name);
  let title = '', body, tab = name;
  if (name === '') body = <Home />;
  else if (name === 'scores') body = <Scores />;
  else if (name === 'leagues') body = <Leagues />;
  else if (name === 'league' && LEAGUE[a]) { title = LEAGUE[a].name; tab = 'leagues'; body = <LeaguePage key={a + (b || '')} lg={a} focus={b} />; }
  else if (name === 'team' && LEAGUE[a] && b) { tab = 'leagues'; body = <TeamPage key={a + b} lg={a} id={b} />; }
  else if (name === 'player' && LEAGUE[a] && b) { tab = 'leagues'; body = <PlayerPage key={a + b} lg={a} id={b} />; }
  else if (name === 'game' && LEAGUE[a] && b) { tab = 'scores'; body = <GamePage key={a + b} lg={a} id={b} />; }
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
  const track = useRef(null);
  const [secs, setSecs] = useState(60);
  const groups = useMemo(() => {
    const rank = { live: 0, final: 1, pre: 2, off: 3 };
    return LEAGUES.map((l) => ({ l, games: (today.data?.games || []).filter((g) => g.lg === l.id).sort((a, b) => rank[a.state] - rank[b.state] || String(a.date).localeCompare(String(b.date))) })).filter((x) => x.games.length);
  }, [today.data]);
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

/* ---------- Home ---------- */
function Home() {
  const favs = useFavs();
  const favSet = useMemo(() => new Set(favs.map(favKey)), [favs]);
  const [lg, setLg] = useState('all');
  const today = useDay(0);
  const games = useMemo(() => sortGames(today.data?.games || [], favSet), [today.data, favSet]);
  const live = games.some((g) => g.state === 'live');

  if (today.loading && !today.data) return <Loading rows={5} />;
  if (today.error && !today.data) return <Problem error={today.error} retry={today.reload} />;

  const mine = games.filter((g) => isFavGame(g, favSet));
  const rest = games.filter((g) => !isFavGame(g, favSet));
  const leagues = LEAGUES.filter((l) => rest.some((g) => g.lg === l.id));
  const pick = leagues.some((l) => l.id === lg) ? lg : 'all';
  const list = pick === 'all' ? rest.slice(0, 12) : rest.filter((g) => g.lg === pick);

  return (
    <>
      {mine.length ? (
        <section className="sec">
          <H2>Your Teams</H2>
          <div className="card">{mine.map((g) => <GameRow key={g.lg + g.id} g={g} />)}</div>
        </section>
      ) : null}

      <section className="sec">
        <div className="sechead">
          <H2>Today</H2>
          {leagues.length > 1 ? (
            <label className="pick">
              <span style={{ position: 'absolute', left: -9999 }}>League</span>
              <select value={pick} onChange={(e) => setLg(e.target.value)}>
                <option value="all">All leagues</option>
                {leagues.map((l) => <option key={l.id} value={l.id}>{l.short}</option>)}
              </select>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </label>
          ) : null}
        </div>
        {list.length ? (
          <div className="card">{list.map((g) => <GameRow key={g.lg + g.id} g={g} showLg={pick === 'all'} />)}</div>
        ) : <Empty>{mine.length ? 'No other games on the board today.' : 'No games on the board today.'}</Empty>}
        {pick === 'all' && rest.length > list.length ? <div style={{ textAlign: 'center', marginTop: 12 }}><button className="link" onClick={() => go('scores')}>All {rest.length + mine.length} games</button></div> : null}
      </section>

      <Stamp at={today.updatedAt} live={live} />
    </>
  );
}

/* ---------- Scores ---------- */
const DAYS = [-3, -2, -1, 0, 1, 2, 3];
function Scores() {
  const [off, setOff] = useState(0);
  const [lg, setLg] = useState('all');
  const favs = useFavs();
  const favSet = useMemo(() => new Set(favs.map(favKey)), [favs]);
  const q = useDay(off);
  const all = q.data?.games || [];
  const leagues = LEAGUES.filter((l) => all.some((g) => g.lg === l.id));
  const pick = leagues.some((l) => l.id === lg) ? lg : 'all';
  return (
    <>
      <div className="chips" role="group" aria-label="Day">
        {DAYS.map((n) => { const d = dayOffset(n); return (
          <button key={n} className="daychip" aria-pressed={off === n} onClick={() => setOff(n)}>
            <b>{n === 0 ? 'TODAY' : d.toLocaleDateString([], { weekday: 'short' }).toUpperCase()}</b>
            <span>{d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
          </button>); })}
      </div>
      {leagues.length > 1 ? (
        <div className="chips" role="group" aria-label="League" style={{ marginTop: 8 }}>
          <button className="chipb" aria-pressed={pick === 'all'} onClick={() => setLg('all')}>All</button>
          {leagues.map((l) => <button key={l.id} className="chipb" aria-pressed={pick === l.id} onClick={() => setLg(l.id)}>{l.short}</button>)}
        </div>
      ) : null}
      {q.loading && !q.data ? <Loading rows={5} /> : q.error && !q.data ? <Problem error={q.error} retry={q.reload} /> : !all.length ? <Empty>No games on this day.</Empty> : (
        leagues.filter((l) => pick === 'all' || pick === l.id).map((l) => {
          const games = sortGames(all.filter((g) => g.lg === l.id), favSet);
          return (
            <div className="card" key={l.id}>
              <button className="lghead" onClick={() => go(`league/${l.id}`)}><b style={{ color: l.color }}>{l.name}</b><span>{games.length} {games.length === 1 ? 'game' : 'games'} ›</span></button>
              {games.map((g) => <GameRow key={g.id} g={g} showLg={false} />)}
            </div>
          );
        })
      )}
      <Stamp at={q.updatedAt} live={all.some((g) => g.state === 'live')} />
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
              <span className="blob" aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 12, background: l.color, color: '#0C1124', fontSize: l.short.length > 3 ? 9 : 11 }}>{l.short}</span>
              <span className="nm">{l.name}<span className="sub">{n ? `${n} ${n === 1 ? 'game' : 'games'} today` : season || 'No games today'}</span></span>
              <span className="chev" aria-hidden="true">›</span>
            </button>); })}
        </div>
      </section>
      <div style={{ textAlign: 'center', marginTop: 18 }}><button className="link" onClick={() => go('about')}>About Fumblerooski</button></div>
    </>
  );
}

function LeaguePage({ lg, focus }) {
  const L = LEAGUE[lg];
  const [tab, setTab] = useState('standings');
  const [by, setBy] = useState(null);
  const [all, setAll] = useState(false);
  const st = useQuery(`standings:${lg}`, () => getStandings(lg), () => 600000);
  useEffect(() => {
    if (!st.data) return;
    const groups = [...st.data.groups].sort((x, y) => y.rows.some((r) => r.team.id === String(focus)) - x.rows.some((r) => r.team.id === String(focus)));
    ensureColors(groups.flatMap((g) => g.rows.map((r) => r.team)), 36);
  }, [st.data, focus]);
  const sb = useQuery(`board:${lg}`, () => getScoreboard(lg), (d) => (d?.games?.some((g) => g.state === 'live') ? 30000 : 300000));
  return (
    <>
      <div className="seg" role="group" aria-label="View">
        <button aria-pressed={tab === 'standings'} onClick={() => setTab('standings')}>Standings</button>
        <button aria-pressed={tab === 'scores'} onClick={() => setTab('scores')}>Scores</button>
      </div>
      {tab === 'scores' ? (
        sb.loading && !sb.data ? <Loading /> : sb.error && !sb.data ? <Problem error={sb.error} retry={sb.reload} /> :
          sb.data.games.length ? <div className="card">{sb.data.games.map((g) => <GameRow key={g.id} g={g} showLg={false} />)}</div> : <Empty>No {L.short} games on the current slate.</Empty>
      ) : (
        st.loading && !st.data ? <Loading rows={6} /> : st.error && !st.data ? <Problem error={st.error} retry={st.reload} /> :
          !st.data.groups.length ? <Empty>No standings for {L.name} right now.</Empty> : (() => {
            const views = st.data.views || [{ id: 'conference', label: 'Conference', groups: st.data.groups }];
            const view = views.find((v) => v.id === by) || views[0];
            // Coming from a team page: show just that team's group, with the team lit up.
            const has = (gr) => gr.rows.some((r) => r.team.id === String(focus));
            const mine = focus && !all ? view.groups.filter(has) : [];
            const shown = mine.length ? mine : view.groups;
            return (<>
            {views.length > 1 ? (
              <div className="seg sub" role="group" aria-label="Group standings by">
                {views.map((v) => <button key={v.id} aria-pressed={v.id === view.id} onClick={() => setBy(v.id)}>{v.label}</button>)}
              </div>
            ) : null}
            {shown.map((gr, i) => (
              <div className="card" key={view.id + gr.name + i}>
                <div className="shead"><span className="nm">{gr.name}</span><span style={{ width: 56, textAlign: 'right' }}>REC</span><span style={{ width: 52, textAlign: 'right' }}>{gr.col2Label}</span></div>
                {gr.rows.map((r, j) => (
                  <button key={r.team.id} className={'srow' + (focus && r.team.id === String(focus) ? ' me' : '')} aria-current={focus && r.team.id === String(focus) ? 'true' : undefined} onClick={() => go(`team/${lg}/${r.team.id}`)}>
                    <span className="pos">{j + 1}</span><Blob team={r.team} /><span className="nm">{r.team.name}</span>
                    <span className="v">{r.overall}</span><span className="v2">{r.col2}</span>
                  </button>
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

/* ---------- Team ---------- */
function TeamPage({ lg, id }) {
  const q = useQuery(`team:${lg}:${id}`, () => getTeam(lg, id), () => 300000);
  const favs = useFavs();
  const t = q.data?.team;
  const pinned = t && favs.some((f) => favKey(f) === favKey(t));
  const sched = q.data?.schedule || [];
  const [view, setView] = useState('schedule');
  const ro = useQuery(view === 'roster' ? `roster:${lg}:${id}` : null, () => getRoster(lg, id), () => 0);
  const row = (g) => {
    const home = g.home.id === String(id), me = home ? g.home : g.away, them = home ? g.away : g.home;
    const fin = g.state === 'final', w = +me.score > +them.score, tie = +me.score === +them.score;
    return (
      <button key={g.id} className="lrow" onClick={() => go(`game/${lg}/${g.id}`)}>
        <Blob team={them} />
        <span className="nm">{home ? 'vs' : 'at'} {them.name}<span className="sub">{fmtDate(g.date)}</span></span>
        <span className="res">{fin ? (<><b style={{ background: w ? 'rgba(155,227,58,.16)' : '#232C50', color: w ? '#9BE33A' : '#CBD2EA' }}>{tie ? 'T' : w ? 'W' : 'L'}</b>{me.score}-{them.score}</>)
          : g.state === 'live' ? <span style={{ color: 'var(--pink)' }}>LIVE {me.score}-{them.score}</span>
            : g.state === 'off' ? <span style={{ color: 'var(--mute)' }}>{g.statusText || 'Postponed'}</span>
              : <span style={{ color: 'var(--teal)' }}>{g.tbd ? 'TBD' : fmtTime(g.date)}</span>}</span>
      </button>
    );
  };
  return (
    <>
      <SubHeader title={t ? t.full : LEAGUE[lg].name} />
      <Page>
        {q.loading && !q.data ? <Loading rows={6} /> : q.error && !q.data ? <Problem error={q.error} retry={q.reload} /> : (
          <>
            <div className="teamhero" style={{ background: `linear-gradient(rgba(12,17,36,.3), rgba(12,17,36,.55)), ${t.color}` }}>
              <Blob team={t} size={58} radius={16} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2>{t.full}</h2>
                <p>{[q.data.record, q.data.standing].filter(Boolean).join(' · ') || LEAGUE[lg].name}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className={'btn' + (pinned ? ' on' : '')} aria-pressed={pinned} onClick={() => toggleFav(t)} style={{ flex: 1 }}>{pinned ? 'Pinned to Home' : 'Pin to Home'}</button>
              <button className="btn" onClick={() => go(`league/${lg}/${id}`)}><LgTag lg={lg} /> Standings</button>
            </div>
            <div className="seg" role="group" aria-label="Team sections" style={{ marginTop: 14 }}>
              <button aria-pressed={view === 'schedule'} onClick={() => setView('schedule')}>Schedule</button>
              <button aria-pressed={view === 'roster'} onClick={() => setView('roster')}>Roster</button>
            </div>
            {view === 'schedule' ? (
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

/* ---------- Player ---------- */
const fmtShort = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }); };
function PlayerPage({ lg, id }) {
  const q = useQuery(`player:${lg}:${id}`, () => getPlayer(lg, id), () => 600000);
  const [tab, setTab] = useState('season');
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
                {d.summary.items.length ? <div className="tiles">{d.summary.items.map((x) => <div className="tile" key={x.label}><b>{x.value}</b><span>{x.label}</span></div>)}</div> : null}
                {season.map((c) => (
                  <div className="card pad" key={c.key + c.title} style={{ marginTop: 12 }}>
                    <div className="ptitle">{c.row.season} {c.title}</div>
                    <div className="kv">{c.labels.map((l, i) => <div key={i}><span>{l}</span><b>{c.row.stats[i] ?? ''}</b></div>)}</div>
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
                          {log.labels.map((_, j) => <td key={j}>{r.stats[j] ?? ''}</td>)}
                        </tr>
                      ))}
                      {sn.totals ? <tr className="tot"><th scope="row" className="who">Total</th>{log.labels.map((_, j) => <td key={j}>{sn.totals[j] ?? ''}</td>)}</tr> : null}
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
                      {c.rows.map((r, i) => <tr key={r.season + r.team + i}><th scope="row" className="who">{r.season}{r.team && r.team !== p.team?.abbr ? <small className="was"> {r.team}</small> : null}</th>{c.labels.map((_, j) => <td key={j}>{r.stats[j] ?? ''}</td>)}</tr>)}
                      {c.totals ? <tr className="tot"><th scope="row" className="who">Career</th>{c.labels.map((_, j) => <td key={j}>{c.totals[j] ?? ''}</td>)}</tr> : null}
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
            {ticks.map((v) => <g key={v}><path d={`M${x0} ${y(v)} H${x1}`} stroke={v === 0 ? '#3A4672' : '#232C50'} strokeWidth={v === 0 ? 2 : 1} /><text x={x0 - 6} y={y(v) + 3.5} textAnchor="end" className="ax">{v}</text></g>)}
            {chart.bounds.slice(0, -1).map((b, i) => <path key={i} d={`M${x(b)} ${y0} V${y1}`} stroke="#2C3762" strokeDasharray="2 4" />)}
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
                <span className="dres" style={{ color }}>{d.live ? <><span className="dot" aria-hidden="true" style={{ marginRight: 6 }} />On the field</> : (d.result || 'Drive')}</span>
                <span className="dsum">{[d.summary, d.startText ? `from ${d.startText}` : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="dwhen">{d.period ? `Q${d.period}` : ''} {d.clock}<i aria-hidden="true">{isOpen ? '▴' : '▾'}</i></span>
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

const Pct = ({ label, v, skip }) => { const p = !skip && PCT_COLS.has(label) ? pctOf(v, 0) : ''; return p ? <small className="pct"> {p}</small> : null; };
function BoxScore({ box, game, sport }) {
  const [side, setSide] = useState(0);
  const teams = [game.away, game.home];
  const cur = box[side];
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
                    <tr><th scope="row" className="who">{r.id ? <button className="plink" onClick={() => go(`player/${game.lg}/${r.id}`)}>{r.name}</button> : r.name}{r.pos ? <small> {r.pos}</small> : null}</th>{r.stats.map((v, j) => <td key={j} className={gr.labels[j] === '+/-' ? (parseFloat(v) > 0 ? 'up' : parseFloat(v) < 0 ? 'down' : undefined) : undefined}>{v}<Pct label={gr.labels[j]} v={v} skip={gr.labels.some((l) => /PCT|%/i.test(l))} /></td>)}</tr>
                  </React.Fragment>
                ))}
                {gr.totals ? <tr className="tot"><th scope="row" className="who">Team</th>{gr.totals.map((v, j) => <td key={j}>{v}<Pct label={gr.labels[j]} v={v} skip={gr.labels.some((l) => /PCT|%/i.test(l))} /></td>)}</tr> : null}
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
  const [picked, setTab] = useState('summary');
  // Only offer the sections this game actually has.
  const tabs = !d || !started ? [] : [
    ['summary', 'Summary'],
    d.drives.length ? ['drives', 'Drives'] : null,
    d.shots.length ? ['shots', 'Shot Chart'] : null,
    d.ice?.length ? ['ice', 'Ice Chart'] : null,
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
                    <span className="nm">{t.rank ? `${t.rank} ` : ''}{t.name}</span>
                    <span className="rc">{t.record}</span>
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
                          <div className="bar" key={t.id}><span>{t.abbr}</span><span className="track"><span className="fill" style={{ display: 'block', width: `${Math.round((n / max) * 100)}%`, background: c, animationDelay: `${120 + i * 70}ms` }} /></span><span className="val">{v}{pc ? <small> {pc}</small> : null}</span></div>
                        ))}
                      </div>); })}
                  </div>
                </section>
              </div>
            ) : null}

            {!started && g.state === 'pre' ? <Empty>Scoring and stats show up here once the game starts.</Empty> : null}
            <Stamp at={q.updatedAt} live={g.state === 'live'} />
          </>
        )}
      </Page>
    </>
  );
}

/* ---------- Search ---------- */
function Search() {
  const [text, setText] = useState('');
  const q = useQuery('teams:all', loadAllTeams, () => 0);
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
  useEffect(() => { ensureColors(hits, 12); }, [hits]);
  const leagues = term ? LEAGUES.filter((l) => l.name.toLowerCase().includes(term) || l.short.toLowerCase().includes(term)) : [];
  const TeamRow = ({ t }) => (
    <button className="lrow" onClick={() => go(`team/${t.lg}/${t.id}`)}>
      <Blob team={t} size={36} radius={10} /><span className="nm">{t.full || t.name}</span><LgTag lg={t.lg} />
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
            <Empty>Type a team, player or league. Open a team and tap Pin to put it on your Home screen.</Empty>
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
