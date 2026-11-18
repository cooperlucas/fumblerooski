// Fumblerooski's one bit of server code: alerts for pinned teams (web push).
// - /api/push/* takes subscriptions from the app (who to tell, about which teams, which kinds of alert).
// - A cron every minute checks the games those teams are in and sends "started", "close late" and "final" alerts.
// Everything else is the static app, served straight from the built assets.
import { buildPushHTTPRequest } from '@pushforge/builder';
import { LEAGUE } from '../src/data/leagues.js';
import { dueAlerts, alertText } from './alerts.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports';
// Push services we will send to (a subscription naming any other host is refused).
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|web\.push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/;
const KINDS = ['start', 'close', 'final'];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

let ready = null;
function setup(db) {
  ready = ready || db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, p256dh TEXT, auth TEXT, teams TEXT, kinds TEXT, updated INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS watch (team TEXT PRIMARY KEY, gid TEXT, start INTEGER, checked INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS games (gid TEXT PRIMARY KEY, lg TEXT, start INTEGER, away TEXT, home TEXT, state TEXT, sent TEXT, updated INTEGER)'),
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (url.pathname === '/api/push/health') return json({ ok: !!(env.DB && env.VAPID_PRIVATE_KEY) });
    if (!env.DB || !env.VAPID_PRIVATE_KEY) return json({ ok: false, error: 'Alerts are not set up yet.' }, 503);
    await setup(env.DB);
    try {
      if (req.method === 'POST' && url.pathname === '/api/push/subscribe') return await subscribe(req, env);
      if (req.method === 'POST' && url.pathname === '/api/push/unsubscribe') {
        const { endpoint } = await req.json();
        await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(String(endpoint || '')).run();
        return json({ ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/push/test') {
        const { endpoint } = await req.json();
        const s = await env.DB.prepare('SELECT * FROM subs WHERE endpoint = ?').bind(String(endpoint || '')).first();
        if (!s) return json({ ok: false, error: 'Not subscribed.' }, 404);
        const r = await push(env, s, { title: 'Alerts are on', body: 'You\'ll hear about your teams here. No odds, no ads.', url: '/' });
        return json({ ok: r.ok, status: r.status });
      }
      return json({ ok: false, error: 'Not found' }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 400);
    }
  },

  async scheduled(_event, env, ctx) {
    if (!env.DB || !env.VAPID_PRIVATE_KEY) return;
    ctx.waitUntil(run(env));
  },
};

async function subscribe(req, env) {
  const b = await req.json();
  const sub = b.subscription || {};
  const endpoint = String(sub.endpoint || '');
  let host = '';
  try { const u = new URL(endpoint); if (u.protocol === 'https:') host = u.hostname; } catch { /* bad url */ }
  if (!host || !PUSH_HOSTS.test(host)) return json({ ok: false, error: 'Unknown push service.' }, 400);
  if (!sub.keys?.p256dh || !sub.keys?.auth) return json({ ok: false, error: 'Missing keys.' }, 400);
  const teams = [...new Set((b.teams || []).map((t) => `${t.lg}:${t.id}`).filter((k) => /^[a-z0-9]+:\d+$/.test(k) && LEAGUE[k.split(':')[0]]))].slice(0, 60);
  const kinds = (b.kinds || KINDS).filter((k) => KINDS.includes(k));
  await env.DB.prepare('INSERT INTO subs (endpoint, p256dh, auth, teams, kinds, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, teams = excluded.teams, kinds = excluded.kinds, updated = excluded.updated')
    .bind(endpoint, sub.keys.p256dh, sub.keys.auth, JSON.stringify(teams), JSON.stringify(kinds), Date.now()).run();
  // New teams get looked up on the next run.
  if (teams.length) await env.DB.batch(teams.map((t) => env.DB.prepare('INSERT OR IGNORE INTO watch (team, gid, start, checked) VALUES (?, NULL, 0, 0)').bind(t)));
  return json({ ok: true, teams: teams.length });
}

async function push(env, s, msg) {
  const privateJWK = JSON.parse(env.VAPID_PRIVATE_KEY);
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK,
    subscription: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
    message: { payload: msg, adminContact: env.VAPID_SUBJECT || 'mailto:feedback@fumblerooski.app', options: { ttl: 3600, urgency: 'high', topic: msg.topic } },
  });
  const r = await fetch(endpoint, { method: 'POST', headers, body });
  // Gone for good (app deleted, permission revoked): forget it.
  if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(s.endpoint).run();
  return r;
}

const get = async (u) => { const r = await fetch(u, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const side = (c) => ({ id: String(c.team?.id || c.id || ''), abbr: c.team?.abbreviation || '', name: c.team?.shortDisplayName || c.team?.displayName || c.team?.abbreviation || '' });

// The free plan allows 50 outside requests a run: look up a few teams, check a dozen games, and leave room to send.
const LOOKUPS = 6, GAMES = 10;

export async function run(env) {
  const db = env.DB;
  await setup(db);
  const now = Date.now();
  const subs = (await db.prepare('SELECT * FROM subs').all()).results || [];
  if (!subs.length) return;
  const followed = new Set(subs.flatMap((s) => JSON.parse(s.teams || '[]')));

  // 1) Which game each followed team plays next. Re-checked every two hours, and right after its game is over.
  const watch = ((await db.prepare('SELECT * FROM watch').all()).results || []).filter((w) => followed.has(w.team));
  const stale = watch.filter((w) => !w.gid || now - w.checked > 2 * 3600e3 || (w.start && now - w.start > 6 * 3600e3)).sort((a, b) => a.checked - b.checked).slice(0, LOOKUPS);
  for (const w of stale) {
    const [lg, id] = w.team.split(':'); const L = LEAGUE[lg];
    try {
      const d = await get(`${SITE}/${L.sport}/${L.slug}/teams/${id}`);
      const ev = d.team?.nextEvent?.[0], c = ev?.competitions?.[0];
      if (!ev || !c) { await db.prepare('UPDATE watch SET checked = ? WHERE team = ?').bind(now, w.team).run(); continue; }
      const away = c.competitors.find((x) => x.homeAway === 'away'), home = c.competitors.find((x) => x.homeAway === 'home');
      const start = Date.parse(ev.date) || 0;
      await db.batch([
        db.prepare('UPDATE watch SET gid = ?, start = ?, checked = ? WHERE team = ?').bind(String(ev.id), start, now, w.team),
        db.prepare('INSERT OR IGNORE INTO games (gid, lg, start, away, home, state, sent, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(String(ev.id), lg, start, JSON.stringify(side(away)), JSON.stringify(side(home)), c.status?.type?.state || 'pre', '[]', now),
      ]);
    } catch { await db.prepare('UPDATE watch SET checked = ? WHERE team = ?').bind(now - 2 * 3600e3 + 10 * 60e3, w.team).run(); } // try again in ten minutes
  }

  // 2) Games under way, or about to be.
  const gids = [...new Set(((await db.prepare('SELECT gid FROM watch WHERE gid IS NOT NULL').all()).results || []).map((r) => r.gid))];
  if (!gids.length) return;
  const games = ((await db.prepare(`SELECT * FROM games WHERE gid IN (${gids.map(() => '?').join(',')}) AND state != 'post' AND start <= ? AND start > ?`).bind(...gids, now + 2 * 60e3, now - 8 * 3600e3).all()).results || [])
    .sort((a, b) => a.updated - b.updated).slice(0, GAMES);

  for (const g of games) {
    const L = LEAGUE[g.lg]; if (!L) continue;
    const away = JSON.parse(g.away), home = JSON.parse(g.home);
    const base = `${CORE}/${L.sport}/leagues/${L.slug}/events/${g.gid}/competitions/${g.gid}`;
    let st, as, hs;
    try {
      [st, as, hs] = await Promise.all([get(`${base}/status`), get(`${base}/competitors/${away.id}/score`).catch(() => null), get(`${base}/competitors/${home.id}/score`).catch(() => null)]);
    } catch { continue; }
    const now2 = { state: st.type?.state || 'pre', period: Number(st.period) || 0, clock: Number(st.clock) || 0, away: Number(as?.value) || 0, home: Number(hs?.value) || 0 };
    const sent = JSON.parse(g.sent || '[]');
    const due = dueAlerts({ state: g.state, sent }, now2, L.sport, L.periods);
    await db.prepare('UPDATE games SET state = ?, sent = ?, updated = ? WHERE gid = ?').bind(now2.state, JSON.stringify([...sent, ...due]), Date.now(), g.gid).run();
    if (!due.length) continue;
    const keys = [`${g.lg}:${away.id}`, `${g.lg}:${home.id}`];
    const to = subs.filter((s) => JSON.parse(s.teams || '[]').some((k) => keys.includes(k)));
    for (const kind of due) {
      const t = alertText(kind, { away, home, awayScore: now2.away, homeScore: now2.home }, st.type?.shortDetail || '');
      const msg = { ...t, url: `/#/game/${g.lg}/${g.gid}`, tag: `${g.gid}:${kind}`, topic: `g${g.gid}` };
      await Promise.allSettled(to.filter((s) => JSON.parse(s.kinds || '[]').includes(kind)).map((s) => push(env, s, msg)));
    }
  }
}
