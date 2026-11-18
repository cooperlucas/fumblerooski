// Draws the link-preview image (public/og.png, 1200x630) shown when someone shares the app in a text, tweet or post:
// the header mascot and wordmark on the espresso paper, with the tagline and the racing stripes.
// Run: node scripts/og.cjs   (needs network for the Archivo font; NODE_USE_ENV_PROXY=1 behind a proxy)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const src = fs.readFileSync(path.join(__dirname, '../src/ui.jsx'), 'utf8');
const jsx = /export function Mascot\(\)[\s\S]*?(<svg[\s\S]*?<\/svg>)/.exec(src)[1];
const svg = jsx
  .replace(/\s(className|width|height|aria-hidden)="[^"]*"/g, '')
  .replace(/stopColor/g, 'stop-color').replace(/strokeWidth/g, 'stroke-width').replace(/strokeLinecap/g, 'stroke-linecap')
  .replace(/clipPath="/g, 'clip-path="').replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="330" height="258"')
  .replace(/var\(--ink\)/g, '#F8F2E7');

const html = `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&display=swap">
<style>
  body { margin: 0; width: 1200px; height: 630px; background: #15100C; font-family: Archivo, system-ui, sans-serif; overflow: hidden; position: relative; }
  .stripes { position: absolute; left: 0; right: 0; height: 30px;
    background: linear-gradient(to bottom, #22D3D6 0 6px, transparent 6px 12px, #F8F2E7 12px 18px, transparent 18px 24px, #8B5CF6 24px 30px); }
  .top { top: 64px; } .bot { bottom: 64px; }
  .row { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 34px; padding: 0 70px; }
  .brand { margin: 0; font-stretch: 125%; font-weight: 900; font-style: italic; font-size: 92px; line-height: 1; letter-spacing: 0.01em;
    text-transform: uppercase; padding-right: 14px;
    background: linear-gradient(180deg, #FFFFFF 0%, #C8FAFB 40%, #22D3D6 52%, #0E6F7A 100%); -webkit-background-clip: text; background-clip: text;
    color: transparent; -webkit-text-stroke: 2.4px #0C1124; filter: drop-shadow(7px 7px 0 #6E3AB5) drop-shadow(3px 3px 0 #0C1124); }
  .tag { margin-top: 22px; font-size: 34px; font-weight: 800; font-style: italic; letter-spacing: 0.08em; text-transform: uppercase; color: #F5C04A; }
</style></head><body>
  <div class="stripes top"></div><div class="stripes bot"></div>
  <div class="row">${svg}<div><h1 class="brand">Fumblerooski</h1><div class="tag">Pure sports · No odds · No ads</div></div></div>
</body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // Fetch the font through Node (works behind a proxy the browser can't use).
  await p.route(/^https:\/\//, async (route) => {
    try {
      const r = await fetch(route.request().url());
      await route.fulfill({ status: r.status, body: Buffer.from(await r.arrayBuffer()), headers: { 'content-type': r.headers.get('content-type') || 'text/css', 'access-control-allow-origin': '*' } });
    } catch { await route.abort(); }
  });
  await p.setContent(html, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(__dirname, '../public/og.png') });
  await b.close();
  console.log('wrote public/og.png');
})();
