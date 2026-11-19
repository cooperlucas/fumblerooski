// iPhone glitch guard. After the keyboard or a dropdown's picker wheel closes (search box, season picker), iOS can leave the visible screen shifted against the
// page's layout: the bottom bar floats up mid-screen and the top header slides out of view until something forces a
// re-layout. When the keyboard is gone, nudge the scroll position in place, which snaps both back.
const vv = typeof window !== 'undefined' ? window.visualViewport : null;
const typing = () => { const el = document.activeElement; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };
let t = null;
const settle = () => {
  clearTimeout(t);
  t = setTimeout(() => {
    if (typing()) return;
    const x = window.scrollX, y = window.scrollY; // a same-spot scroll can be skipped, so step off a pixel and back
    window.scrollTo(x, y + 1); window.scrollTo(x, y);
  }, 120);
};
if (typeof document !== 'undefined') {
  const field = (el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName || '');
  document.addEventListener('focusout', (e) => { if (field(e.target)) settle(); });
  // A picked dropdown can stay focused after its wheel closes: let it go, then settle.
  document.addEventListener('change', (e) => { if (e.target?.tagName === 'SELECT') { e.target.blur(); settle(); } });
  vv?.addEventListener('resize', () => { if (!typing() && vv.height >= window.innerHeight - 40) settle(); });
  vv?.addEventListener('scroll', () => { if (!typing() && vv.scale <= 1.01 && vv.offsetTop > 1) settle(); });
}
