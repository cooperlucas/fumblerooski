// iPhone launch images for the home-screen app: iOS shows one of these the instant the app opens, before any of the
// page loads (without them it shows a blank white screen). Each is a picture of the launch logo in index.html at that
// phone's exact size, so the image hands off to the real logo without a jump. Light and dark follow the phone's setting.
// Run: node scripts/launch.cjs  (writes public/launch/*.png and the <link> tags between the LAUNCH markers in index.html)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const style = /<style>([\s\S]*?#splash[\s\S]*?)<\/style>/.exec(html)[1];
const splash = /<div id="splash"[\s\S]*?<\/svg>\s*<\/div>/.exec(html)[0];
// Portrait CSS sizes and pixel ratios of iPhones from the SE up.
const PHONES = [[320, 568, 2], [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3], [390, 844, 3],
  [428, 926, 3], [393, 852, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3], [420, 912, 3]];
const dir = path.join(__dirname, '../public/launch');

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const links = [];
  for (const [w, h, r] of PHONES) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
    for (const mode of ['light', 'dark']) {
      await p.setContent(`<html class="${mode === 'light' ? 'sp-light' : ''}"><head><style>${style} #splash svg{animation:none!important}</style></head><body style="margin:0">${splash}</body></html>`);
      const file = `launch-${w}x${h}@${r}-${mode}.png`;
      await p.screenshot({ path: path.join(dir, file) });
      links.push(`  <link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait) and (prefers-color-scheme: ${mode})" href="./launch/${file}">`);
    }
    await p.close();
  }
  await b.close();
  const block = `  <!-- LAUNCH (node scripts/launch.cjs) -->\n${links.join('\n')}\n  <!-- /LAUNCH -->`;
  const next = /  <!-- LAUNCH[\s\S]*?\/LAUNCH -->/.test(html) ? html.replace(/  <!-- LAUNCH[\s\S]*?\/LAUNCH -->/, block)
    : html.replace('  <link rel="manifest"', `${block}\n  <link rel="manifest"`);
  fs.writeFileSync(path.join(__dirname, '../index.html'), next);
  console.log(`${links.length} launch images`);
})();
