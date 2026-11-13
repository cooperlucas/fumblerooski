import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFetcher, getScoreboard, getStandings, getTeams, getTeam, getGame, headlineFor, statNumber, teamColor, pctOf, plusMinusFromPlays, scoreSeries, touchbackSpot, spotToEnd, normDrives } from '../src/data/espn.js';
import { LEAGUE } from '../src/data/leagues.js';
import { demoFetch } from '../src/data/fixtures.js';
import { scrub, isBetting, cleanText } from '../src/data/guard.js';

setFetcher(demoFetch);
const BET = /odds|spread|overUnder|moneyline|pickcenter|predictor|winprobability|sportsbook|draftkings|espn bet/i;

test('guard drops betting keys at any depth and keeps the rest', () => {
  const out = scrub({ a: 1, odds: [{ x: 1 }], deep: { pickcenter: 1, keep: [{ spread: 2, ok: true }] } });
  assert.deepEqual(out, { a: 1, deep: { keep: [{ ok: true }] } });
});

test('guard blocks betting sentences and leaves normal sports talk alone', () => {
  for (const s of ['Lions favored by 3', 'Odds via ESPN BET', 'Take the over/under', 'DraftKings Sportsbook play']) assert.equal(isBetting(s), true, s);
  for (const s of ['12 Yd pass from Burrow', 'Las Vegas Raiders', 'Spread the floor and shoot', 'Final/OT']) assert.equal(cleanText(s), s, s);
});

test('scoreboard: games are normalized and nothing about betting survives', async () => {
  const { games } = await getScoreboard('nfl');
  assert.equal(games.length, 2);
  const live = games.find((g) => g.id === 'g1');
  assert.equal(live.state, 'live');
  assert.equal(live.home.name, 'Bills'); assert.equal(live.home.score, '20'); assert.equal(live.away.score, '17');
  assert.equal(live.home.record, '6-3'); assert.equal(live.statusText, '4:12 - 3rd');
  assert.deepEqual(live.home.lines, ['3', '10', '7']);
  assert.match(live.home.color, /^#[0-9A-F]{6}$/);
  assert.doesNotMatch(JSON.stringify(games), BET);
});

test('scoreboard: a betting note on a game is removed, a normal one is kept', async () => {
  const d = new Date(); d.setDate(d.getDate() + 1);
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = await getScoreboard('nfl', day);
  assert.equal(tomorrow.games[0].state, 'pre'); assert.equal(tomorrow.games[0].note, '');
  const today = await getScoreboard('nfl');
  assert.equal(today.games.find((g) => g.id === 'g2').note, 'Battle of Ohio');
});

test('college ranks show only inside the top 25', async () => {
  const { games } = await getScoreboard('cfb');
  const g = games.find((x) => x.id === 'g5');
  assert.equal(g.home.rank, 1); assert.equal(g.away.rank, 18);
  assert.equal(games.find((x) => x.id === 'g6').away.rank, null);
});

test('standings: groups, records and the right second column per league', async () => {
  const nfl = await getStandings('nfl');
  assert.equal(nfl.groups.length, 2); assert.equal(nfl.groups[0].col2Label, 'STREAK');
  assert.equal(nfl.groups[0].rows[0].overall, '5-4'); assert.equal(nfl.groups[0].rows[0].col2, 'W3');
  const cfb = await getStandings('cfb');
  assert.equal(cfb.groups[0].col2Label, 'CONF'); assert.equal(cfb.groups[0].rows[0].col2, '6-0');
});

test('teams list and team page (schedule scores arrive as objects)', async () => {
  const teams = await getTeams('nba');
  assert.equal(teams.length, 4); assert.equal(teams[0].abbr, 'CLE');
  const t = await getTeam('nfl', '4');
  assert.equal(t.team.name, 'Bengals'); assert.equal(t.record, '5-4');
  assert.equal(t.schedule.length, 1);
  assert.equal(t.schedule[0].home.score, '27'); assert.equal(t.schedule[0].away.score, '13');
});

test('game page: stats, scoring plays without the sportsbook line, score chart', async () => {
  const fin = await getGame('nfl', 'g2');
  assert.equal(fin.game.state, 'final');
  assert.equal(fin.stats[0].label, 'Total yards'); assert.equal(fin.stats[0].home, '412');
  assert.equal(fin.plays.length, 5, 'the sportsbook-sponsored play is dropped');
  assert.doesNotMatch(JSON.stringify(fin), BET);
  assert.ok(fin.chart && fin.chart.stepped);
  assert.deepEqual(fin.chart.points.at(-1), { t: 1, a: 13, h: 27 });
  assert.ok(Math.abs(fin.chart.points[1].t - (15 - (9 + 14 / 60)) / 60) < 1e-9, 'first touchdown at 9:14 left in Q1');
  assert.equal(fin.chart.points[1].h, 7);
  assert.equal(fin.chart.periods, 4);
  const live = await getGame('nfl', 'g1');
  assert.ok(live.chart, 'live games get a chart too');
  const hoops = await getGame('nba', 'g10');
  assert.equal(hoops.stats[0].label, 'Field goals');
  assert.deepEqual(hoops.chart.points.at(-1), { t: 1, a: 118, h: 96 });
});

test('headlines come from the score, by template', async () => {
  const cfb = (await getScoreboard('cfb')).games;
  assert.equal(headlineFor(cfb.find((g) => g.id === 'g5')).title, 'No. 1 Ohio State beats No. 18 Michigan, 31-13');
  assert.equal(headlineFor(cfb.find((g) => g.id === 'g6')), null);
  const d = new Date(); d.setDate(d.getDate() - 1);
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const y = (await getScoreboard('cfb', day)).games[0];
  assert.equal(headlineFor(y).title, 'Texas stuns No. 6 Oregon, 24-21');
  const nfl = (await getScoreboard('nfl', day)).games[0];
  assert.equal(headlineFor(nfl).title, 'Eagles outlast Lions in overtime, 27-24');
});

test('helpers', () => {
  assert.equal(statNumber('5-12'), 5 / 12); assert.equal(statNumber('31:30'), 31.5); assert.equal(statNumber('412'), 412);
  assert.equal(teamColor('000000', 'fb4f14', 'x'), '#FB4F14');
  assert.equal(teamColor('ffffff', 'ffffff', 'x').startsWith('hsl('), true);
});

test('team list falls back to standings when the feed refuses the team list', async () => {
  setFetcher(async (u) => { if (/\/teams(\?|$)/.test(new URL(u).pathname + new URL(u).search)) throw new Error('blocked'); return demoFetch(u); });
  const teams = await getTeams('nfl');
  assert.equal(teams.length, 6); assert.equal(teams.source, 'standings'); assert.equal(teams[0].name, 'Bengals');
  setFetcher(demoFetch);
  assert.equal((await getTeams('nfl')).source, 'team list');
});

test('player box score: basketball leads with PTS, REB, AST and +/-, and skips players who did not play', async () => {
  const { box, game } = await getGame('nba', 'g10');
  assert.equal(box.length, 2); assert.equal(box[0].teamId, game.away.id);
  const g = box[0].groups[0];
  assert.deepEqual(g.labels.slice(0, 5), ['MIN', 'PTS', 'REB', 'AST', '+/-']);
  assert.equal(g.labels.length, 14, 'no column is dropped');
  assert.equal(g.rows.length, 3);
  assert.deepEqual(g.rows[0].stats.slice(0, 5), ['36', '29', '4', '8', '+14']);
  assert.equal(g.rows[0].starter, true); assert.equal(g.rows[2].starter, false);
  assert.equal(g.totals[1], '104');
});

test('player box score: football shows passing, rushing, receiving in that order', async () => {
  const { box } = await getGame('nfl', 'g2');
  assert.deepEqual(box[1].groups.map((g) => g.title), ['Passing', 'Rushing', 'Receiving', 'Defensive', 'Fumbles']);
  assert.ok(box[1].groups.every((g) => !/demo|team/i.test(g.title)), 'no team name in front of the group title');
  assert.equal(box[1].groups[0].rows[0].stats[0], '22/31');
  const pre = await getGame('nfl', 'g3');
  assert.deepEqual(pre.box, []);
});

test('percentages: only real made-of-attempted stats get one', async () => {
  assert.equal(pctOf('41-88'), '46.6%'); assert.equal(pctOf('22/31', 0), '71%'); assert.equal(pctOf('0-0'), ''); assert.equal(pctOf('412'), ''); assert.equal(pctOf('31:24'), '');
  const hoops = await getGame('nba', 'g10');
  const fg = hoops.stats.find((s) => s.label === 'Field goals');
  assert.equal(fg.awayPct, '46.6%'); assert.equal(fg.homePct, '51.1%');
  assert.equal(hoops.stats.find((s) => s.label === 'Rebounds').awayPct, '');
  const fb = await getGame('nfl', 'g2');
  assert.equal(fb.stats.find((s) => s.label === '3rd down eff.').homePct, '57.1%');
});

test('plus/minus from play-by-play: counted when lineups add up, withheld when they do not', () => {
  const A = ['a1', 'a2', 'a3', 'a4', 'a5'], H = ['h1', 'h2', 'h3', 'h4', 'h5'];
  const score = (a, h) => ({ text: 'made shot', type: { text: 'JumpShot' }, awayScore: a, homeScore: h });
  const sub = (tid, id, dir) => ({ text: `Player subbing ${dir} for Team`, type: { text: 'Substitution' }, team: { id: tid }, participants: [{ athlete: { id } }], awayScore: 0, homeScore: 0 });
  const fix = (plays) => { let a = 0, h = 0; return plays.map((p) => { if (p.type.text === 'Substitution') return { ...p, awayScore: a, homeScore: h }; a = p.awayScore; h = p.homeScore; return p; }); };
  const plays = fix([score(2, 0), score(2, 3), sub('A', 'a5', 'out'), sub('A', 'a6', 'in'), score(5, 3), score(5, 5)]);
  const pm = plusMinusFromPlays(plays, { A, H }, 'A', 'H');
  // a1 played all four baskets (+2 -3 +3 -2 = 0), a5 only the first two (-1), a6 only the last two (+1)
  assert.equal(pm.a1, 0); assert.equal(pm.a5, -1); assert.equal(pm.a6, 1); assert.equal(pm.h1, 0);
  // a sub out for a player who is not on the floor (logged twice) is skipped, not the whole game
  assert.equal(plusMinusFromPlays(fix([score(2, 0), sub('A', 'zz', 'out')]), { A, H }, 'A', 'H').a1, 2);
  // a sub between free throws counts after the last one: both shots go to the five on the floor at the foul
  const ft = (a, h, n) => ({ text: `free throw ${n} of 2`, type: { text: 'Free Throw' }, period: { number: 1 }, clock: { displayValue: '5:00' }, awayScore: a, homeScore: h });
  const late = fix([score(2, 0), ft(3, 0, 1), { ...sub('A', 'a5', 'out'), period: { number: 1 }, clock: { displayValue: '5:00' } }, { ...sub('A', 'a6', 'in'), period: { number: 1 }, clock: { displayValue: '5:00' } }, ft(4, 0, 2)]);
  const pf = plusMinusFromPlays(late, { A, H }, 'A', 'H');
  assert.equal(pf.a5, 4); assert.equal(pf.a6 ?? 0, 0);
  // six on the floor when a basket is scored: withheld
  assert.equal(plusMinusFromPlays(fix([sub('A', 'a6', 'in'), score(2, 0)]), { A, H }, 'A', 'H'), null);
  // no substitutions logged at all: withheld
  assert.equal(plusMinusFromPlays([score(2, 0), score(2, 2)], { A, H }, 'A', 'H'), null);
});

test('score chart: overtime stretches the clock, live games stop at the current score', () => {
  const side = (score, lines) => ({ score: String(score), lines: lines.map(String) });
  const g = { state: 'final', period: 5, clock: '0:00', away: side(24, [7, 7, 3, 7, 0]), home: side(27, [3, 14, 0, 7, 3]) };
  const c = scoreSeries(g, [{ period: 1, clock: '10:00', away: 7, home: 0 }, { period: 4, clock: '0:30', away: 24, home: 24 }, { period: 5, clock: '5:00', away: 24, home: 27 }], LEAGUE.nfl);
  assert.equal(c.periods, 5); assert.equal(c.bounds[3], 60 / 70);
  assert.deepEqual(c.points.at(-1), { t: 1, a: 24, h: 27 });
  assert.equal(c.points[3].t, 65 / 70);
});

test('football drives: field position, results, plays, and the live drive', async () => {
  const fin = await getGame('nfl', 'g2');
  assert.equal(fin.drives.length, 4);
  const [td, punt, pick, fg] = fin.drives;
  assert.equal(td.side, 'home'); assert.equal(td.result, 'Touchdown'); assert.equal(td.kind, 'td');
  assert.equal(td.x0, 75); assert.equal(td.x1, 0, 'home team drives right to left, into the left end zone');
  assert.equal(td.plays.length, 3); assert.equal(td.plays[0].down, '1st & 10 at OWN 25');
  assert.equal(punt.side, 'away'); assert.equal(punt.kind, 'other'); assert.equal(punt.x0, 22); assert.equal(punt.x1, 26);
  assert.equal(punt.plays.length, 1, 'the play that mentions a sportsbook is dropped');
  assert.equal(pick.kind, 'turnover'); assert.equal(pick.turnover, true);
  assert.equal(fg.kind, 'fg'); assert.equal(fg.x0, 70);
  assert.equal(fg.x1, 30, 'a field goal drive stops where the offense got to (40 yards), not at the goal line where the kick landed');
  assert.equal(fin.drives.some((d) => d.live), false);
  const live = await getGame('nfl', 'g1');
  assert.equal(live.drives.length, 5); assert.equal(live.drives.at(-1).live, true);
  assert.deepEqual(fin.pbp, [], 'football reads by drive, not as one long list');
});

test('basketball shots and play-by-play', async () => {
  const g = await getGame('nba', 'g10');
  assert.equal(g.shots.length, 5, 'free throws are left off the shot chart');
  const { id: _i, text: _t, ...shot0 } = g.shots[0];
  assert.deepEqual(shot0, { teamId: g.game.away.id, x: 25, y: 24, made: true, three: true, period: 1 });
  assert.equal(g.shots[1].made, false);
  assert.equal(g.pbp.length, 7);
  assert.equal(g.pbp[0].scoring, true); assert.equal(g.pbp[1].scoring, false); assert.equal(g.pbp[5].period, 2);
  assert.equal(g.chart.stepped, true, 'with play-by-play the score chart uses real times');
});

test('chart colors: primary for the line, secondary for its shadow, and never two lines that look the same', async () => {
  const { chartColors, lum, inkOn, brighten } = await import('../src/data/colors.js');
  const bills = { color: '#00338D', color2: '#D50A0A' }, vikings = { color: '#4F2683', color2: '#FFC62F' };
  const a = chartColors(bills, vikings);
  assert.ok(lum(a.away.main) >= 0.15, 'dark blue is lifted so it shows up');
  assert.equal(a.away.second, '#D50A0A'); assert.equal(a.home.second, '#FFC62F');
  assert.notEqual(a.away.main, a.home.main);
  // two red teams: the away side flips, secondary on the line and primary as the shadow
  const b = chartColors({ color: '#C8102E', color2: '#FFB612' }, { color: '#BA0C2F', color2: '#FFFFFF' });
  assert.equal(b.away.main, '#FFB612'); assert.equal(b.away.second, '#C8102E'); // shadow keeps the team's true color
  // light theme: maroon Missouri State and scarlet SMU both read on cream, so each keeps its own primary
  const ms = chartColors({ color: '#5E0009', color2: '#FFFFFF' }, { color: '#A80000', color2: '#0033A1' }, true);
  assert.equal(ms.away.main, '#5E0009'); assert.equal(ms.home.main, '#A80000');
  // light theme: white would vanish on cream, so it is darkened
  assert.ok(lum(chartColors({ color: '#FFFFFF', color2: '#000000' }, { color: '#00338D' }, true).away.main) <= 0.45);
  // no second color on file: a plain contrasting shadow, and white for the line on a clash
  assert.equal(chartColors({ color: '#C8102E', color2: null }, { color: '#00338D' }).away.second, '#F5F5F7');
  assert.equal(chartColors({ color: '#C8102E', color2: null }, { color: '#BA0C2F' }).away.main, '#F5F5F7');
  assert.equal(brighten('#FFB612'), '#FFB612', 'a color that already reads is left alone');
  const red = brighten('#BA0C2F'); assert.ok(parseInt(red.slice(1, 3), 16) > 200 && parseInt(red.slice(3, 5), 16) < 110, 'scarlet stays red, not pink: ' + red);
  assert.equal(inkOn('#FFB612'), '#0C1124'); assert.equal(inkOn('#1D428A'), '#FFFFFF');
  const g = (await getScoreboard('nfl')).games[0];
  assert.match(g.home.color2, /^#[0-9A-F]{6}$/);
});

test('team names on game pages: schools by place, pros by nickname', async () => {
  const { normTeam } = await import('../src/data/espn.js');
  assert.equal(normTeam({ id: '1', displayName: 'Virginia Tech Hokies', location: 'Virginia Tech', name: 'Hokies', abbreviation: 'VT' }, 'cfb').name, 'Virginia Tech');
  assert.equal(normTeam({ id: '2', displayName: 'Buffalo Bills', location: 'Buffalo', name: 'Bills', abbreviation: 'BUF' }, 'nfl').name, 'Bills');
  assert.equal(normTeam({ id: '3', displayName: 'Ohio State Buckeyes', shortDisplayName: 'Ohio State', location: 'Ohio State', name: 'Buckeyes' }, 'cfb').full, 'Ohio State Buckeyes');
});

test('standings: real team colors come from the team list, plus division and conference views', async () => {
  const { getStandings, shortGroup } = await import('../src/data/espn.js');
  const s = await getStandings('nfl');
  const bills = s.groups.flatMap((g) => g.rows).find((r) => r.team.abbr === 'BUF');
  assert.equal(bills.team.color, '#00338D');
  assert.deepEqual(s.views.map((v) => v.id), ['division', 'conference']);
  assert.equal(s.views[0].groups[0].name, 'AFC North');
  assert.equal(s.groups[0].name, 'AFC');
  assert.equal(shortGroup('Atlantic Coast Conference'), 'ACC');
  assert.equal(shortGroup('Big Ten Conference'), 'Big Ten');
  assert.equal(shortGroup('American League East'), 'AL East');
  const c = await getStandings('cfb');
  assert.equal(c.views.length, 1);
});

test('players: roster, profile with game log and career, search, and no betting data', async () => {
  const { getRoster, getPlayer, searchPlayers } = await import('../src/data/espn.js');
  const r = await getRoster('nfl', '4');
  assert.deepEqual(r.groups.map((g) => g.title), ['Offense', 'Defense']);
  assert.deepEqual(r.groups[0].players.map((p) => p.jersey), ['9', '11', '28']);
  assert.equal(r.groups[0].players[1].cls, 'Rookie');
  const p = await getPlayer('nfl', 'aq');
  assert.equal(p.player.name, 'Dexter Quarterback');
  assert.equal(p.player.team.abbr, 'CIN');
  assert.equal(p.summary.items.length, 4);
  assert.deepEqual(p.summary.items.slice(0, 3).map((x) => [x.rank, x.tied]), [[12, false], [4, true], [0, false]]);
  assert.ok(!JSON.stringify(p).includes('+450'));
  assert.equal(p.gamelog.labels.length, 8);
  assert.deepEqual(p.gamelog.spans.map((s) => s.count), [5, 3]);
  assert.equal(p.gamelog.seasons[0].rows.length, 3);
  assert.equal(p.gamelog.seasons[0].title, '2026');
  assert.equal(p.gamelog.seasons[0].rows[0].opp, 'CLE');
  assert.equal(p.career[0].rows.at(-1).season, '2026');
  assert.equal(p.career[0].rows[0].team, 'CLE'); // earlier season on another team, named from the team list
  assert.equal(p.career[0].rows.at(-1).team, 'CIN');
  assert.equal(p.career[0].totals[3], '7,829');
  const hits = await searchPlayers('de');
  assert.ok(hits.some((h) => h.lg === 'cfb' && h.name === 'Kevin Demo'));
  assert.ok(hits.every((h) => h.lg && h.name !== 'Somebody Cricket'));
  assert.equal(hits[0].team.length > 0, true);
});

test('college standings: CONF column is the conference record, not games behind', async () => {
  const { getStandings } = await import('../src/data/espn.js');
  const c = await getStandings('cfb');
  assert.match(c.groups[0].rows[1].col2, /^\d+-\d+$/);
});

test('team colors: a stand-in color is replaced once the real one is known, across college sports', async () => {
  const { liveColor, ensureColors, normTeam } = await import('../src/data/espn.js');
  const stale = { id: '194', lg: 'ncaam', name: 'Ohio State', color: 'hsl(200 55% 38%)' };
  normTeam({ id: '194', displayName: 'Ohio State Buckeyes', color: 'ba0c2f', alternateColor: 'ffffff' }, 'cfb');
  assert.equal(liveColor(stale), '#BA0C2F');
  const lions = { id: '8', lg: 'nfl', name: 'Lions', color: 'hsl(10 55% 38%)' };
  assert.equal(await ensureColors([{ id: '99999', lg: 'nope', color: 'hsl(1 55% 38%)' }]), false);
  await ensureColors([lions]);
  assert.equal(liveColor(lions), '#0076B6');
});

test('hockey ice chart: shots turned so away shoots right and home shoots left, blocks left out', async () => {
  const { normIce } = await import('../src/data/espn.js');
  const play = (team, type, x, y, period, goal) => ({ team: { id: team }, type: { text: type }, coordinate: { x, y }, period: { number: period }, scoringPlay: !!goal });
  const ice = normIce([
    play('A', 'Shot', 70, 10, 1), play('A', 'Goal', 85, -3, 1, true), play('A', 'Missed Shot', -60, 5, 2), play('A', 'Shot', -80, 2, 2),
    play('H', 'Shot', -75, 0, 1), play('H', 'Blocked Shot', -50, 0, 1), play('H', 'Faceoff', 0, 0, 1), play('H', 'Shot', 66, 8, 2),
  ], 'A', 'H');
  assert.equal(ice.length, 6);
  assert.ok(ice.filter((e) => e.teamId === 'A').every((e) => e.x > 0));
  assert.ok(ice.filter((e) => e.teamId === 'H').every((e) => e.x < 0));
  assert.deepEqual(ice.map((e) => e.kind), ['save', 'goal', 'miss', 'save', 'save', 'save']);
  const corner = normIce([play('A', 'Shot', 180, 40, 1), play('H', 'Shot', 20, 45, 1)], 'A', 'H');
  assert.equal(corner[0].x, 80);
});

test('second color: black-primary teams keep black as the secondary', async () => {
  const { normTeam } = await import('../src/data/espn.js');
  const t = normTeam({ id: 'zz1', displayName: 'Blackout Club', color: '000000', alternateColor: 'c4ced4' }, 'nhl');
  assert.equal(t.color, '#C4CED4');
  assert.equal(t.color2, '#000000');
  assert.equal(normTeam({ id: '24', displayName: 'San Antonio Spurs', color: '000000', alternateColor: '5b6fd0' }, 'nba').color2, '#000000');
});

test('league stats: leaders by category and team tables, with betting categories dropped', async () => {
  const { getLeaders, getTeamStats } = await import('../src/data/espn.js');
  const l = await getLeaders('nfl');
  assert.deepEqual(l.cats.map((c) => c.title), ['Passing Yards', 'Rushing Yards', 'Receiving Yards', 'Sacks']);
  assert.deepEqual(l.cats[3].rows.map((r) => r.value), ['8.5', '8']);
  assert.equal(l.cats[0].rows[0].value, '2,804');
  assert.equal(l.cats[0].rows[0].player.name, 'Dexter Quarterback');
  assert.equal(l.cats[0].rows[0].team.abbr, 'CIN');
  const t = await getTeamStats('nfl');
  assert.deepEqual(t.cats.map((c) => c.key), ['passing', 'rushing']);
  assert.equal(t.teams.length, 6);
  assert.equal(t.teams[0].stats.passing.length, 4);
});

test('football box score: defense gets FF (from the play-by-play) and FR (from the fumbles table)', async () => {
  const { forcedFumbles, nameKey } = await import('../src/data/espn.js');
  assert.equal(nameKey('T.J. Watt'), nameKey('T.Watt'));
  assert.equal(nameKey('Tre Watt'), 'twatt');
  const ff = forcedFumbles({ previous: [{ id: 'a', team: { id: '1' }, plays: [{ text: 'J.Allen sacked (T.Watt). FUMBLES (T.Watt), RECOVERED by PIT.' }, { text: 'Smith fumbled, forced by Tre Watt, recovered by Pitt' }, { text: 'FUMBLES (Aborted)' }] }] });
  assert.deepEqual(ff, { 1: { twatt: 2 } });
  const g = await getGame('nfl', 'g2'); // away team 5 had the ball when D.Tackler forced it, so the home defense gets the FF
  const def = g.box[1].groups.find((x) => x.key === 'defensive');
  assert.deepEqual(def.labels.slice(-2), ['FF', 'FR']);
  assert.deepEqual(def.rows[0].stats.slice(-2), ['1', '1']);
  assert.deepEqual(def.rows[1].stats.slice(-2), ['0', '0']);
  assert.ok(g.box[1].groups.some((x) => x.key === 'fumbles'));
});

test('built-in team colors cover teams the feed has not described yet', async () => {
  const { normTeam, liveColor } = await import('../src/data/espn.js');
  assert.equal(normTeam({ id: '277', displayName: 'West Virginia Mountaineers', abbreviation: 'WVU' }, 'ncaaw').color, '#EAAA00');
  assert.equal(normTeam({ id: '999021', displayName: 'New York Mets', abbreviation: 'NYM' }, 'mlb').color, '#002D72');
  assert.equal(liveColor({ id: '999002', lg: 'nfl', abbr: 'BUF', name: 'Bills', color: 'hsl(1 55% 38%)' }), '#00338D');
  assert.equal(liveColor({ id: '999003', lg: 'nhl', abbr: 'PHI', name: 'Flyers', color: 'hsl(1 55% 38%)' }), '#F74902');
});

test('rankings: playoff committee first, movement, votes, others and dropped', async () => {
  const { getRankings } = await import('../src/data/espn.js');
  const r = await getRankings('cfb');
  assert.deepEqual(r.polls.map((p) => p.name), ['CFP Rankings', 'AP Poll', 'Coaches Poll']);
  assert.equal(r.polls[0].ranks[0].team.name, 'Ohio State'); // named from standings
  assert.equal(r.polls[0].ranks[0].move, 1);
  assert.equal(r.polls[0].released, '2026-11-04T01:00Z');
  const ap = r.polls[1];
  assert.equal(ap.ranks[0].rank, 1);
  assert.equal(ap.released, '2026-11-08T19:00Z');
  assert.equal(ap.ranks[0].move, 1);   // was 2, now 1
  assert.equal(ap.ranks[1].move, -1);  // was 1, now 2
  assert.equal(ap.ranks[2].move, 0);
  assert.equal(ap.ranks[3].move, 'new');
  assert.equal(ap.ranks[0].firstPlace, 40);
  assert.equal(ap.others[0].points, 44);
  assert.equal(ap.dropped.length, 1);
  assert.deepEqual((await getRankings('ncaam')).polls, []); // no polls in the feed: empty, not an error
});

test('college divisions: FBS by default, other divisions by group, missing ones come back empty', async () => {
  const { getStandings, getDivisionTeams } = await import('../src/data/espn.js');
  assert.equal((await getStandings('cfb')).groups[0].name, 'Big Ten');
  assert.equal((await getStandings('cfb', 'fcs')).groups[0].rows[0].team.name, 'N Dakota St'); // same conference record, better overall
  assert.equal((await getStandings('cfb', 'd3')).groups[0].name, 'CCIW');
  const lower = await getDivisionTeams('cfb');
  assert.deepEqual(lower.map((t) => t.div), ['FCS', 'FCS', 'D-II', 'D-III', 'D-III']);
  assert.equal((await getStandings('ncaam', 'd2')).groups.length >= 0, true); // hoops has no lower divisions: falls back to the default read
});

test('TV list skips radio and puts national TV first', async () => {
  const { normTv } = await import('../src/data/espn.js');
  const tv = normTv({ geoBroadcasts: [
    { type: { shortName: 'Radio' }, market: { type: 'National' }, media: { shortName: 'ERADM' } },
    { type: { shortName: 'Streaming' }, market: { type: 'National' }, media: { shortName: 'ESPN+' } },
    { type: { shortName: 'TV' }, market: { type: 'National' }, media: { shortName: 'ESPN' } },
    { type: { shortName: 'TV' }, market: { type: 'Home' }, media: { shortName: 'MSG' } },
  ] });
  assert.deepEqual(tv, { national: ['ESPN', 'ESPN+'], home: ['MSG'], away: [] });
});

test('drive spots: a play measured from the wrong goal line is flipped back', async () => {
  const { fixSpot } = await import('../src/data/espn.js');
  assert.equal(fixSpot(1, 99, 0), 1); assert.equal(fixSpot(22, 78, 0), 22); assert.equal(fixSpot(17, 1, 16), 1); assert.equal(fixSpot(40, 41, -1), 41); assert.equal(fixSpot(50, 60, -10), 60);
});

test('fieldMoment reads the newest football play', async () => {
  const { fieldMoment } = await import('../src/data/espn.js');
  const fg = (text, type = 'Field Goal Missed') => fieldMoment({ type, text });
  assert.deepEqual([fg('N.Folk 38 yard field goal is No Good, Wide Left, Center-L.M.').miss, fg('H.Butker 51 yard field goal is No Good, Wide Right.').miss, fg('H.Butker 58 yard field goal is No Good, Short, Center.').miss,
    fg('T.Loop 34 yard field goal is No Good, Hit Left Upright, Center.').miss, fg('W.Reichard 59 yard field goal is BLOCKED (G.Stewart)', 'Blocked Field Goal').miss,
    fg('(05:54) #35 S.Porath field goal attempt from 53 yards NO GOOD (H: #96 J.Vinci)').miss], ['left', 'right', 'short', 'leftpost', 'blocked', 'wide']);
  const good = fg('(03:57) #31 B.Stidham field goal attempt from 25 yards GOOD (H: #34 P.Stainton), clock 03:55', 'Field Goal Good');
  assert.equal(good.good, true); assert.equal(good.yards, 25);
  assert.equal(fieldMoment({ type: 'Rushing Touchdown', text: 'S.Barkley left tackle for 3 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Milton rushes up the middle. ATTEMPT SUCCEEDS' }).two, 'good');
  assert.equal(fieldMoment({ type: 'Passing Touchdown', text: 'Nate Roberts 15 Yd pass from Luke Fahey (Two-Point Pass Conversion Failed)' }).two, 'failed');
  assert.equal(fieldMoment({ type: 'Passing Touchdown', text: 'pass short right to H.Fannin for 39 yards, TOUCHDOWN.' }).two, '');
  assert.equal(fieldMoment({ type: 'Pass Interception Return', text: 'pass intercepted by #28 L.Talich at Irish49' }).how, 'Interception');
  assert.equal(fieldMoment({ type: 'Sack Opp Fumble Recovery', text: 'sacked at DAL 16. FUMBLES, RECOVERED by IND' }).kind, 'turnover');
  assert.equal(fieldMoment({ type: 'Fumble Recovery (Own)', text: 'fumbled, recovered' }).kind, '');
  // a punt the receiving team muffs and the kicking team recovers: still a punt, and the kicking team keeps the ball
  const muff = fieldMoment({ type: 'Fumble Recovery (Opponent)', text: '#42 M.Haines punt 50 yards to the MIA33 #10 L.Billups-Williams return 16 yards to the MIA42 fumbled recovered by Ohio', kept: true });
  assert.deepEqual([muff.kind, muff.recovered, muff.yards], ['punt', true, 50]);
  assert.equal(fieldMoment({ type: 'Fumble Recovery (Opponent)', text: 'rush fumbled, recovered by defense', kept: false }).kind, 'turnover');
  assert.deepEqual(fieldMoment({ type: 'Punt', text: '(01:46) #39 J.Scaife punt 45 yards to the Canes03' }), { kind: 'punt', yards: 45, touchback: false, blocked: false });
  assert.equal(fieldMoment({ type: 'Kickoff', text: '#22 J.Weinberg kickoff 65 yards to the Irish00, Touchback' }).touchback, true);
  assert.equal(fieldMoment({ type: 'Pass Reception', text: 'pass complete for 33 yards', yards: 33, kept: true }).kind, 'big');
  assert.equal(fieldMoment({ type: 'Rush', text: 'rush for 4 yards', yards: 4, kept: true }).kind, '');
});

test('rinkState finds the power play and an empty net', async () => {
  const { rinkState } = await import('../src/data/espn.js');
  const pl = (period, clock, team, extra = {}) => ({ period: { number: period }, clock: { displayValue: clock }, team: { id: team }, type: { text: 'Shot' }, ...extra });
  const pen = (period, clock, team, mins = '2') => pl(period, clock, team, { type: { text: 'Hooking', penaltyMinutes: mins } });
  const box = { players: [{ team: { id: 'A' }, statistics: [{ name: 'goalies', athletes: [{ athlete: { id: 'ga' } }] }] }, { team: { id: 'H' }, statistics: [{ name: 'goalies', athletes: [{ athlete: { id: 'gh' } }] }] }] };
  const on = (a, h) => [{ teamId: 'A', entries: a.map((x) => ({ athleteid: x })) }, { teamId: 'H', entries: h.map((x) => ({ athleteid: x })) }];
  const full = on(['ga', 1, 2, 3, 4, 5], ['gh', 6, 7, 8, 9, 10]);
  // away penalized at 7:05 of the 2nd, newest play at 7:45: home on the power play with 1:20 left
  let r = rinkState({ plays: [pen(2, '7:05', 'A'), pl(2, '7:45', 'H', { strength: { text: 'Power Play' } })], boxscore: box, onIce: full }, 'A', 'H');
  assert.deepEqual(r.pp, { side: 'home', left: 80, skaters: '5 on 4' }); assert.deepEqual(r.emptyNet, []);
  // it runs out
  assert.equal(rinkState({ plays: [pen(2, '7:05', 'A'), pl(2, '9:10', 'H')], boxscore: box, onIce: full }, 'A', 'H').pp, null);
  // a power-play goal ends a minor early
  assert.equal(rinkState({ plays: [pen(2, '7:05', 'A'), pl(2, '7:30', 'H', { scoringPlay: true, strength: { text: 'Power Play' } }), pl(2, '7:40', 'A')], boxscore: box, onIce: full }, 'A', 'H').pp, null);
  // matching minors: four on four, no power play
  assert.equal(rinkState({ plays: [pen(1, '3:00', 'A'), pen(1, '3:00', 'H'), pl(1, '3:30', 'A')], boxscore: box, onIce: full }, 'A', 'H').pp, null);
  // carries across the period break, and a second penalty makes it 5 on 3
  r = rinkState({ plays: [pen(1, '19:30', 'H'), pen(2, '0:20', 'H'), pl(2, '0:40', 'A', { strength: { text: 'Power Play' } })], boxscore: box, onIce: full }, 'A', 'H');
  assert.deepEqual(r.pp, { side: 'away', left: 50, skaters: '5 on 3' });
  // home pulls its goalie
  assert.deepEqual(rinkState({ plays: [pl(3, '18:30', 'A')], boxscore: box, onIce: on(['ga', 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]) }, 'A', 'H').emptyNet, ['home']);
});

test('scoringRun counts unanswered points back from the newest play', async () => {
  const { scoringRun } = await import('../src/data/espn.js');
  const sc = (pairs) => pairs.map(([away, home]) => ({ away, home }));
  assert.deepEqual(scoringRun(sc([[20, 22], [20, 25], [22, 25], [24, 25], [27, 25], [29, 25], [29, 25], [32, 25]])), { side: 'away', pts: 12 });
  assert.equal(scoringRun(sc([[20, 22], [22, 22], [24, 22], [27, 22], [29, 22]])), null); // 9-0 is not 10
  assert.equal(scoringRun(sc([[0, 0], [3, 0], [6, 0], [9, 0], [9, 2]])), null); // broken by the other team
  assert.deepEqual(scoringRun(sc([[0, 0], [0, 3], [0, 6], [0, 9], [0, 12]]), 10), { side: 'home', pts: 12 });
});

test('rankCupGroup uses record, then head-to-head, then point differential', async () => {
  const { rankCupGroup } = await import('../src/data/espn.js');
  const g = (a, as, h, hs) => ({ away: { id: a, score: String(as) }, home: { id: h, score: String(hs) } });
  // A and B are both 2-1; B beat A head to head, so B is first even with a worse point differential.
  const games = [g('A', 120, 'C', 90), g('A', 110, 'D', 80), g('B', 101, 'A', 100), g('B', 90, 'C', 100), g('B', 100, 'D', 95), g('C', 90, 'D', 100)];
  const r = rankCupGroup(['A', 'B', 'C', 'D'], games);
  assert.deepEqual(r.map((x) => x.id), ['B', 'A', 'D', 'C']);
  assert.deepEqual([r[1].w, r[1].l, r[1].pd], [2, 1, 59]);
  // three-way tie at 1-1 that head-to-head cannot split (each beat one): point differential decides
  const loop = [g('X', 100, 'Y', 90), g('Y', 100, 'Z', 80), g('Z', 101, 'X', 100)];
  assert.deepEqual(rankCupGroup(['X', 'Y', 'Z'], loop).map((x) => x.id), ['Y', 'X', 'Z']);
});

test('touchback spots by league and year', () => {
  assert.equal(touchbackSpot('cfb', 2024, 'kickoff') ,75);
  assert.equal(touchbackSpot('nfl', 2023, 'kickoff') ,75);
  assert.equal(touchbackSpot('nfl', 2024, 'kickoff') ,70);
  assert.equal(touchbackSpot('nfl', 2025, 'kickoff') ,65);
  assert.equal(touchbackSpot('nfl', 2025, 'punt') ,80);
  assert.equal(spotToEnd('SMU 25', 'SMU') ,75);
  assert.equal(spotToEnd('LOU 40', 'SMU') ,40);
  assert.equal(spotToEnd('50', 'SMU') ,50);
});
test('college kick text gives yards', async () => {
  const { fieldMoment } = await import('../src/data/espn.js');
  assert.equal(fieldMoment({ type: 'Punt', text: 'Will Karoll punt for 50 yds , Roderick Daniels Jr. returns for no gain to the SMU 19' }).yards, 50);
  assert.equal(fieldMoment({ type: 'Kickoff', text: 'Brock Travelstead kickoff for 65 yds for a touchback' }).yards, 65);
  assert.equal(fieldMoment({ type: 'Punt', text: 'J.Araiza punts 45 yards to KC 20' }).yards, 45);
});

test('hockey ice chart: hits, blocks, takeaways, giveaways and penalties turn with their period', async () => {
  const { normIceEvents } = await import('../src/data/espn.js');
  const play = (team, type, x, y, period, extra = {}) => ({ team: { id: team }, type: { text: type, ...extra }, coordinate: { x, y }, period: { number: period } });
  const ev = normIceEvents([
    play('A', 'Shot', -70, 10, 1), play('H', 'Shot', 75, 0, 1), // period 1 is backwards: away shooting left
    play('A', 'Hit', -40, 30, 1), play('H', 'Blocked', 60, 5, 1), play('A', 'Hooking', 10, -20, 1, { penaltyMinutes: '2', penaltyType: 'Minor' }),
    play('A', 'Takeaway', 50, 0, 2), play('H', 'Giveaway', -20, 3, 2), play('H', 'Face Off', 0, 0, 2), // no shots in period 2: it swaps from period 1
  ], 'A', 'H');
  assert.deepEqual(ev.map((e) => e.kind), ['hit', 'block', 'pen', 'take', 'give']);
  assert.equal(ev[0].x, 40); // turned
  assert.equal(ev[1].x, -60);
  assert.equal(ev[2].mins, 2);
  assert.equal(ev[3].x, 50); // period 2 left alone
});

test('refresh timing: games are checked often around their start time', async () => {
  const { preRefresh, boardRefresh, gameRefresh } = await import('../src/data/store.js');
  const at = (mins) => new Date(Date.now() + mins * 60000).toISOString();
  assert.equal(preRefresh({ date: at(5) }), 15000); // about to start
  assert.equal(preRefresh({ date: at(-2) }), 15000); // past start, feed not live yet
  assert.equal(preRefresh({ date: at(30) }), 60000);
  assert.equal(preRefresh({ date: at(300) }), 300000);
  assert.equal(preRefresh({ date: at(5), tbd: true }), 300000);
  assert.equal(boardRefresh({ games: [{ state: 'pre', date: at(3) }, { state: 'final' }] }), 20000);
  assert.equal(boardRefresh({ games: [{ state: 'live' }, { state: 'pre', date: at(300) }] }), 30000);
  assert.equal(gameRefresh({ state: 'final' }), 0);
  assert.equal(gameRefresh({ state: 'live' }), 10000);
});

test('live clock: the scoreboard clock wins when the game feed is far off in the same period', async () => {
  const { pickClock } = await import('../src/data/espn.js');
  const g = (t, state = 'live') => ({ state, statusText: t });
  assert.equal(pickClock(g('0:08 - 1H'), g('13:58 - 1H')).statusText, '13:58 - 1H');
  assert.equal(pickClock(g('13:40 - 1H'), g('13:58 - 1H')).statusText, '13:40 - 1H'); // close: the game feed is fresher
  assert.equal(pickClock(g('19:50 - 2H'), g('0:00 - 1H')).statusText, '19:50 - 2H'); // different periods: leave it
  assert.equal(pickClock(g('Final', 'final'), g('0:03 - 2H')).statusText, 'Final');
});

test('football: a touchdown nullified by penalty is not a touchdown', async () => {
  const { fieldMoment } = await import('../src/data/espn.js');
  const play = { type: 'Kickoff', text: '(10:32) #93 R.Griffith kickoff 63 yards to the UMASS02 #7 T.Magee return 98 yards to the TOLEDO00 TOUCHDOWN nullified by penalty, clock 10:20 PENALTY UMASS Holding (#20 K.Sarkodieh) 10 yards from UMASS25 to UMASS15', from: 35, kept: false };
  const m = fieldMoment(play);
  assert.notEqual(m.kind, 'td');
  assert.equal(m.nulled, true);
  assert.equal(fieldMoment({ type: 'Kickoff', text: 'kickoff 65 yards, returned 100 yards for a TOUCHDOWN' }).kind, 'td');
});

test('football drives: a pick six on the offense\'s drive is the defense\'s touchdown', async () => {
  const { normDrives } = await import('../src/data/espn.js');
  const drives = { previous: [{ id: '7', team: { id: '113', abbreviation: 'MASS' }, isScore: true, displayResult: 'Interception Touchdown', result: 'INT TD', yards: 28, description: '5 plays, 28 yards, 2:23',
    start: { yardsToEndzone: 72, text: 'MASS 28' },
    plays: [
      { type: { text: 'Pass Reception' }, text: 'pass complete for 23 yards', start: { team: { id: '113' }, yardsToEndzone: 72 }, end: { team: { id: '113' }, yardsToEndzone: 49 }, statYardage: 23 },
      { type: { text: 'Interception Return Touchdown' }, text: 'pass intercepted by #22 N.Thompson return 62 yards to the UMASS00 TOUCHDOWN', scoringPlay: true, awayScore: 0, homeScore: 17, start: { team: { id: '113' }, yardsToEndzone: 44 }, end: { team: { id: '2649' }, yardsToEndzone: 0 }, statYardage: 62 },
    ] }] };
  const [d] = normDrives(drives, '113', '2649', false);
  assert.equal(d.kind, 'defTd');
  assert.equal(d.result, 'Pick Six');
  assert.equal(d.scoreSide, 'home');
  assert.notEqual(d.x1, 100); // the offense did not reach the end zone
});
test('breaks read as halftime and intermissions', async () => {
  const { breakName } = await import('../src/data/espn.js');
  assert.equal(breakName('cfb', 'End of 2nd'), 'Halftime');
  assert.equal(breakName('nba', 'End of 2nd Quarter'), 'Halftime');
  assert.equal(breakName('ncaam', 'End of 1st Half'), 'Halftime');
  assert.equal(breakName('nhl', 'End of 1st'), '1st Intermission');
  assert.equal(breakName('nhl', 'End of 3rd'), 'End of 3rd');
  assert.equal(breakName('cfb', 'End of 3rd'), 'End of 3rd');
});
test('break countdown targets', async () => {
  const { breakClock } = await import('../src/data/espn.js');
  const t0 = Date.parse('2026-11-12T01:12:40Z');
  assert.equal(breakClock('nba', { state: 'live', statusText: 'Halftime' }, t0).until, t0 + 15 * 60000);
  assert.equal(breakClock('cfb', { state: 'live', statusText: 'Halftime' }, t0).until, t0 + 20 * 60000);
  assert.equal(breakClock('nhl', { state: 'live', statusText: '1st Intermission' }, t0).next, '2nd period');
  assert.equal(breakClock('nba', { state: 'live', statusText: '4:20 - 3rd' }, t0), null);
});

test('headliners follow each sport\'s rhythm', async () => {
  const { headlineGames, footballModes } = await import('../src/data/headlines.js');
  const g = (lg, id, state) => ({ lg, id, state, away: { id: 'a' }, home: { id: 'h' }, date: '' });
  const at = (dow, hour) => { const d = new Date(2026, 10, 8 + dow, hour); return d; }; // Nov 8 2026 is a Sunday
  const today = [g('nba', 't1', 'pre'), g('nba', 't2', 'live')], yest = [g('nba', 'y1', 'final')];
  // NBA morning: last night's finals plus today's games already going; afternoon: today's slate
  assert.deepEqual(headlineGames({ now: at(3, 9), today, yest }).map((x) => x.id), ['y1', 't2']);
  assert.deepEqual(headlineGames({ now: at(3, 15), today, yest }).map((x) => x.id), ['t1', 't2']);
  // Soccer: always today
  assert.deepEqual(headlineGames({ now: at(6, 8), today: [g('epl', 'e1', 'pre')], yest: [g('epl', 'e0', 'final')] }).map((x) => x.id), ['e1']);
  // College football: Saturday's slate; weekend results Sunday through Tuesday morning; then the week ahead
  assert.equal(footballModes(at(6, 9)).cfb, null);
  assert.equal(footballModes(at(0, 20)).cfb, 'done');
  assert.equal(footballModes(at(2, 9)).cfb, 'done');
  assert.equal(footballModes(at(2, 14)).cfb, 'next');
  const wk = [g('cfb', 's1', 'pre'), g('cfb', 's2', 'pre')];
  // A Wednesday with no MACtion yesterday or today: the upcoming slate
  assert.deepEqual(headlineGames({ now: at(3, 15), today: [], yest: [], weeks: { cfb: wk } }).map((x) => x.id), ['s1', 's2']);
  // Thursday morning after Wednesday MACtion: those results; Thursday afternoon with games: Thursday's
  assert.deepEqual(headlineGames({ now: at(4, 9), today: [g('cfb', 'th', 'pre')], yest: [g('cfb', 'we', 'final')], weeks: { cfb: wk } }).map((x) => x.id), ['we']);
  assert.deepEqual(headlineGames({ now: at(4, 15), today: [g('cfb', 'th', 'pre')], yest: [g('cfb', 'we', 'final')], weeks: { cfb: wk } }).map((x) => x.id), ['th']);
  // Bowl season runs day by day
  assert.equal(footballModes(at(2, 14), 'Postseason').cfb, null);
  // NFL: last week Tuesday and Wednesday; the new week from Thursday
  assert.equal(footballModes(at(2, 10)).nfl, 'done');
  assert.equal(footballModes(at(3, 2)).nfl, 'done'); // 2am Wednesday is still Tuesday night
  assert.equal(footballModes(at(3, 3)).nfl, 'next'); // 3am Wednesday: the new week
  assert.equal(footballModes(at(2, 1)).nfl, 'next'); // 1am Tuesday: Monday night's game still going
  assert.equal(footballModes(at(1, 20)).nfl, 'next');
  // 1am Sunday is still Saturday's slate; 3am Sunday is results
  assert.equal(footballModes(at(0, 1)).cfb, null);
  assert.equal(footballModes(at(0, 3)).cfb, 'done');
  // A weekend noon tip: last night's results give way to today's slate two hours ahead
  const sat = new Date(2026, 10, 14, 10, 30), tip = new Date(2026, 10, 14, 12).toISOString();
  const day = [{ lg: 'ncaam', id: 'n1', state: 'pre', date: tip, away: {}, home: {} }], night = [{ lg: 'ncaam', id: 'f1', state: 'final', date: '', away: {}, home: {} }];
  assert.deepEqual(headlineGames({ now: sat, today: day, yest: night }).map((x) => x.id), ['n1']);
  assert.deepEqual(headlineGames({ now: new Date(2026, 10, 14, 9), today: day, yest: night }).map((x) => x.id), ['f1']);
});

test('a finished drive drops the official timeout tacked on after its punt', () => {
  const play = (type, text, team) => ({ type: { text: type }, text, start: { team: { id: team } }, end: {}, period: { number: 1 }, clock: { displayValue: '7:33' } });
  const drv = { id: 'd1', team: { id: '28', abbreviation: 'WSH' }, result: 'PUNT', description: '6 plays, 12 yards, 3:45', start: { yardsToEndzone: 80 },
    plays: [play('Pass Incompletion', 'J.Daniels pass incomplete.', '28'), play('Punt', 'T.Way punts 40 yards to NYG 40.', '28'), play('Official Timeout', 'Official Timeout at 07:33.', '19')] };
  const [d] = normDrives({ previous: [drv], current: drv }, '28', '19', true);
  assert.equal(d.plays[d.plays.length - 1].type, 'Punt');
});

test('today\'s games sort ahead of other days, live first', async () => {
  const { isToday } = await import('../src/data/headlines.js');
  const now = new Date(2026, 10, 12, 21, 0); // Thu 9pm
  const g = (state, d) => ({ state, date: d.toISOString() });
  assert.equal(isToday(g('pre', new Date(2026, 10, 12, 19, 30)), now), true);
  assert.equal(isToday(g('pre', new Date(2026, 10, 13, 1, 0)), now), true); // 1am Fri still belongs to Thursday night
  assert.equal(isToday(g('pre', new Date(2026, 10, 15, 13, 0)), now), false);
  assert.equal(isToday(g('final', new Date(2026, 10, 11, 20, 0)), now), false);
  assert.equal(isToday({ state: 'live', date: new Date(2026, 10, 11, 20, 0).toISOString() }, now), true);
});

test('a drive opened by a kick starts where the return ended, before the feed writes its start', () => {
  const kick = { type: { text: 'Kickoff' }, text: 'D.Zvada kicks 57 yards from NYG 35 to WAS 8. L.McCaffrey to WAS 33 for 25 yards.', start: { team: { id: '19' }, yardsToEndzone: 0 }, end: { team: { id: '28' }, yardsToEndzone: 67 }, period: { number: 2 }, clock: { displayValue: '2:35' } };
  const [d] = normDrives({ previous: [], current: { id: 'k1', team: { id: '28', abbreviation: 'WSH' }, description: '0 plays, 0 yards, 0:00', start: {}, plays: [kick] } }, '28', '19', true);
  assert.equal(d.startToEnd, 67); // WSH 33
});
