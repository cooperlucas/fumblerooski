import React from 'react';
import { createRoot } from 'react-dom/client';
import './data/store.js';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Installable app shell. The worker never caches scores, only the app's own files.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
