// Order matters: the DOM guard and error overlay must be installed before React renders.
import './legacy/domGuard.js';
import './legacy/errorOverlay.js';
import './legacy/leafletSetup.js';
import './legacy/styles.css';
import { createRoot } from 'react-dom/client';
import LegacyApp from './legacy/LegacyApp.jsx';

const root = document.getElementById('root')!;
try {
  createRoot(root).render(<LegacyApp />);
} catch (e) {
  const err = e as Error;
  root.innerHTML = `<div style="padding:24px;font-family:monospace;font-size:13px;color:#c00;background:#fff;position:fixed;inset:0;overflow:auto;z-index:99999"><h2 style="margin:0 0 12px">⚠️ WombatWatch render error</h2><pre style="white-space:pre-wrap">${err?.stack ?? String(e)}</pre></div>`;
}
