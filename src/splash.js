// Launch logo (markup in index.html): stays up until the first screen has real content (no loading skeletons),
// at least a beat so it doesn't flash, at most 3 seconds, then flies off to the right and is removed.
const el = document.getElementById('splash');
if (el) {
  const t0 = performance.now(), MIN = 700, MAX = 3000;
  const root = document.getElementById('root');
  let done = false;
  const ready = () => root && root.children.length && !root.querySelector('.skel');
  const finish = () => {
    if (done) return; done = true; obs.disconnect(); clearTimeout(cap);
    el.classList.add('go');
    setTimeout(() => el.remove(), 700);
  };
  const check = () => {
    if (done || !ready()) return;
    const wait = MIN - (performance.now() - t0);
    if (wait > 0) setTimeout(() => { if (ready()) finish(); }, wait); else finish();
  };
  const obs = new MutationObserver(check);
  obs.observe(root, { childList: true, subtree: true });
  const cap = setTimeout(finish, MAX);
}
