// Search-engine pages. The app itself is one JavaScript page with #/ addresses, which search engines read poorly, so
// these are plain HTML pages, each answering one thing people search for, each pointing into the app.
// Run: node scripts/seo.cjs  (writes public/<slug>/index.html, public/404.html, public/sitemap.xml, public/robots.txt)
const fs = require('fs');
const path = require('path');

const SITE = 'https://fumblerooski.app';
const pub = path.join(__dirname, '../public');
const today = new Date().toISOString().slice(0, 10);

const PAGES = [
  {
    slug: 'no-betting-sports-app',
    title: 'A Sports Scores App With No Betting Odds',
    h1: 'Sports scores with no betting odds',
    description: 'Fumblerooski is a free sports scores app with no betting lines, no spreads, no sportsbook ads. Live scores, standings and stats for the NFL, college football, NBA, college hoops, MLB, NHL and soccer.',
    lead: 'Just the game. No spreads next to the score, no odds on the box score, no "bet now" buttons, no sportsbook promos between games.',
    body: [
      ['Why no odds?', 'Open most sports apps now and the betting line sits right next to the score, a sportsbook ad loads before the box score, and the "game preview" is really a parlay pitch. Fumblerooski was built by a football coach and fan who just wanted to know if his team was winning. So there are no odds anywhere in it, by design, and there never will be.'],
      ['What you get instead', 'Live scores for every game, a live game tracker with a field view and a replay you can scrub through, play-by-play, box scores, team stats, standings, rankings and league leaders. Pin your teams and they sit at the top of the scores page, with alerts when they kick off, when it is close late, and the final.'],
      ['Leagues covered', 'NFL, college football (FBS, FCS, Division II and Division III), NBA, men\'s and women\'s college basketball, MLB, NHL, WNBA and major soccer leagues.'],
    ],
    faq: [
      ['Does Fumblerooski show betting odds or spreads?', 'No. There are no odds, spreads, over/unders, player props or sportsbook ads anywhere in the app.'],
      ['Is Fumblerooski free?', 'Yes. It is free, with no account and no sign up.'],
      ['How do I install it?', 'Open fumblerooski.app on your phone. On iPhone, tap Share then Add to Home Screen. On Android, tap Install when your browser offers it. It then opens like any other app.'],
    ],
  },
  {
    slug: 'ad-free-sports-scores',
    title: 'Ad-Free Sports Scores App',
    h1: 'Ad-free sports scores',
    description: 'Live sports scores with no ads, no account and no clutter. Fumblerooski covers the NFL, college football, NBA, college basketball, MLB, NHL and soccer, free.',
    lead: 'No banner ads, no video ads, no pop-ups, no account. You open it and the scores are on the first screen.',
    body: [
      ['Built to be fast', 'Fumblerooski loads scores the moment you open it. No splash ads, no autoplay video, no wall asking you to sign in. Live games refresh on their own.'],
      ['Everything a fan checks', 'Scores and schedules, a live game tracker for football, shot charts for basketball, box scores and play-by-play, team stats, standings, conference and poll rankings, and league leaders that only count players who actually qualify.'],
      ['Your teams first', 'Pin your teams and their games sit at the top, including their next game coming up this week. Turn on alerts from the home screen app to hear when they start, when it is close late, and the final score.'],
    ],
    faq: [
      ['Are there any ads in Fumblerooski?', 'No. The app has no ads of any kind.'],
      ['Do I need an account?', 'No. There is nothing to sign up for. Your pinned teams and settings stay on your own phone.'],
      ['Which sports does it cover?', 'NFL, college football, NBA, men\'s and women\'s college basketball, MLB, NHL, WNBA and major soccer leagues.'],
    ],
  },
  {
    slug: 'd2-d3-college-football-scores',
    title: 'D2 and D3 College Football Scores, Live',
    h1: 'Division II and III college football scores',
    description: 'Live Division II and Division III college football scores, schedules, standings and box scores, plus FCS and FBS. Filter by conference. Free, no ads, no betting odds.',
    lead: 'Small-college football gets the same treatment as the big schools: live scores, box scores, standings and conference filters for FCS, D-II and D-III.',
    body: [
      ['Every division, one schedule', 'On the college football schedule, pick FBS, FCS, Division II or Division III from the games filter. Each division shows its own week of games, and the conference list switches to that division, so you can see just the OAC, the WIAC, the GLIAC or any other conference.'],
      ['Follow your small school', 'Pin a D-II or D-III team and its games show up at the top of your scores, with its schedule, results and standings on its team page. Most scores apps bury these games or skip them entirely.'],
      ['Built by a football coach', 'Fumblerooski was made by a high school football coach who wanted small-college games treated like the big ones. It is free, with no ads and no betting odds.'],
    ],
    faq: [
      ['Where can I find Division III football scores?', 'Open fumblerooski.app, go to College Football, then Schedule, and pick Division III from the games filter.'],
      ['Does it have D-II and D-III standings?', 'Yes. College football standings can be switched between FBS, FCS, Division II and Division III.'],
      ['Can I filter by conference?', 'Yes. The games filter lists each division\'s conferences.'],
    ],
    open: '/#/league/cfb',
    cta: 'See college football scores',
  },
  {
    slug: 'sports-app-for-kids',
    title: 'A Sports App Safe for Kids: No Gambling, No Ads',
    h1: 'A sports app you can hand to your kid',
    description: 'Fumblerooski is a sports scores app with no gambling, no betting lines, no ads and no chat. Safe for young fans who love the NFL, college football, NBA and more.',
    lead: 'Kids who love sports end up in sports apps, and sports apps are now full of betting. Fumblerooski has none of it.',
    body: [
      ['What it leaves out', 'No betting lines or odds. No sportsbook or casino ads, or ads of any kind. No chat, comments or messages, and no way to contact other users. No account, so nothing to sign up for and no personal information collected.'],
      ['What it keeps in', 'The fun part: live scores, a live game tracker with a field view, player and team stats, standings and league leaders. Young fans can follow their favorite teams and players and actually learn the stats.'],
      ['Made by a coach', 'Fumblerooski was built by a high school football coach who wanted a sports app he would be fine with his players using.'],
    ],
    faq: [
      ['Is Fumblerooski safe for kids?', 'It was made to be. There is no betting content, no ads, no chat and no account, and it collects nothing about who uses it.'],
      ['Does it cost anything?', 'No. It is free.'],
      ['Does it work on iPhone and Android?', 'Yes. Open fumblerooski.app and add it to your home screen.'],
    ],
  },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const style = `
    :root { --bg: #F3EFE4; --panel: #FBF8F1; --ink: #0C1124; --soft: #3B4256; --mute: #6B6F7C; --line: #DDD4C2; --teal: #0B8F92; --purple: #6A3BE0; --gold: #B98300; --btn: #0C1124; --btnink: #F8F2E7; color-scheme: light; }
    @media (prefers-color-scheme: dark) { :root { --bg: #15100C; --panel: #211912; --ink: #F8F2E7; --soft: #E2D5C0; --mute: #AC9A82; --line: #3B2E22; --teal: #22D3D6; --purple: #8B5CF6; --gold: #F5C04A; --btn: #F5C04A; --btnink: #15100C; color-scheme: dark; } }
    * { box-sizing: border-box; }
    body { margin: 0; padding-top: env(safe-area-inset-top, 0px); background: var(--bg); color: var(--ink); font-family: Archivo, system-ui, -apple-system, sans-serif; font-size: 17px; line-height: 1.55; }
    .stripes { height: 10px; background: linear-gradient(to bottom, var(--teal) 0 2px, transparent 2px 4px, var(--ink) 4px 6px, transparent 6px 8px, var(--purple) 8px 10px); }
    main { max-width: 680px; margin: 0 auto; padding: 28px max(18px, env(safe-area-inset-right, 0px)) 56px max(18px, env(safe-area-inset-left, 0px)); }
    a { color: var(--teal); }
    .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; font-stretch: 125%; font-weight: 900; font-style: italic; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 22px; }
    .brand img { width: 40px; height: 40px; border-radius: 10px; }
    h1 { margin: 0 0 12px; font-stretch: 125%; font-weight: 900; font-style: italic; text-transform: uppercase; font-size: 32px; line-height: 1.08; text-wrap: balance; }
    .lead { font-size: 20px; font-weight: 700; margin: 0 0 22px; text-wrap: balance; }
    h2 { font-stretch: 125%; font-weight: 900; font-style: italic; text-transform: uppercase; font-size: 17px; letter-spacing: 0.04em; color: var(--teal); margin: 30px 0 8px; }
    p, li { color: var(--soft); }
    .cta { display: inline-block; margin: 6px 0 4px; padding: 14px 22px; border-radius: 999px; background: var(--btn); color: var(--btnink); font-weight: 900; text-decoration: none; }
    .note { font-size: 14px; color: var(--mute); margin-top: 8px; }
    details { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px; margin: 10px 0; }
    summary { font-weight: 800; cursor: pointer; color: var(--ink); }
    details p { margin: 8px 0 0; }
    nav.more { margin-top: 36px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 15px; }
    nav.more ul { padding-left: 18px; }
    footer { margin-top: 28px; font-size: 14px; color: var(--mute); }`;

const head = (title, description, url, extra = '') => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)} · Fumblerooski</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#15100C">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Fumblerooski">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:ital,wdth,wght@0,62..125,100..900;1,62..125,100..900&display=swap">
  <style>${style}
  </style>${extra}
</head>`;

const others = (slug) => PAGES.filter((p) => p.slug !== slug).map((p) => `<li><a href="/${p.slug}/">${esc(p.h1)}</a></li>`).join('\n        ');

for (const p of PAGES) {
  const url = `${SITE}/${p.slug}/`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Fumblerooski', item: `${SITE}/` }, { '@type': 'ListItem', position: 2, name: p.h1, item: url }] },
    ],
  };
  const html = `${head(p.title, p.description, url, `\n  <script type="application/ld+json">${JSON.stringify(ld)}</script>`)}
<body>
  <div class="stripes" aria-hidden="true"></div>
  <main>
    <a class="brand" href="/"><img src="/icon-192.png" alt="" width="40" height="40">Fumblerooski</a>
    <h1>${esc(p.h1)}</h1>
    <p class="lead">${esc(p.lead)}</p>
    <a class="cta" href="${p.open || '/'}">${esc(p.cta || 'Open Fumblerooski')}</a>
    <p class="note">Free. No account. Works on iPhone and Android: open it, then Add to Home Screen.</p>
${p.body.map(([h, t]) => `    <h2>${esc(h)}</h2>\n    <p>${esc(t)}</p>`).join('\n')}
    <h2>Questions</h2>
${p.faq.map(([q, a]) => `    <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
    <nav class="more" aria-label="More">
      <b>More from Fumblerooski</b>
      <ul>
        ${others(p.slug)}
      </ul>
    </nav>
    <footer><a href="/">fumblerooski.app</a> · <a href="/privacy">Privacy</a> · feedback@fumblerooski.app</footer>
  </main>
</body>
</html>
`;
  fs.mkdirSync(path.join(pub, p.slug), { recursive: true });
  fs.writeFileSync(path.join(pub, p.slug, 'index.html'), html);
}

// A real "not found" for addresses that aren't anything (the app's own pages live after the #).
fs.writeFileSync(path.join(pub, '404.html'), `${head('Page not found', 'That page does not exist.', `${SITE}/`, '\n  <meta name="robots" content="noindex">')}
<body>
  <div class="stripes" aria-hidden="true"></div>
  <main>
    <a class="brand" href="/"><img src="/icon-192.png" alt="" width="40" height="40">Fumblerooski</a>
    <h1>Fumbled that one</h1>
    <p class="lead">There's no page at this address.</p>
    <a class="cta" href="/">Go to the scores</a>
  </main>
</body>
</html>
`);

const urls = [['/', '1.0', 'daily'], ...PAGES.map((p) => [`/${p.slug}/`, '0.8', 'monthly']), ['/privacy', '0.3', 'yearly']];
fs.writeFileSync(path.join(pub, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, pr, f]) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(pub, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE}/sitemap.xml
`);
console.log(`${PAGES.length} pages, 404, sitemap, robots`);
