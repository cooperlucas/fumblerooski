// Draws the app icons from the header mascot in src/ui.jsx, so the two always match.
// Run: node scripts/icons.cjs  (writes public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png,
// and the iPhone app's icon and launch screens under ios/)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const src = fs.readFileSync(path.join(__dirname, '../src/ui.jsx'), 'utf8');
const jsx = /export function Mascot\(\)[\s\S]*?(<svg[\s\S]*?<\/svg>)/.exec(src)[1];
// JSX attribute names back to SVG ones.
const mk = (ink) => jsx
  .replace(/\s(className|width|height|aria-hidden)="[^"]*"/g, '')
  .replace(/stopColor/g, 'stop-color').replace(/strokeWidth/g, 'stroke-width').replace(/strokeLinecap/g, 'stroke-linecap')
  .replace(/clipPath="/g, 'clip-path="').replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  .replace(/var\(--ink\)/g, ink); // the middle racing stripe takes the page's ink: navy on cream, cream on espresso
const svg = mk('#0C1124');

const BG = '#F3EFE4'; // light mode's cream program paper
// [file, size, how wide the mascot is as a share of the icon]. Maskable icons get cropped to a circle, so it sits smaller.
const OUT = [['icon-512.png', 512, 0.8], ['icon-192.png', 192, 0.8], ['apple-touch-icon.png', 180, 0.8], ['icon-maskable-512.png', 512, 0.62]];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ deviceScaleFactor: 1 });
  for (const [file, size, share] of OUT) {
    const w = size * share, h = w * 50 / 64;
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:${BG};width:${size}px;height:${size}px;display:grid;place-items:center">
      <div style="width:${w}px;height:${h}px;transform:translate(${-size * 0.015}px, ${size * 0.01}px)">${svg.replace('<svg', `<svg width="${w}" height="${h}"`)}</div></body></html>`);
    await p.screenshot({ path: path.join(__dirname, '../public', file), omitBackground: false });
    console.log('wrote', file);
  }
  // iPhone app (Capacitor): the 1024 App Store icon, and the launch screen in light and dark (mascot on the app's paper).
  const ios = path.join(__dirname, '../ios/App/App/Assets.xcassets');
  if (fs.existsSync(ios)) {
    const shots = [
      [path.join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'), 1024, 0.8, BG, svg],
      [path.join(ios, 'Splash.imageset/splash-light.png'), 2732, 0.16, BG, svg],
      [path.join(ios, 'Splash.imageset/splash-dark.png'), 2732, 0.16, '#15100C', mk('#F8F2E7')],
    ];
    for (const [file, size, share, bg, art] of shots) {
      const w = size * share, h = w * 50 / 64;
      await p.setViewportSize({ width: size, height: size });
      await p.setContent(`<html><body style="margin:0;background:${bg};width:${size}px;height:${size}px;display:grid;place-items:center">
        <div style="width:${w}px;height:${h}px;transform:translate(${-w * 0.019}px, ${w * 0.0125}px)">${art.replace('<svg', `<svg width="${w}" height="${h}"`)}</div></body></html>`);
      await p.screenshot({ path: file, omitBackground: false });
      console.log('wrote', path.relative(path.join(__dirname, '..'), file));
    }
  }
  await b.close();
})();
