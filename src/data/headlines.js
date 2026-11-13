// Which games Headliners shows for each league, by the rhythm of its sport.
// Evening sports (NBA, NHL, MLB, college hoops): before noon, last night's results (plus anything already live); after noon, today.
// Soccer: today (matches start in the morning).
// College football: Saturday's slate on Saturday; the weekend's results Sunday through Tuesday morning; weekdays follow the
//   morning/afternoon rule on days with games (MACtion), otherwise the upcoming week's slate. Bowl season runs day by day.
// NFL: last week's results on Tuesday (3am Tuesday to 3am Wednesday); the new week from then on.
// Evening sports and weeknight football flip early when today's first game is close (weekend noon tips and kickoffs).
export const MORNING_UNTIL = 12;
// A sports day runs 3am to 3am: a game that ends at 1am still belongs to the night before.
export const DAY_TURNS = 3;
const sportsDay = (now) => new Date(now.getTime() - DAY_TURNS * 3600000);
const EVENING = new Set(['nba', 'nhl', 'mlb', 'wnba', 'ncaam', 'ncaaw']);
// Last night's results give way to today's slate at noon, or two hours before today's first game if that's earlier.
const LEAD = 2 * 3600000;

// What each football league needs fetched as a week: 'done' (results), 'next' (upcoming) or null (day boards will do).
export function footballModes(now, cfbSeason = '') {
  const day = sportsDay(now), dow = day.getDay(), morning = now.getHours() < MORNING_UNTIL;
  const bowls = /post/i.test(cfbSeason);
  // CFB: Saturday's slate (3am Sat to 3am Sun); results 3am Sunday through Tuesday morning; then the week ahead.
  const cfb = bowls || dow === 6 ? null : dow === 0 || dow === 1 || (dow === 2 && morning) ? 'done' : 'next';
  // NFL: last week's results from 3am Tuesday; the new week from 3am Wednesday.
  const nfl = dow === 2 ? 'done' : 'next';
  return { cfb, nfl };
}

// today / yest: every league's games for the day. weeks: { cfb, nfl } week boards (games) as asked for by footballModes.
export function headlineGames({ now, today = [], yest = [], weeks = {}, seasons = {} }) {
  const morning = now.getHours() < MORNING_UNTIL;
  const modes = footballModes(now, seasons.cfb);
  const of = (list, lg) => list.filter((g) => g.lg === lg);
  const lgs = [...new Set([...today, ...yest, ...(weeks.cfb || []), ...(weeks.nfl || [])].map((g) => g.lg))];
  const out = [];
  const daily = (lg) => {
    const t = of(today, lg), y = of(yest, lg);
    const first = Math.min(...t.map((g) => Date.parse(g.date || '')).filter(Number.isFinite));
    const early = Number.isFinite(first) && now.getTime() >= first - LEAD;
    // Morning: last night's games (some may still be going), plus today's that have started, until today's slate is near.
    if (morning && y.length && !early) return [...y, ...t.filter((g) => g.state !== 'pre')];
    // Today's slate, plus last night's games still going past midnight.
    return morning ? [...y.filter((g) => g.state === 'live'), ...t] : t;
  };
  for (const lg of lgs) {
    if (lg === 'nfl') out.push(...(weeks.nfl || of(today, lg)));
    else if (lg === 'cfb') {
      if (!modes.cfb) out.push(...daily(lg));
      else if (modes.cfb === 'done') out.push(...(weeks.cfb || []));
      else {
        // Weeknights: a game day (MACtion) goes by the morning/afternoon rule; otherwise what's coming up this week.
        const d = daily(lg);
        out.push(...(d.length ? d : (weeks.cfb || []).filter((g) => g.state !== 'final')));
      }
    } else if (EVENING.has(lg)) out.push(...daily(lg));
    else out.push(...of(today, lg));
  }
  const seen = new Set();
  return out.filter((g) => { const k = g.lg + g.id; if (seen.has(k)) return false; seen.add(k); return true; });
}
// Before noon, a game that finished since yesterday is the news: it sorts right after live games.
export function freshFinal(g, now) {
  if (g.state !== 'final' || now.getHours() >= MORNING_UNTIL) return false;
  const t = Date.parse(g.date || '');
  return Number.isFinite(t) && now - t < 20 * 3600000;
}

// Is this game on today's sports day (3am to 3am)? Live games always count: they're happening right now.
export function isToday(g, now = new Date()) {
  if (g.state === 'live') return true;
  const t = Date.parse(g.date || '');
  if (!Number.isFinite(t)) return false;
  return sportsDay(new Date(t)).toDateString() === sportsDay(now).toDateString();
}
