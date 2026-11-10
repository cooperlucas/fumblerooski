// The promise: no odds, no ads. Everything from the feed passes through here before it reaches a screen.
// scrub() drops betting data by key. cleanText() drops any sentence that talks about betting. Fail closed.

const BLOCK_KEYS = /^(odds|oddsDetails|pickcenter|againstTheSpread|predictor|winprobability|betting|bettingOdds|futures|spread|overUnder|moneyline|pointSpread|sportsbook|sportsbooks)$/i;

export function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      if (BLOCK_KEYS.test(k)) continue;
      o[k] = scrub(v[k]);
    }
    return o;
  }
  return v;
}

const WORDS = /\b(odds|point spread|against the spread|money ?line|over\/under|o\/u|parlays?|sports ?books?|wager(s|ed|ing)?|betting|bet(s|tor|tors)?|gambl\w*|draftkings|fanduel|betmgm|caesars sportsbook|espn bet|bet365|pointsbet|hard rock bet|prop bets?|props|favored by|covers? the spread|\d+(\.5)?-point (favorites?|underdogs?))\b/i;

export const isBetting = (s) => WORDS.test(String(s ?? ''));
export const cleanText = (s) => {
  const t = String(s ?? '').trim();
  return isBetting(t) ? '' : t;
};
