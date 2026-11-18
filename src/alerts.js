// Alerts for pinned teams (web push). The phone subscribes once; the server is told which teams and which kinds of
// alert, and is told again whenever the pinned teams change.
import { VAPID_PUBLIC_KEY } from './config.js';

const KEY = 'fr.alerts.v1';
export const ALERT_KINDS = [['start', 'Game starting'], ['close', 'Close game late'], ['final', 'Final score']];
export const readAlerts = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { on: false, kinds: ['start', 'close', 'final'] }; } catch { return { on: false, kinds: ['start', 'close', 'final'] }; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* fine */ } };

// Why alerts can't be turned on here, or '' when they can.
export function alertsBlocker() {
  if (typeof window === 'undefined') return 'unsupported';
  if (window.Capacitor?.isNativePlatform?.()) return 'native';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !standalone) return 'install'; // iPhone only allows alerts from the home screen app
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return '';
}

const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
async function currentSub(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC_KEY) });
  return sub;
}
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({ ok: false, error: 'Alerts are not available right now.' }));
  if (!r.ok || d.ok !== true) throw new Error(d.error || `Alerts server said ${r.status}`);
  return d;
}

// Turn on: ask permission (must come from a tap), subscribe, and send the server the pinned teams.
export async function enableAlerts(favs, kinds) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for Fumblerooski in your phone settings.' : 'Alerts need permission to notify you.');
  const sub = await currentSub(true);
  await post('/api/push/subscribe', { subscription: sub.toJSON(), teams: favs.map((t) => ({ lg: t.lg, id: t.id })), kinds });
  save({ on: true, kinds });
}
export async function disableAlerts() {
  const sub = await currentSub(false).catch(() => null);
  if (sub) { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  save({ ...readAlerts(), on: false });
}
// Pinned teams or kinds changed while alerts are on: tell the server.
export async function syncAlerts(favs, kinds = readAlerts().kinds) {
  const a = readAlerts();
  if (!a.on || alertsBlocker()) return;
  const sub = await currentSub(false).catch(() => null);
  if (!sub) return;
  await post('/api/push/subscribe', { subscription: sub.toJSON(), teams: favs.map((t) => ({ lg: t.lg, id: t.id })), kinds });
  save({ on: true, kinds });
}
export async function testAlert() {
  const sub = await currentSub(false);
  if (!sub) throw new Error('Alerts are not on for this phone.');
  await post('/api/push/test', { endpoint: sub.endpoint });
}

// Is the alerts server up? (Before it's deployed, /api/ answers with the app's page, not JSON.)
export async function alertsReady() {
  try { const r = await fetch('/api/push/health', { cache: 'no-store' }); const d = await r.json(); return d.ok === true; } catch { return false; }
}
