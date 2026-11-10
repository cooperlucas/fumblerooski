// Demo data, shaped like the real feed, for demo mode and tests. Never shown without a DEMO banner.
// It deliberately carries betting fields and a sportsbook sentence so the tests can prove the guard strips them.

const T = {
  nfl: [
    ['4', 'Cincinnati Bengals', 'Bengals', 'CIN', 'fb4f14', '000000', '5-4'], ['5', 'Cleveland Browns', 'Browns', 'CLE', '472a08', 'ff3c00', '2-7'],
    ['12', 'Kansas City Chiefs', 'Chiefs', 'KC', 'e31837', 'ffb612', '7-2'], ['2', 'Buffalo Bills', 'Bills', 'BUF', '00338d', 'd50a0a', '6-3'],
    ['8', 'Detroit Lions', 'Lions', 'DET', '0076b6', 'bbbbbb', '7-2'], ['21', 'Philadelphia Eagles', 'Eagles', 'PHI', '06424d', '000000', '6-3'],
  ],
  cfb: [
    ['194', 'Ohio State Buckeyes', 'Ohio State', 'OSU', 'ba0c2f', 'ffffff', '9-0'], ['130', 'Michigan Wolverines', 'Michigan', 'MICH', '00274c', 'ffcb05', '7-2'],
    ['84', 'Indiana Hoosiers', 'Indiana', 'IU', '990000', 'ffffff', '9-0'], ['213', 'Penn State Nittany Lions', 'Penn State', 'PSU', '061440', 'ffffff', '6-3'],
    ['2483', 'Oregon Ducks', 'Oregon', 'ORE', '007030', 'fee11a', '8-1'], ['251', 'Texas Longhorns', 'Texas', 'TEX', 'c15d26', 'ffffff', '7-2'],
  ],
  nba: [
    ['5', 'Cleveland Cavaliers', 'Cavaliers', 'CLE', '860038', 'bc945c', '7-3'], ['18', 'New York Knicks', 'Knicks', 'NY', '1d428a', 'f58426', '6-3'],
    ['2', 'Boston Celtics', 'Celtics', 'BOS', '008348', 'ffffff', '5-5'], ['25', 'Oklahoma City Thunder', 'Thunder', 'OKC', '007ac1', 'ef3b24', '9-1'],
  ],
};
const SPORT = { 'college-football': 'cfb', nfl: 'nfl', nba: 'nba' };
const team = (lg, id) => { const r = T[lg].find((x) => x[0] === id); return { id: r[0], displayName: r[1], shortDisplayName: r[2], abbreviation: r[3], color: r[4], alternateColor: r[5] }; };
const rec = (lg, id) => T[lg].find((x) => x[0] === id)[6];

const iso = (dayOffset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

const STATUS = {
  pre: () => ({ period: 0, displayClock: '0:00', type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, shortDetail: 'Scheduled' } }),
  live: (period, clock, short) => ({ period, displayClock: clock, type: { name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, shortDetail: short } }),
  final: (short = 'Final') => ({ period: 4, displayClock: '0:00', type: { name: 'STATUS_FINAL', state: 'post', completed: true, shortDetail: short } }),
};

// id, league, day offset, hour, away, home, away score, home score, status, linescores, ranks
const GAMES = [
  ['g1', 'nfl', 0, 20, '12', '2', '17', '20', STATUS.live(3, '4:12', '4:12 - 3rd'), [[7, 3, 7], [3, 10, 7]]],
  ['g2', 'nfl', 0, 13, '5', '4', '13', '27', STATUS.final(), [[3, 7, 0, 3], [7, 10, 3, 7]]],
  ['g3', 'nfl', 1, 20, '21', '8', '', '', STATUS.pre(), null],
  ['g4', 'nfl', -1, 13, '8', '21', '24', '27', STATUS.final('Final/OT'), [[7, 7, 3, 7, 0], [3, 14, 0, 7, 3]]],
  ['g5', 'cfb', 0, 12, '130', '194', '13', '31', STATUS.final(), [[3, 7, 0, 3], [7, 10, 7, 7]], [18, 1]],
  ['g6', 'cfb', 0, 19, '213', '84', '', '', STATUS.pre(), null, [null, 2]],
  ['g7', 'cfb', -1, 15, '251', '2483', '24', '21', STATUS.final(), [[7, 3, 7, 7], [7, 7, 0, 7]], [null, 6]],
  ['g8', 'nba', 0, 19, '18', '5', '58', '61', STATUS.live(2, '0:00', 'Halftime'), [[30, 28], [33, 28]]],
  ['g9', 'nba', 0, 22, '2', '25', '', '', STATUS.pre(), null],
  ['g10', 'nba', -1, 19, '5', '2', '118', '96', STATUS.final(), [[31, 29, 30, 28], [22, 26, 25, 23]]],
];

function event(g) {
  const [id, lg, off, hour, a, h, as, hs, status, lines, ranks] = g;
  const side = (tid, homeAway, score, i) => ({
    id: tid, homeAway, team: team(lg, tid), score, winner: status.type.state === 'post' ? +score > +(homeAway === 'home' ? as : hs) : undefined,
    records: [{ name: 'overall', summary: rec(lg, tid) }],
    curatedRank: { current: ranks && ranks[i] ? ranks[i] : 99 },
    linescores: lines ? lines[i].map((v) => ({ value: v, displayValue: String(v) })) : [],
  });
  return {
    id, date: iso(off, hour), name: 'demo', status,
    competitions: [{
      id, date: iso(off, hour), status,
      competitors: [side(h, 'home', hs, 1), side(a, 'away', as, 0)],
      // Betting data the real feed carries. The guard must drop every bit of it.
      odds: [{ provider: { name: 'ESPN BET' }, details: 'BUF -2.5', overUnder: 47.5, spread: -2.5 }],
      notes: id === 'g2' ? [{ headline: 'Battle of Ohio' }] : id === 'g3' ? [{ headline: 'Lions favored by 3 at DraftKings Sportsbook' }] : [],
    }],
  };
}

function scoreboard(lg, dates) {
  const today = new Date();
  const games = GAMES.filter((g) => g[1] === lg).filter((g) => {
    if (!dates) return g[2] === 0;
    const d = new Date(today); d.setDate(d.getDate() + g[2]); return ymd(d) === dates;
  });
  return { leagues: [{ season: { type: { name: 'Regular Season' } } }], events: games.map(event) };
}

function standings(lg, level) {
  const entry = (r, i) => ({
    team: { id: r[0], displayName: r[1], shortDisplayName: r[2], abbreviation: r[3] }, // like the real feed: no colors here
    stats: [
      { name: 'wins', displayValue: r[6].split('-')[0] }, { name: 'losses', displayValue: r[6].split('-')[1] },
      { name: 'overall', displayValue: r[6], summary: r[6] }, { name: 'streak', displayValue: i % 2 ? 'L1' : 'W3' },
      { name: 'gamesBehind', displayName: 'Conference Games Back', displayValue: String(i) },
      { name: 'vsConf', displayName: 'Conference Record', displayValue: `${Math.max(0, +r[6].split('-')[0] - 3)}-${r[6].split('-')[1]}` },
    ],
  });
  const rows = T[lg], half = Math.ceil(rows.length / 2);
  const names = { nfl: ['American Football Conference', 'National Football Conference'], cfb: ['Big Ten Conference', 'Southeastern Conference'], nba: ['Eastern Conference', 'Western Conference'] }[lg];
  if (level === '3' && lg !== 'cfb') {
    const divs = lg === 'nfl' ? ['AFC North', 'AFC West', 'NFC North'] : ['Atlantic', 'Central'];
    const per = Math.ceil(rows.length / divs.length);
    return { name: lg, children: [{ name: names[0], children: divs.map((d, i) => ({ name: d, standings: { entries: rows.slice(i * per, (i + 1) * per).map(entry) } })) }] };
  }
  return {
    name: lg, children: [
      { name: names[0], standings: { entries: rows.slice(0, half).map(entry) } },
      { name: names[1], standings: { entries: rows.slice(half).map(entry) } },
    ],
  };
}

function teamsList(lg) { return { sports: [{ leagues: [{ teams: T[lg].map((r) => ({ team: team(lg, r[0]) })) }] }] }; }
function teamInfo(lg, id) { return { team: { ...team(lg, id), record: { items: [{ summary: rec(lg, id) }] }, standingSummary: '2nd in Division' } }; }
function schedule(lg, id) {
  const evs = GAMES.filter((g) => g[1] === lg && (g[4] === id || g[5] === id)).map(event).map((e) => {
    // The schedule endpoint sends scores as objects, not strings.
    e.competitions[0].competitors.forEach((c) => { if (c.score !== '') c.score = { value: +c.score, displayValue: String(c.score) }; else delete c.score; });
    return e;
  });
  return { team: team(lg, id), events: evs.sort((a, b) => a.date.localeCompare(b.date)) };
}

function summary(lg, id) {
  const g = GAMES.find((x) => x[0] === id && x[1] === lg);
  if (!g) return {};
  const ev = event(g), comp = ev.competitions[0];
  comp.competitors.forEach((c) => { c.record = [{ type: 'total', summary: rec(lg, c.id) }]; delete c.records; });
  const [, , , , a, h] = g;
  const fb = (y, p, r, t, to, top) => [
    { name: 'totalYards', label: 'Total Yards', displayValue: String(y) }, { name: 'netPassingYards', label: 'Passing', displayValue: String(p) },
    { name: 'rushingYards', label: 'Rushing', displayValue: String(r) }, { name: 'thirdDownEff', label: '3rd down efficiency', displayValue: t },
    { name: 'turnovers', label: 'Turnovers', displayValue: String(to) }, { name: 'possessionTime', label: 'Possession', displayValue: top },
  ];
  const bb = (fg, tp, reb, ast, to) => [
    { name: 'fieldGoalsMade-fieldGoalsAttempted', label: 'FG', displayValue: fg }, { name: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', label: '3PT', displayValue: tp },
    { name: 'totalRebounds', label: 'Rebounds', displayValue: String(reb) }, { name: 'assists', label: 'Assists', displayValue: String(ast) }, { name: 'turnovers', label: 'Turnovers', displayValue: String(to) },
  ];
  const started = g[8].type.state !== 'pre';
  const box = !started ? { teams: [] } : {
    teams: [
      { team: { id: a }, statistics: lg === 'nba' ? bb('41-88', '12-34', 40, 22, 13) : fb(288, 201, 87, '4-13', 2, '26:48') },
      { team: { id: h }, statistics: lg === 'nba' ? bb('46-90', '15-38', 47, 29, 9) : fb(412, 265, 147, '8-14', 0, '33:12') },
    ],
  };
  const ath = (id, name, pos, stats, starter) => ({ athlete: { id, displayName: name, shortName: name, position: { abbreviation: pos } }, starter, stats });
  if (started && lg === 'nba') {
    // Label order here is the feed's, not ours: the adapter has to move PTS, REB, AST and +/- up front.
    const labels = ['MIN', 'FG', '3PT', 'FT', 'OREB', 'DREB', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', '+/-', 'PTS'];
    const grp = (rows) => [{ names: labels, keys: labels, labels, athletes: rows, totals: ['', '41-88', '12-34', '10-12', '9', '31', '40', '22', '6', '4', '13', '18', '', '104'] }];
    box.players = [
      { team: { id: a }, statistics: grp([ath('p1', 'D. Guard', 'G', ['36', '10-19', '4-9', '5-5', '0', '4', '4', '8', '2', '0', '3', '2', '+14', '29'], true), ath('p2', 'D. Center', 'C', ['31', '7-10', '0-0', '2-4', '4', '9', '13', '2', '0', '3', '1', '4', '+9', '16'], true), ath('p3', 'D. Sixth', 'F', ['22', '4-9', '2-5', '0-0', '1', '3', '4', '1', '1', '0', '2', '1', '-3', '10'], false), { ...ath('p4', 'D. Bench', 'G', []), didNotPlay: true }]) },
      { team: { id: h }, statistics: grp([ath('p5', 'D. Wing', 'F', ['38', '9-21', '3-8', '4-4', '1', '6', '7', '5', '1', '1', '4', '3', '-12', '25'], true)]) },
    ];
  } else if (started) {
    const g3 = (name, labels, rows) => ({ name, text: `Demo Team ${name}`, labels, keys: labels, athletes: rows, totals: [] });
    const side = (q, r, w) => [
      g3('receiving', ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], [ath(w + 'w', 'D. Receiver', 'WR', ['7', '104', '14.9', '1', '32', '10'])]),
      g3('passing', ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], [ath(q + 'q', 'D. Quarterback', 'QB', ['22/31', '265', '8.5', '2', '0', '1-7', '71.2', '118.4'])]),
      g3('fumbles', ['FUM', 'LOST', 'REC'], [ath(q + 'f', 'D. Quarterback', 'QB', ['1', '0', '0']), ath(w + 'd', 'D. Tackler', 'LB', ['0', '0', '1'])]),
      g3('defensive', ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HTS', 'TD'], [ath(w + 'd', 'D. Tackler', 'LB', ['9', '6', '1', '2', '1', '2', '0']), ath(w + 's', 'S. Safety', 'S', ['5', '4', '0', '0', '2', '0', '0'])]),
      g3('rushing', ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], [ath(r + 'r', 'D. Back', 'RB', ['19', '96', '5.1', '1', '22'])]),
    ];
    box.players = [{ team: { id: a }, statistics: side('a', 'a', 'a') }, { team: { id: h }, statistics: side('h', 'h', 'h') }];
  }
  let plays = [];
  if (started && lg !== 'nba') {
    const [as, hs] = [+g[6], +g[7]];
    const mk = (per, clock, tid, text, type, A, H) => ({ text, type: { text: type }, period: { number: per }, clock: { displayValue: clock }, team: { id: tid }, awayScore: A, homeScore: H });
    plays = [
      mk(1, '9:14', h, 'Demo back 4 Yd Run (Kick good)', 'Rushing Touchdown', 0, 7),
      mk(1, '2:31', a, 'Demo kicker 38 Yd Field Goal', 'Field Goal Good', 3, 7),
      mk(2, '6:02', h, 'Demo receiver 22 Yd pass from Demo QB (Kick good)', 'Passing Touchdown', 3, 14),
      mk(2, '0:04', h, 'DraftKings Sportsbook play of the half: 44 Yd Field Goal', 'Field Goal Good', 3, 17),
      mk(3, '8:40', a, 'Demo back 12 Yd Run (Kick good)', 'Rushing Touchdown', Math.min(as, 10), 17),
      mk(4, '3:05', h, 'Demo receiver 9 Yd pass from Demo QB (Kick good)', 'Passing Touchdown', as, hs),
    ];
  }
  let drives, allPlays;
  if (started && lg !== 'nba') {
    const pl = (per, clock, text, down, s2e, e2e, extra = {}) => ({ text, period: { number: per }, clock: { displayValue: clock }, start: { downDistanceText: down, yardsToEndzone: s2e }, end: { yardsToEndzone: e2e }, awayScore: 0, homeScore: 0, ...extra });
    const dr = (did, tid, result, isScore, desc, per, clock, where, list) => ({ id: did, team: { id: tid }, displayResult: result, isScore, description: desc, start: { period: { number: per }, clock: { displayValue: clock }, text: where }, plays: list });
    const prev = [
      dr('d1', h, 'Touchdown', true, '8 plays, 75 yards, 4:10', 1, '13:24', 'OWN 25', [pl(1, '13:24', 'Demo back up the middle for 6 yards', '1st & 10 at OWN 25', 75, 69), pl(1, '12:50', 'Demo QB pass deep right to Demo receiver for 41 yards', '2nd & 4 at OWN 31', 69, 28), pl(1, '9:14', 'Demo back 4 Yd Run (Kick good)', '1st & Goal at 4', 4, 0, { scoringPlay: true, homeScore: 7 })]),
      dr('d2', a, 'Punt', false, '3 plays, 4 yards, 1:38', 1, '9:14', 'OWN 22', [pl(1, '9:14', 'Demo back left tackle for 3 yards', '1st & 10 at OWN 22', 78, 75), pl(1, '7:40', 'Demo punter punts 44 yards. Lions favored by 3 at DraftKings Sportsbook', '4th & 6 at OWN 26', 74, 74)]),
      dr('d3', a, 'Interception', false, '5 plays, 31 yards, 2:02', 2, '11:00', 'OWN 30', [pl(2, '11:00', 'Demo QB pass short left to Demo receiver for 12 yards', '1st & 10 at OWN 30', 70, 58), pl(2, '10:05', 'D.Quarterback sacked at DEM 38 for -4 yards (D.Tackler). FUMBLES (D.Tackler), recovered by DEM-D.Quarterback at DEM 36.', '1st & 10 at OPP 42', 42, 44), pl(2, '9:10', 'Demo QB pass intercepted', '2nd & 8 at OPP 41', 41, 39)]),
    ];
    prev.push(dr('d5', h, 'Field Goal', true, '6 plays, 40 yards, 2:30', 2, '2:34', 'OWN 30', [pl(2, '2:34', 'Demo back right guard for 5 yards', '1st & 10 at OWN 30', 70, 65), pl(2, '0:04', 'Demo kicker 47 yard field goal is GOOD', '4th & 3 at OPP 30', 30, 0, { scoringPlay: true, homeScore: 10 })]));
    const cur = dr('d4', a, '', false, '2 plays, 9 yards, 0:48', 3, '5:00', 'OWN 40', [pl(3, '5:00', 'Demo back right end for 9 yards', '1st & 10 at OWN 40', 60, 51)]);
    drives = g[8].type.state === 'in' ? { previous: prev, current: cur } : { previous: prev };
  }
  if (started && lg === 'nba') {
    const sp = (per, clock, tid, text, made, val, x, y, A, H) => ({ text, type: { text: val === 3 ? 'Three Point Jumper' : 'Jump Shot' }, period: { number: per }, clock: { displayValue: clock }, team: { id: tid }, shootingPlay: true, scoringPlay: made, scoreValue: made ? val : 0, coordinate: { x, y }, awayScore: A, homeScore: H });
    allPlays = [
      sp(1, '11:40', a, 'D. Guard makes 25-foot three point jumper', true, 3, 25, 24, 3, 0),
      sp(1, '11:10', h, 'D. Wing misses driving layup', false, 2, 27, 2, 3, 0),
      sp(1, '10:30', a, 'D. Center makes dunk', true, 2, 25, 1, 5, 0),
      sp(1, '9:55', h, 'D. Wing makes 22-foot three point jumper', true, 3, 3, 1, 5, 3),
      { text: 'D. Guard makes free throw 1 of 2', type: { text: 'Free Throw - 1 of 2' }, period: { number: 1 }, clock: { displayValue: '9:20' }, team: { id: a }, shootingPlay: true, scoringPlay: true, scoreValue: 1, coordinate: { x: -214748340, y: -214748365 }, awayScore: 6, homeScore: 3 },
      { text: 'D. Sixth defensive rebound', type: { text: 'Defensive Rebound' }, period: { number: 2 }, clock: { displayValue: '8:00' }, team: { id: a }, awayScore: 6, homeScore: 3 },
      sp(2, '7:41', a, 'D. Sixth misses 18-foot jumper', false, 2, 38, 12, 6, 3),
    ];
  }
  return {
    header: { id, competitions: [comp] }, boxscore: box, scoringPlays: plays, drives, plays: allPlays,
    gameInfo: { venue: { fullName: 'Demo Stadium' } },
    pickcenter: [{ provider: { name: 'ESPN BET' }, details: 'HOME -3' }],
    winprobability: [{ homeWinPercentage: 0.61 }],
    predictor: { homeTeam: { gameProjection: '61.0' } },
    againstTheSpread: [{ team: { id: h } }],
  };
}

/* ---------- players ---------- */
const PLAYERS = {
  nfl: [['aq', 'Dexter Quarterback', '9', 'QB', 6], ['ar', 'Devin Back', '28', 'RB', 3], ['aw', 'Dante Receiver', '11', 'WR', 0], ['ad', 'Dion Tackler', '54', 'LB', 8]],
  cfb: [['cq', 'Kevin Demo', '7', 'QB', 'SR'], ['cr', 'Cam Runner', '22', 'RB', 'SO'], ['cd', 'Sam Safety', '3', 'S', 'JR']],
  nba: [['p1', 'Dre Guard', '1', 'G', 4], ['p2', 'Dom Center', '34', 'C', 9], ['p3', 'Deon Sixth', '12', 'F', 1]],
};
const athlete = (lg, r) => ({
  id: r[0], displayName: r[1], jersey: r[2], position: { abbreviation: r[3], displayName: r[3] },
  experience: typeof r[4] === 'string' ? { abbreviation: r[4], displayValue: r[4] } : { years: r[4] },
  displayHeight: `6' 2"`, displayWeight: '212 lbs', displayBirthPlace: 'Columbus, OH',
});
function roster(lg) {
  const all = PLAYERS[lg].map((r) => athlete(lg, r));
  if (lg === 'nba') return { athletes: all };
  const off = all.filter((a) => ['QB', 'RB', 'WR'].includes(a.position.abbreviation));
  return { athletes: [{ position: 'offense', items: off }, { position: 'defense', items: all.filter((a) => !off.includes(a)) }] };
}
function playerInfo(lg, id) {
  const r = PLAYERS[lg].find((x) => x[0] === id) || PLAYERS[lg][0];
  const nba = lg === 'nba';
  return { athlete: { ...athlete(lg, r), team: team(lg, T[lg][0][0]), statsSummary: { displayName: 'This Season', statistics: nba
    ? [{ abbreviation: 'PTS', displayValue: '24.1' }, { abbreviation: 'REB', displayValue: '5.2' }, { abbreviation: 'AST', displayValue: '7.8' }, { abbreviation: 'FG%', displayValue: '48.3' }]
    : [{ abbreviation: 'YDS', displayValue: '2,104' }, { abbreviation: 'TD', displayValue: '17' }, { abbreviation: 'INT', displayValue: '4' }, { abbreviation: 'RTG', displayValue: '104.2' }] },
    // betting noise the guard must drop
    odds: { details: 'MVP +450' } } };
}
function playerLog(lg) {
  const nba = lg === 'nba';
  const labels = nba ? ['MIN', 'FG', '3PT', 'FT', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PTS'] : ['CMP', 'ATT', 'YDS', 'TD', 'INT', 'CAR', 'YDS', 'TD'];
  const lines = nba
    ? [['36', '10-19', '4-9', '5-5', '4', '8', '2', '0', '3', '29'], ['33', '8-17', '2-6', '3-4', '6', '9', '1', '1', '2', '21'], ['38', '11-22', '5-11', '4-4', '5', '6', '3', '0', '4', '31']]
    : [['22', '31', '265', '2', '0', '4', '18', '0'], ['19', '33', '212', '1', '1', '6', '41', '1'], ['25', '36', '301', '3', '0', '3', '9', '0']];
  const opp = T[lg].slice(1, 4);
  const events = {}; const evs = lines.map((st, i) => {
    const id = 'lg' + i; const d = new Date(); d.setDate(d.getDate() - 7 * (i + 1));
    events[id] = { id, atVs: i % 2 ? '@' : 'vs', gameDate: d.toISOString(), gameResult: i === 1 ? 'L' : 'W', score: i === 1 ? '17-24' : '31-20', opponent: { id: opp[i % opp.length][0], abbreviation: opp[i % opp.length][3] } };
    return { eventId: id, stats: st };
  });
  return {
    labels, events,
    categories: nba ? [] : [{ name: 'passing', displayName: 'Passing', count: 5 }, { name: 'rushing', displayName: 'Rushing', count: 3 }],
    seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ type: 'event', events: evs }], summary: { stats: [{ displayName: 'Totals', stats: nba ? ['35.7', '29-58', '11-26', '12-13', '15', '23', '6', '1', '9', '81'] : ['66', '100', '778', '6', '1', '13', '68', '1'] }] } }],
  };
}
function playerCareer(lg) {
  const nba = lg === 'nba';
  const tm = T[lg][0];
  const cat = (name, displayName, labels, rows, totals) => ({ name, displayName, labels, statistics: rows.map(([y, st]) => ({ season: { year: y, displayName: String(y) }, teamId: y === 2024 ? T[lg][1][0] : tm[0], stats: st })), totals });
  return {
    teams: { [tm[0]]: { abbreviation: tm[3] } },
    categories: nba
      ? [cat('averages', 'Averages', ['GP', 'MIN', 'PTS', 'REB', 'AST', 'FG%'], [[2024, ['71', '31.2', '18.4', '4.1', '6.2', '45.1']], [2025, ['78', '34.0', '22.9', '4.8', '7.1', '47.0']], [2026, ['10', '35.7', '24.1', '5.2', '7.8', '48.3']]], ['159', '32.9', '21.0', '4.5', '6.8', '46.3'])]
      : [cat('passing', 'Passing', ['GP', 'CMP', 'ATT', 'YDS', 'TD', 'INT'], [[2024, ['12', '201', '330', '2,480', '18', '9']], [2025, ['13', '262', '401', '3,245', '23', '11']], [2026, ['9', '178', '270', '2,104', '17', '4']]], ['34', '641', '1,001', '7,829', '58', '24']),
        cat('rushing', 'Rushing', ['GP', 'CAR', 'YDS', 'AVG', 'TD'], [[2025, ['13', '88', '354', '4.0', '5']], [2026, ['9', '52', '210', '4.0', '3']]], ['22', '140', '564', '4.0', '8'])],
  };
}
const LEAGUE_SLUG = { nfl: 'nfl', cfb: 'college-football', nba: 'nba' };
function playerSearch(text) {
  const t = String(text || '').toLowerCase();
  const items = Object.entries(PLAYERS).flatMap(([lg, rows]) => rows.filter((r) => r[1].toLowerCase().includes(t)).map((r) => ({ id: r[0], type: 'player', displayName: r[1], league: LEAGUE_SLUG[lg], teamRelationships: [{ displayName: T[lg][0][1] }] })));
  return { items: [...items, { id: 'x1', type: 'player', displayName: 'Somebody Cricket', league: 'cricket' }] };
}

/* ---------- league stats ---------- */
function leadersFx(lg) {
  const nba = lg === 'nba';
  const P = PLAYERS[lg];
  const row = (i, v) => ({ displayValue: v, athlete: { id: P[i % P.length][0], displayName: P[i % P.length][1], position: { abbreviation: P[i % P.length][3] } }, team: team(lg, T[lg][i % T[lg].length][0]) });
  const cat = (name, displayName, abbreviation, vals) => ({ name, displayName, abbreviation, leaders: vals.map((v, i) => row(i, v)) });
  return { leaders: { categories: nba
    ? [cat('pointsPerGame', 'Points Per Game', 'PTS', ['31.2', '28.4', '27.9']), cat('reboundsPerGame', 'Rebounds Per Game', 'REB', ['13.1', '11.8', '10.2']), cat('assistsPerGame', 'Assists Per Game', 'AST', ['10.4', '9.1', '8.8'])]
    : [cat('passingYards', 'Passing Yards', 'YDS', ['2,804', '2,611', '2,540']), cat('rushingYards', 'Rushing Yards', 'YDS', ['1,012', '944', '871']), cat('receivingYards', 'Receiving Yards', 'YDS', ['988', '902', '860']), { name: 'sacks', displayName: 'Sacks', abbreviation: 'SACK', leaders: [{ ...row(0, '9'), value: 8.5 }, { ...row(1, '8'), value: 8 }] }, { name: 'odds', displayName: 'MVP Odds', leaders: [row(0, '+450')] }] } };
}
function teamStatsFx(lg) {
  const nba = lg === 'nba';
  const cats = nba
    ? [{ name: 'offensive', displayName: 'Offense', labels: ['PTS', 'FG%', '3P%', 'AST'], displayNames: ['Points Per Game', 'Field Goal %', '3-Point %', 'Assists Per Game'] }]
    : [{ name: 'passing', displayName: 'Passing', labels: ['YDS', 'YDS/G', 'TD', 'INT'], displayNames: ['Passing Yards', 'Passing Yards Per Game', 'Passing Touchdowns', 'Interceptions'] },
      { name: 'rushing', displayName: 'Rushing', labels: ['YDS', 'YDS/G', 'TD'], displayNames: ['Rushing Yards', 'Rushing Yards Per Game', 'Rushing Touchdowns'] }];
  return { categories: cats, teams: T[lg].map((r, i) => ({ team: team(lg, r[0]), categories: nba
    ? [{ name: 'offensive', totals: [String(118 - i * 2.5), String(48.1 - i), String(37.2 - i * 0.6), String(27 + i)] }]
    : [{ name: 'passing', totals: [`${2 + (i % 3)},${String(104 + i * 97).slice(-3)}`, String(265.4 - i * 11.2), String(19 - i), String(4 + i)] }, { name: 'rushing', totals: [`1,${String(80 + i * 53).padStart(3, '0')}`, String(131.5 - i * 7), String(12 - i)] }] })) };
}

export async function demoFetch(u) {
  const { pathname, searchParams } = new URL(u);
  if (pathname.endsWith('/common/v3/search')) return playerSearch(searchParams.get('query'));
  const m = pathname.match(/\/sports\/[^/]+\/([^/]+)\/(.*)$/);
  const lg = m && SPORT[m[1]];
  const rest = m ? m[2] : '';
  await new Promise((r) => setTimeout(r, 60));
  if (!lg) return rest.startsWith('scoreboard') ? { events: [], leagues: [] } : rest === 'standings' ? { children: [] } : { sports: [{ leagues: [{ teams: [] }] }] };
  if (rest === 'scoreboard') return scoreboard(lg, searchParams.get('dates'));
  if (rest === 'standings') return standings(lg, searchParams.get('level'));
  if (rest === 'teams') return teamsList(lg);
  if (rest === 'summary') return summary(lg, searchParams.get('event'));
  if (rest === 'leaders') return leadersFx(lg);
  if (rest === 'statistics/byteam') return teamStatsFx(lg);
  let t = rest.match(/^teams\/([^/]+)\/schedule$/); if (t) return schedule(lg, t[1]);
  if (/^teams\/[^/]+\/roster$/.test(rest)) return roster(lg);
  if (/^athletes\/[^/]+\/gamelog$/.test(rest)) return playerLog(lg);
  if (/^athletes\/[^/]+\/stats$/.test(rest)) return playerCareer(lg);
  t = rest.match(/^athletes\/([^/]+)$/); if (t) return playerInfo(lg, t[1]);
  t = rest.match(/^teams\/([^/]+)$/); if (t) return teamInfo(lg, t[1]);
  throw new Error('demo: no fixture for ' + u);
}
