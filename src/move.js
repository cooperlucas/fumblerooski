// The app moved from fumblerooski.lcoop24.workers.dev to fumblerooski.app. A phone keeps each web address's saved data
// separately, so the old address forwards to the new one carrying the person's pinned teams and settings along in the
// link, and the new address saves them before the app starts (this module is imported before the store reads them).
const HOME = 'fumblerooski.app';
// Caches the app rebuilds on its own: not worth carrying.
const SKIP = /^fr\.(colors|pm2|fbsids)/;

try {
  const host = location.hostname;
  if (host.endsWith('.workers.dev')) {
    const carry = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('fr.') && !SKIP.test(k)) carry[k] = localStorage.getItem(k);
    }
    const packed = Object.keys(carry).length ? '?carry=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(carry))))) : '';
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
