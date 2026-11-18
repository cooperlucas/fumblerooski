// Alert rules, shared by the worker and the tests: given a game's last known state and its new one, which alerts are due.
// Kinds: 'start' (the game went from scheduled to live), 'close' (late and within one score), 'final' (it just ended).

// Per sport: regulation periods, and what counts as late and close. Clocks count down in seconds, except soccer's,
// which counts up (elapsed seconds).
export const CLOSE = {
  football: { late: (p, clock, n) => p > n || (p === n && clock <= 300), margin: 8 },
  basketball: { late: (p, clock, n) => p > n || (p === n && clock <= 180), margin: 5 },
  hockey: { late: (p, clock, n) => p > n || (p === n && clock <= 300), margin: 1 },
  baseball: { late: (p, _clock, n) => p >= n, margin: 1 },
  soccer: { late: (p, clock) => p >= 2 && clock >= 80 * 60, margin: 1 },
};

// prev: { state, sent: [] } from the last check (null the first time a game is seen).
// now: { state: 'pre' | 'in' | 'post', period, clock, away, home } with scores as numbers.
// Returns the alert kinds due now. A game first seen mid-way only gets what is still ahead of it, so turning alerts on
// at halftime does not replay "it started".
export function dueAlerts(prev, now, sport, periods) {
  const sent = new Set(prev?.sent || []);
  const out = [];
  const was = prev?.state || null;
  if (now.state === 'in' && was === 'pre' && !sent.has('start')) out.push('start');
  if (now.state === 'in' && !sent.has('close')) {
    const r = CLOSE[sport];
    const diff = Math.abs((now.away ?? 0) - (now.home ?? 0));
    if (r && r.late(now.period || 0, now.clock ?? 0, periods || 0) && diff <= r.margin) out.push('close');
  }
  if (now.state === 'post' && was === 'in' && !sent.has('final')) out.push('final');
  return out;
}

// What the notification says.
export function alertText(kind, g, statusShort) {
  const a = g.away, h = g.home;
  const line = `${a.abbr} ${g.awayScore} · ${h.abbr} ${g.homeScore}`;
  if (kind === 'start') return { title: `${a.abbr} at ${h.abbr} is underway`, body: `${a.name} at ${h.name}` };
  if (kind === 'close') return { title: `Close one late: ${line}`, body: `${statusShort ? statusShort + ' · ' : ''}${a.name} at ${h.name}` };
  const tie = g.awayScore === g.homeScore;
  const w = g.awayScore > g.homeScore ? a : h, l = w === a ? h : a;
  return { title: tie ? `Final: ${line}` : `Final: ${w.name} beat ${l.name}`, body: line };
}
