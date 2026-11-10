# Fumblerooski

Pure sports. No odds. No ads. A phone-first web app for live scores, standings, schedules and game pages.

This is milestone 1 of the launch checklist: the prototype's screens running on real data.

## What works

- **Home**: score ticker, your pinned teams, today's games, headlines
- **Scores**: any day from three back to three ahead, filtered by league
- **Leagues**: 10 leagues (CFB, NFL, NBA, NHL, MLB, men's and women's college hoops, Premier League, MLS, WNBA) with standings and the current slate
- **Team pages**: record, schedule and results, Pin to Home
- **Game pages**: scoreboard, score by period, scoring plays, player box scores (with +/- for basketball), and team stats with plain-English explanations
- **Search** across every team
- **Live refresh**: every 30 seconds while a game is live, every 5 minutes otherwise, paused when the tab is hidden
- **Installable**: add it to a phone home screen and it opens full screen

Pinned teams are saved on the device. There are no accounts, no analytics and no tracking.

## The no-odds guard

`src/data/guard.js` runs on everything from the feed before it reaches a screen. It deletes betting fields
(odds, spreads, win probability, pick data) and drops any sentence that mentions betting or a sportsbook.
`npm test` proves it against demo data that deliberately contains betting content.

## Run it

```
npm install
npm run dev      # local dev server
npm test         # data layer tests
npm run build    # production build into dist/
```

Add `?demo=1` to the URL (or use About > Demo Mode) to click around with made-up games. Demo mode always shows a yellow banner.

## Put it online

`dist/` is already built and is a plain static site. No server needed.

- **Cloudflare Pages**: Workers & Pages > Create > Pages > Upload assets, then drop in the `dist` folder.
- **Netlify**: drag the `dist` folder onto app.netlify.com/drop.

Then open the link on your phone and use Share > Add to Home Screen.

## Check the feed first

The app reads ESPN's public site API straight from the browser. **It was built and tested against demo data shaped like
that feed, not against the live feed itself**, so the first thing to do after deploying is open
**Leagues > About Fumblerooski > Run the check**. It tests scores, standings, the team list, a team page and a game page
and tells you which, if any, did not load.

If something fails, the fix is in `src/data/espn.js`. That file is the only one that knows the feed's shape, which is
also what makes a licensed feed a swap later instead of a rewrite.

Two things to know about this feed: it is unofficial and can change without notice, and its terms do not cover
commercial use. Treat it as private-beta only.

## What is not here yet

- **AI-written recaps.** Headlines are template-written from the final score for now.
- **A scheduled data job and CDN.** Phones call the feed directly. Fine for a beta with a few families, not for launch.
- **Video highlights and team logos.** Left out on purpose: both need licenses.

## Layout

```
src/data/leagues.js    league list
src/data/guard.js      the no-odds guard
src/data/espn.js       feed adapter (the only file that knows the feed)
src/data/fixtures.js   demo data
src/data/store.js      caching, live refresh, pinned teams, demo mode
src/ui.jsx             shared components
src/App.jsx            every screen
src/styles.css         the look
tests/                 data layer tests
```
