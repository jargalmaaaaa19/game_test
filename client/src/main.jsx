import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { setLanguage } from './i18n.js';
import { setHost } from './net/usion.js';
import './index.css';

/**
 * Inside Usion the app must not start before `Usion.init` fires; outside it
 * (a plain browser tab, local dev) there is no host to wait for. Boot on
 * whichever happens, exactly once — and never block rendering on a script that
 * may not be there.
 */
function boot(config) {
  // Resolve the language BEFORE the first render, so no string is ever painted
  // in one language and swapped in another. `setHost` decides the same question
  // for the SDK: a config means we really are inside the Usion app.
  setLanguage(config);
  setHost(config);
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App hostConfig={config} />
    </React.StrictMode>,
  );
}

let booted = false;
const bootOnce = (config) => {
  if (booted) return;
  booted = true;
  boot(config);
};

if (typeof window !== 'undefined' && window.Usion?.init) {
  window.Usion.init((config) => bootOnce(config));
  // The host normally answers in milliseconds; this is a floor, not a policy.
  setTimeout(() => bootOnce(null), 2000);
} else {
  bootOnce(null);
}
