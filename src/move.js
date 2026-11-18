// The app moved from fumblerooski.lcoop24.workers.dev to fumblerooski.app. A phone keeps each web address's saved data
// separately, so the old address forwards to the new one carrying the person's pinned teams and settings along in the
// link, and the new address saves them before the app starts (this module is imported before the store reads them).
const HOME = 'fumblerooski.app';
// Only what the person chose: pinned teams and settings. Everything else in storage is a cache the app rebuilds, and
// some of those (the full team list) are far too big for a link: Safari calls such an address invalid.
const KEEP = ['fr.favs.v1', 'fr.leagues.v1', 'fr.theme', 'fr.stats.lg', 'fr.install.v1'];

try {
  const host = location.hostname;
  if (host.endsWith('.workers.dev')) {
    const carry = {};
    for (const k of KEEP) { const v = localStorage.getItem(k); if (v != null) carry[k] = v; }
    let packed = Object.keys(carry).length ? '?carry=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(carry))))) : '';
    if (packed.length > 6000) packed = ''; // never build an address too long to open
    location.replace(`https://${HOME}/${packed}${location.hash}`);
  } else {
    const q = new URLSearchParams(location.search);
    const packed = q.get('carry');
    if (packed) {
      const carry = JSON.parse(decodeURIComponent(escape(atob(packed))));
      for (const [k, v] of Object.entries(carry)) if (k.startsWith('fr.') && typeof v === 'string' && localStorage.getItem(k) == null) localStorage.setItem(k, v);
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }
} catch { /* private mode or a mangled link: start fresh */ }
