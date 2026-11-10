import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setFetcher, getScoreboard, getStandings, getTeams, getTeam, getGame, headlineFor, statNumber, teamColor } from '../src/data/espn.js';
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

test('game page: stats, scoring plays without the sportsbook line, momentum for finals only', async () => {
  const fin = await getGame('nfl', 'g2');
  assert.equal(fin.game.state, 'final');
  assert.equal(fin.stats[0].label, 'Total yards'); assert.equal(fin.stats[0].home, '412');
  assert.equal(fin.plays.length, 5, 'the sportsbook-sponsored play is dropped');
  assert.doesNotMatch(JSON.stringify(fin), BET);
  assert.ok(fin.flow && fin.flow.points.length >= 3);
  assert.equal(fin.flow.points.at(-1).d, 14);
  const live = await getGame('nfl', 'g1');
  assert.equal(live.flow, null);
  const hoops = await getGame('nba', 'g10');
  assert.equal(hoops.stats[0].label, 'Field goals');
  assert.ok(hoops.flow, 'basketball momentum falls back to quarter scores');
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
