/* Surface any JS error visibly on screen so blank-white-screen bugs show their cause.
   "Script error." with no source/line is a cross-origin error from a CDN-hosted script
   (Supabase, React, Leaflet etc.) — the browser deliberately hides the details. These
   are almost always transient token-refresh blips, not app crashes, so we ignore them
   and let the Supabase auth state handler recover gracefully rather than nuking the UI. */
window.onerror = function(msg, src, line, col, err) {
  if (msg === 'Script error.' && !src && !line) return true; // suppress opaque cross-origin errors
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = '<div style="padding:24px;font-family:monospace;font-size:13px;color:#c00;background:#fff;position:fixed;inset:0;overflow:auto;z-index:99999"><h2 style="margin:0 0 12px">⚠️ WombatWatch crash</h2><b>' + msg + '</b><br><br>Source: ' + src + '<br>Line: ' + line + ':' + col + '<br><br><pre style="white-space:pre-wrap">' + (err && err.stack ? err.stack : '(no stack)') + '</pre></div>';
  }
};
window.onunhandledrejection = function(e) {
  const root = document.getElementById('root');
  if (root) {
    const reason = e.reason || e;
    root.innerHTML = '<div style="padding:24px;font-family:monospace;font-size:13px;color:#c00;background:#fff;position:fixed;inset:0;overflow:auto;z-index:99999"><h2 style="margin:0 0 12px">⚠️ WombatWatch unhandled rejection</h2><pre style="white-space:pre-wrap">' + (reason && reason.stack ? reason.stack : String(reason)) + '</pre></div>';
  }
};
