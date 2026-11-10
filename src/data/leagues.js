// One row per league. sport/slug are the feed's path pieces; everything else is how we show it.
export const LEAGUES = [
  { id: 'cfb', name: 'College Football', short: 'CFB', sport: 'football', slug: 'college-football', color: '#FF7A1A', params: { groups: '80', limit: '300' }, college: true, periodLen: 15, periods: 4 },
  { id: 'nfl', name: 'NFL', short: 'NFL', sport: 'football', slug: 'nfl', color: '#22D3D6', periodLen: 15, periods: 4 },
  { id: 'nba', name: 'NBA', short: 'NBA', sport: 'basketball', slug: 'nba', color: '#FF4FA8', periodLen: 12, periods: 4 },
  { id: 'nhl', name: 'NHL', short: 'NHL', sport: 'hockey', slug: 'nhl', color: '#9BE33A', periodLen: 20, periods: 3 },
  { id: 'mlb', name: 'MLB', short: 'MLB', sport: 'baseball', slug: 'mlb', color: '#FFE135', periods: 9 },
  { id: 'ncaam', name: "Men's College Hoops", short: 'NCAAM', sport: 'basketball', slug: 'mens-college-basketball', color: '#FFB86B', params: { groups: '50', limit: '300' }, college: true, periodLen: 20, periods: 2 },
  { id: 'ncaaw', name: "Women's College Hoops", short: 'NCAAW', sport: 'basketball', slug: 'womens-college-basketball', color: '#FF9ACB', params: { groups: '50', limit: '300' }, college: true, periodLen: 10, periods: 4 },
  { id: 'epl', name: 'Premier League', short: 'EPL', sport: 'soccer', slug: 'eng.1', color: '#C4A3FF', periodLen: 45, periods: 2 },
  { id: 'mls', name: 'MLS', short: 'MLS', sport: 'soccer', slug: 'usa.1', color: '#7FD7FF', periodLen: 45, periods: 2 },
  { id: 'wnba', name: 'WNBA', short: 'WNBA', sport: 'basketball', slug: 'wnba', color: '#FFA94D', periodLen: 10, periods: 4 },
];
export const LEAGUE = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));
