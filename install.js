// Catch beforeinstallprompt as early as possible. Chrome can fire it before
// app.js (a deferred module) runs, and a missed event never comes back.
window.__installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event('installpromptready'));
});
