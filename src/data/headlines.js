// Which games Headliners shows for each league, by the rhythm of its sport.
// Evening sports (NBA, NHL, MLB, college hoops): before noon, last night's results (plus anything already live); after noon, today.
// Soccer: today (matches start in the morning).
// College football: Saturday's slate on Saturday; the weekend's results Sunday through Tuesday morning; weekdays follow the
//   morning/afternoon rule on days with games (MACtion), otherwise the upcoming week's slate. Bowl season runs day by day.
// NFL: last week's results Tuesday and Wednesday; this week's games Thursday through Monday.
export const MORNING_UNTIL = 12;
const EVENING = new Set(['nba', 'nhl', 'mlb', 'wnba', 'ncaam', 'ncaaw']);

// What each football league needs fetched as a week: 'done' (results), 'next' (upcoming) or null (day boards will do).
export function footballModes(now, cfbSeason = '') {
  const dow = now.getDay(), morning = now.getHours() < MORNING_UNTIL;
  const bowls = /post/i.test(cfbSeason);
  const cfb = bowls || dow === 6 ? null : dow === 0 || dow === 1 || (dow === 2 && morning) ? 'done' : 'next';
  const nfl = dow === 2 || dow === 3 ? 'done' : 'next';
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
    // Morning: last night's games (some may still be going), plus today's that have started.
    return morning && y.length ? [...y, ...t.filter((g) => g.state !== 'pre')] : t;
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
