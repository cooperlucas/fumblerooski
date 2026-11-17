import React from 'react';
import { createRoot } from 'react-dom/client';
import './data/store.js';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Installable app shell. The worker never caches scores, only the app's own files.
// Not inside the iPhone app (Capacitor): its files ship with the app, so there's nothing for a service worker to cache.
if ('serviceWorker' in navigator && import.meta.env.PROD && !window.Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
