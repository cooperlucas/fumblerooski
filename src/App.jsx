import React, { useMemo, useState } from 'react';
import { LEAGUES, LEAGUE } from './data/leagues.js';
import { getStandings, getTeam, getGame, getScoreboard, getTeams, headlineFor } from './data/espn.js';
import { useQuery, useDay, useFavs, toggleFav, favKey, isFavGame, sortGames, dayOffset, loadAllTeams, isDemo, setDemo, demoLocked } from './data/store.js';
import { go, useRoute, Blob, LgTag, H2, GameRow, Loading, Problem, Empty, Stamp, RootHeader, SubHeader, TabBar, DemoBar, statusLabel, fmtDate, fmtTime } from './ui.jsx';

/* ---------- router ---------- */
const ROOTS = new Set(['', 'scores', 'leagues', 'news']);

export default function App() {
  const parts = useRoute();
  const [name = '', a, b] = parts;
  const root = ROOTS.has(name);
  let title = '', body, tab = name;
  if (name === '') body = <Home />;
  else if (name === 'scores') body = <Scores />;
  else if (name === 'leagues') body = <Leagues />;
  else if (name === 'news') body = <Headlines />;
  else if (name === 'league' && LEAGUE[a]) { title = LEAGUE[a].name; tab = 'leagues'; body = <LeaguePage key={a} lg={a} />; }
  else if (name === 'team' && LEAGUE[a] && b) { tab = 'leagues'; body = <TeamPage key={a + b} lg={a} id={b} />; }
  else if (name === 'game' && LEAGUE[a] && b) { tab = 'scores'; body = <GamePage key={a + b} lg={a} id={b} />; }
  else if (name === 'search') { tab = ''; body = <Search />; }
  else if (name === 'about') { title = 'About'; tab = 'leagues'; body = <About />; }
  else { title = 'Not found'; body = <Empty>That page does not exist. <br /><button className="btn" onClick={() => go('')}>Go home</button></Empty>; }

  // Team, game and search screens draw their own header (they know the title or own the search box).
  const ownHeader = name === 'team' || name === 'game' || name === 'search';
  return (
    <div className="app">
      <DemoBar />
      {root ? <RootHeader /> : ownHeader ? null : <SubHeader title={title} />}
      {ownHeader ? body : <main className="page" key={parts.join('/')}><div className="enter">{body}</div></main>}
      <TabBar active={tab} />
    </div>
  );
}
const Page = ({ children }) => <main className="page"><div className="enter">{children}</div></main>;

/* ---------- Home ---------- */
function Home() {
  const favs = useFavs();
  const favSet = useMemo(() => new Set(favs.map(favKey)), [favs]);
  const today = useDay(0);
  const yest = useDay(-1);
  const games = useMemo(() => sortGames(today.data?.games || [], favSet), [today.data, favSet]);
  const stories = useStories(today.data, yest.data, favSet).slice(0, 4);
  const live = games.some((g) => g.state === 'live');

  if (today.loading && !today.data) return <Loading rows={5} />;
  if (today.error && !today.data) return <Problem error={today.error} retry={today.reload} />;

  const lineFor = (t) => {
    const g = games.find((x) => (x.home.id === t.id || x.away.id === t.id) && x.lg === t.lg);
    if (!g) return { text: 'No game today', bg: '#232C50', fg: '#CBD2EA', open: () => go(`team/${t.lg}/${t.id}`) };
    const me = g.home.id === t.id ? g.home : g.away, them = g.home.id === t.id ? g.away : g.home;
    const open = () => go(`game/${g.lg}/${g.id}`);
    if (g.state === 'live') return { text: `LIVE ${me.score}-${them.score}`, bg: 'rgba(255,61,127,.18)', fg: '#FF7AA6', open };
    if (g.state === 'final') { const w = +me.score > +them.score, tie = +me.score === +them.score; return { text: `${tie ? 'T' : w ? 'W' : 'L'} ${me.score}-${them.score}`, bg: w ? 'rgba(155,227,58,.16)' : '#232C50', fg: w ? '#9BE33A' : '#CBD2EA', open }; }
    return { text: `${statusLabel(g)} ${g.home.id === t.id ? 'vs' : 'at'} ${them.abbr}`, bg: 'rgba(34,211,214,.14)', fg: '#22D3D6', open };
  };

  return (
    <>
      {games.length ? (
        <div className="strip" aria-label="Today's scores">
          {games.slice(0, 14).map((g) => (
            <button key={g.lg + g.id} className="tick" onClick={() => go(`game/${g.lg}/${g.id}`)} aria-label={`${g.away.abbr} ${g.away.score} ${g.home.abbr} ${g.home.score} ${statusLabel(g)}`}>
              <span className="st" style={{ color: g.state === 'live' ? 'var(--pink)' : g.state === 'pre' ? 'var(--teal)' : 'var(--mute)' }}>{statusLabel(g).toUpperCase()}</span>
              {[g.away, g.home].map((t) => <span key={t.id} className="r"><span>{t.abbr}</span><span>{g.state === 'pre' ? '' : t.score}</span></span>)}
            </button>
          ))}
        </div>
      ) : null}

      <section className="sec">
        <H2>Your Teams</H2>
        {favs.length ? (
          <div className="teamrow">
            {favs.map((t) => { const l = lineFor(t); return (
              <button key={favKey(t)} className="teamcard" onClick={l.open} aria-label={`${t.name}: ${l.text}`}>
                <Blob team={t} size={44} radius={12} />
                <span className="nm">{t.name}</span>
                <span className="ln" style={{ background: l.bg, color: l.fg }}>{l.text}</span>
              </button>); })}
          </div>
        ) : (
          <Empty>Pin your teams and their games jump to the top.<br /><button className="btn on" onClick={() => go('search')}>Find a team</button></Empty>
        )}
      </section>

      <section className="sec">
        <div className="sechead"><H2>Today</H2><button className="link" onClick={() => go('scores')}>All scores</button></div>
        {games.length ? (
          <div className="card">{games.slice(0, 10).map((g) => <GameRow key={g.lg + g.id} g={g} />)}</div>
        ) : <Empty>No games on the board today.</Empty>}
      </section>

      {stories.length ? (
        <section className="sec">
          <div className="sechead"><H2>Headlines</H2><button className="link" onClick={() => go('news')}>All headlines</button></div>
          <div className="card">{stories.map((s) => <StoryRow key={s.key} s={s} />)}</div>
        </section>
      ) : null}
      <Stamp at={today.updatedAt} live={live} />
    </>
  );
}

/* ---------- Headlines: written from final scores by template. The AI writer replaces this later. ---------- */
function useStories(today, yest, favSet) {
  return useMemo(() => {
    const out = [];
    [[today, 'Today'], [yest, 'Yesterday']].forEach(([d, when], di) => (d?.games || []).forEach((g) => {
      const h = headlineFor(g); if (!h) return;
      out.push({ key: g.lg + g.id, g, when, title: h.title, score: (isFavGame(g, favSet) ? 100 : 0) + h.weight * 2 - di });
    }));
    return out.sort((a, b) => b.score - a.score);
  }, [today, yest, favSet]);
}
function StoryRow({ s }) {
  const L = LEAGUE[s.g.lg];
  return (
    <button className="story" onClick={() => go(`game/${s.g.lg}/${s.g.id}`)}>
      <span className="tag" style={{ background: L.color }}>{L.short}</span>
      <span style={{ flex: 1, minWidth: 0 }}><span className="t">{s.title}</span><span className="w">{s.when} · {s.g.statusText || 'Final'}</span></span>
    </button>
  );
}
function Headlines() {
  const favs = useFavs();
  const favSet = useMemo(() => new Set(favs.map(favKey)), [favs]);
  const today = useDay(0), yest = useDay(-1);
  const stories = useStories(today.data, yest.data, favSet);
  if ((today.loading || yest.loading) && !stories.length) return <Loading />;
  if (today.error && yest.error && !stories.length) return <Problem error={today.error} retry={() => { today.reload(); yest.reload(); }} />;
  return (
    <section className="sec">
      <H2>Headlines</H2>
      {stories.length ? <div className="card">{stories.map((s) => <StoryRow key={s.key} s={s} />)}</div> : <Empty>No final scores yet today or yesterday. Headlines show up as games end.</Empty>}
      <p className="stamp">Headlines are written straight from the final score. Full recaps are coming.</p>
    </section>
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

function LeaguePage({ lg }) {
  const L = LEAGUE[lg];
  const [tab, setTab] = useState('standings');
  const st = useQuery(`standings:${lg}`, () => getStandings(lg), () => 600000);
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
          !st.data.groups.length ? <Empty>No standings for {L.name} right now.</Empty> :
            st.data.groups.map((gr, i) => (
              <div className="card" key={gr.name + i}>
                <div className="shead"><span className="nm">{gr.name}</span><span style={{ width: 56, textAlign: 'right' }}>REC</span><span style={{ width: 52, textAlign: 'right' }}>{gr.col2Label}</span></div>
                {gr.rows.map((r, j) => (
                  <button key={r.team.id} className="srow" onClick={() => go(`team/${lg}/${r.team.id}`)}>
                    <span className="pos">{j + 1}</span><Blob team={r.team} /><span className="nm">{r.team.name}</span>
                    <span className="v">{r.overall}</span><span className="v2">{r.col2}</span>
                  </button>
                ))}
              </div>
            ))
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
              : <span style={{ color: 'var(--teal)' }}>{fmtTime(g.date)}</span>}</span>
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
              <button className="btn" onClick={() => go(`league/${lg}`)}><LgTag lg={lg} /> Standings</button>
            </div>
            <section className="sec">
              <H2>Schedule</H2>
              {sched.length ? <div className="card">{sched.map(row)}</div> : <Empty>{q.data.scheduleMissing ? 'The schedule did not load. Pull up the team again in a bit.' : 'No games on the schedule yet.'}</Empty>}
            </section>
          </>
        )}
      </Page>
    </>
  );
}

/* ---------- Game ---------- */
const TIPS = {
  'Total yards': 'Passing yards plus rushing yards. 100 yards is one full field, so 400 or more in a game is a big day.',
  'Passing yards': 'Yards gained on completed passes, including whatever the receiver picks up after the catch.',
  'Rushing yards': 'Yards gained running the ball. Teams that run well keep the clock moving.',
  '3rd down': 'Conversions out of attempts. Turning 3rd down into a fresh set of downs keeps drives alive. Around 40% is solid.',
  Turnovers: 'Times a team gave the ball away: interceptions and fumbles in football, bad passes and steals in basketball. Fewer is better.',
  'Time of possession': 'How long each team had the ball. More time usually means longer drives and a rested defense.',
  'Field goals': 'Shots made out of shots taken, not counting free throws. Making about half is really good.',
  '3-pointers': 'Threes made out of threes taken. Hitting 35% or better from deep is solid.',
  Rebounds: 'Grabbing the ball after a missed shot. More rebounds means more chances to score.',
  Assists: 'A pass that leads right to a made basket. Lots of assists means the team is sharing the ball.',
  'Shots on goal': 'Shots that would have gone in if the goalie had not stopped them.',
  'Power play goals': 'Goals scored with an extra skater, because the other team had someone in the penalty box.',
  'Faceoffs won': 'Who grabs the puck when the ref drops it to restart play. Winning faceoffs means more time with the puck.',
  Possession: 'The share of the game each team had the ball.',
};
const PERIOD_WORD = { football: 'Q', basketball: 'Q', hockey: 'P', soccer: 'H', baseball: '' };

function Momentum({ flow, game, L }) {
  const W = 320, H = 140, mid = 70, amp = 58;
  const x = (t) => 6 + t * (W - 12), y = (d) => mid - (d / flow.max) * amp;
  let line = `M${x(0)} ${y(0)}`;
  flow.points.forEach((p, i) => { if (i) line += ` H${x(p.t).toFixed(1)} V${y(p.d).toFixed(1)}`; });
  const area = `${line} H${x(1)} V${mid} H${x(0)} Z`;
  const n = flow.periods, segs = Array.from({ length: Math.min(n, L.periods || n) }, (_, i) => `${PERIOD_WORD[L.sport] ?? ''}${i + 1}`);
  const extra = n > segs.length;
  return (
    <section className="card pad" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <h2 className="wide ital" style={{ fontWeight: 900, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--teal)' }}>Momentum</h2>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mute)' }}>How the lead swung</span>
      </div>
      <div className="flowlab" style={{ marginTop: 12, color: 'var(--yellow)' }}>▲ {game.home.name} ahead</div>
      <div role="img" aria-label={`Lead over time. Final: ${game.away.name} ${game.away.score}, ${game.home.name} ${game.home.score}.`} style={{ marginTop: 4 }}>
        <svg className="flow" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <defs>
            <clipPath id="frTop"><rect x="0" y="0" width={W} height={mid} /></clipPath>
            <clipPath id="frBot"><rect x="0" y={mid} width={W} height={H - mid} /></clipPath>
          </defs>
          <path d={area} fill="#FFE135" fillOpacity="0.32" clipPath="url(#frTop)" />
          <path d={area} fill="#22D3D6" fillOpacity="0.32" clipPath="url(#frBot)" />
          {Array.from({ length: n - 1 }, (_, i) => <path key={i} d={`M${x((i + 1) / n)} 0 V${H}`} stroke="#2C3762" strokeDasharray="3 4" />)}
          <path d={`M0 ${mid} H${W}`} stroke="#3A4672" strokeWidth="1.5" strokeDasharray="3 4" />
          <path d={line} fill="none" stroke="#F5F5F7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <div className="flowlab" style={{ marginTop: 4, color: 'var(--teal)' }}>▼ {game.away.name} ahead</div>
      <div className="flowsegs">{segs.map((s) => <span key={s}>{s}</span>)}{extra ? <span>OT</span> : null}</div>
    </section>
  );
}

const COL_TIPS = {
  '+/-': 'Plus/minus: how many points the team outscored the other team by while this player was on the floor.',
  'C/ATT': 'Completions out of pass attempts.', TGTS: 'Targets: passes thrown to this player.', TFL: 'Tackles for loss.',
};
function BoxScore({ box, game, sport }) {
  const [side, setSide] = useState(0);
  const teams = [game.away, game.home];
  const cur = box[side];
  const hasBench = sport === 'basketball';
  const tips = [...new Set(cur.groups.flatMap((g) => g.labels))].filter((l) => COL_TIPS[l]);
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
                    <tr><th scope="row" className="who">{r.name}{r.pos ? <small> {r.pos}</small> : null}</th>{r.stats.map((v, j) => <td key={j} className={gr.labels[j] === '+/-' ? (parseFloat(v) > 0 ? 'up' : parseFloat(v) < 0 ? 'down' : undefined) : undefined}>{v}</td>)}</tr>
                  </React.Fragment>
                ))}
                {gr.totals ? <tr className="tot"><th scope="row" className="who">Team</th>{gr.totals.map((v, j) => <td key={j}>{v}</td>)}</tr> : null}
              </tbody>
            </table>
          </div>
        );
      }) : <Empty>No player stats for {teams[side].name} yet.</Empty>}
      {tips.length ? <p className="stamp" style={{ textAlign: 'left' }}>{tips.map((l) => <span key={l} style={{ display: 'block', marginTop: 4 }}><b style={{ color: 'var(--soft)' }}>{l}</b> {COL_TIPS[l]}</span>)}</p> : null}
    </section>
  );
}

function GamePage({ lg, id }) {
  const L = LEAGUE[lg];
  const q = useQuery(`game:${lg}:${id}`, () => getGame(lg, id), (d) => (d?.game?.state === 'live' ? 20000 : d?.game?.state === 'pre' ? 120000 : 0));
  const [tip, setTip] = useState(null);
  const d = q.data, g = d?.game;
  const title = g ? `${g.away.abbr} at ${g.home.abbr}` : L.name;
  const started = g && (g.state === 'live' || g.state === 'final');
  const periods = g ? Math.max(g.home.lines.length, g.away.lines.length) : 0;
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
                  : <div key="s" className="when">{g.state === 'off' ? (g.statusText || 'Postponed') : <>{fmtTime(g.date)}<div style={{ fontSize: 12, color: '#fff', textShadow: 'none', fontStyle: 'normal', fontWeight: 800 }}>{fmtDate(g.date)}</div></>}</div>)}
              </div>
              {g.note || d.venue ? <p style={{ marginTop: 12, textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>{[g.note, d.venue].filter(Boolean).join(' · ')}</p> : null}
            </div>

            {started && periods > 0 ? (
              <section className="card pad linesbox" style={{ marginTop: 16 }}>
                <table className="lines">
                  <thead><tr><th scope="col"><span style={{ position: 'absolute', left: -9999 }}>Team</span></th>{Array.from({ length: periods }, (_, i) => <th scope="col" key={i}>{perLabel(i)}</th>)}<th scope="col">T</th></tr></thead>
                  <tbody>{[g.away, g.home].map((t) => <tr key={t.id}><td>{t.abbr}</td>{Array.from({ length: periods }, (_, i) => <td key={i}>{t.lines[i] ?? ''}</td>)}<td>{t.score}</td></tr>)}</tbody>
                </table>
              </section>
            ) : null}

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

            {d.box.length ? <BoxScore box={d.box} game={g} sport={L.sport} /> : null}

            {d.stats.length ? (
              <section className="sec">
                <H2>Team Stats</H2>
                <div className="card pad">
                  {d.stats.map((s, i) => { const max = Math.max(s.awayN, s.homeN) || 1, open = tip === i, has = !!TIPS[s.label]; return (
                    <div className="statrow" key={s.label}>
                      <div className="lab"><span>{s.label}</span>{has ? <button className="q" aria-expanded={open} aria-label={open ? `Hide what ${s.label} means` : `What does ${s.label} mean?`} onClick={() => setTip(open ? null : i)}>?</button> : null}</div>
                      {[[g.away, s.away, s.awayN, 'var(--teal)'], [g.home, s.home, s.homeN, 'var(--yellow)']].map(([t, v, n, c]) => (
                        <div className="bar" key={t.id}><span>{t.abbr}</span><span className="track"><span className="fill" style={{ display: 'block', width: `${Math.round((n / max) * 100)}%`, background: c, animationDelay: `${120 + i * 70}ms` }} /></span><span className="val">{v}</span></div>
                      ))}
                      {open ? <p className="tip">{TIPS[s.label]}</p> : null}
                    </div>); })}
                </div>
              </section>
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
          <span style={{ position: 'absolute', left: -9999 }}>Search teams and leagues</span>
          <input id="search-box" autoFocus type="search" enterKeyHint="search" placeholder="Search teams and leagues" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </SubHeader>
      <Page>
        {!term ? (
          <>
            {favs.length ? <section className="sec"><H2>Your Teams</H2><div className="card">{favs.map((t) => <TeamRow key={favKey(t)} t={{ ...t, full: t.name }} />)}</div></section> : null}
            <Empty>Type a team or league. Open a team and tap Pin to put it on your Home screen.</Empty>
          </>
        ) : q.loading && !q.data ? <Loading /> : q.error && !q.data ? <Problem error={q.error} retry={q.reload} /> : !hits.length && !leagues.length ? <Empty>Nothing matches "{text.trim()}".</Empty> : (
          <>
            {leagues.length ? <div className="card">{leagues.map((l) => <button key={l.id} className="lrow" onClick={() => go(`league/${l.id}`)}><span className="blob" aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 10, background: l.color, color: '#0C1124', fontSize: 9 }}>{l.short}</span><span className="nm">{l.name}</span><span className="chev" aria-hidden="true">›</span></button>)}</div> : null}
            {hits.length ? <div className="card">{hits.map((t) => <TeamRow key={favKey(t)} t={t} />)}</div> : null}
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
    if (gameId) { try { const r = await getGame('nfl', gameId); push('Game page', true, `${r.game.away.abbr} at ${r.game.home.abbr}: ${r.stats.length} stat rows, ${r.plays.length} scoring plays`); } catch (e) { push('Game page', false, e.message); } }
    else push('Game page', false, 'No game on the slate to test with');
  };
  return (
    <>
      <section className="card pad" style={{ marginTop: 4 }}>
        <p className="prose"><b>Pure sports. No odds. No ads.</b> Scores, standings and schedules for the teams you care about, and nothing that tells you what to bet.</p>
        <p className="prose">Betting lines are stripped out before anything reaches your screen. Your pinned teams are saved on this device only. There are no accounts and no tracking.</p>
        <p className="prose">Headlines are written straight from the final score. Teams show as colors and abbreviations, not logos.</p>
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
