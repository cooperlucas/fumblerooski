// Draws the app icons from the header mascot in src/ui.jsx, so the two always match.
// Run: node scripts/icons.cjs  (writes public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const src = fs.readFileSync(path.join(__dirname, '../src/ui.jsx'), 'utf8');
const jsx = /export function Mascot\(\)[\s\S]*?(<svg[\s\S]*?<\/svg>)/.exec(src)[1];
// JSX attribute names back to SVG ones.
const svg = jsx
  .replace(/\s(className|width|height|aria-hidden)="[^"]*"/g, '')
  .replace(/stopColor/g, 'stop-color').replace(/strokeWidth/g, 'stroke-width').replace(/strokeLinecap/g, 'stroke-linecap')
  .replace(/clipPath="/g, 'clip-path="').replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');

const BG = '#0C1124';
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
  await b.close();
})();
