import React from 'react';
import { createRoot } from 'react-dom/client';
import './move.js';
import { warmSearch } from './data/store.js';
import { CF_BEACON_TOKEN } from './config.js';
import App from './App.jsx';
import './splash.js';
import './viewport.js';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
warmSearch();

// Installable app shell. The worker never caches scores, only the app's own files.
// Not inside the iPhone app (Capacitor): its files ship with the app, so there's nothing for a service worker to cache.
if ('serviceWorker' in navigator && import.meta.env.PROD && !window.Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

// Visit counts (Cloudflare Web Analytics: no cookies, no fingerprinting). Off until a token is set in src/config.js,
// and never inside the iPhone app.
if (CF_BEACON_TOKEN && import.meta.env.PROD && !window.Capacitor?.isNativePlatform?.()) {
  const s = document.createElement('script');
  s.defer = true; s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: CF_BEACON_TOKEN, spa: true }));
  document.head.appendChild(s);
}
