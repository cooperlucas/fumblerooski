import test from 'node:test';
import assert from 'node:assert/strict';
import { dueAlerts, alertText } from '../worker/alerts.js';

test('alerts: start, close late, final, each once', () => {
  assert.deepEqual(dueAlerts({ state: 'pre', sent: [] }, { state: 'in', period: 1, clock: 900, away: 0, home: 0 }, 'football', 4), ['start']);
  // first seen mid-game: no "started"
  assert.deepEqual(dueAlerts(null, { state: 'in', period: 2, clock: 600, away: 7, home: 3 }, 'football', 4), []);
  // 4th quarter, 6:30 left, down 7 with the ball: close
  assert.deepEqual(dueAlerts({ state: 'in', sent: ['start'] }, { state: 'in', period: 4, clock: 390, away: 17, home: 24, ball: 'away' }, 'football', 4), ['close']);
  // same score, but the leading team has the ball: not yet (needs 4 or fewer)
  assert.deepEqual(dueAlerts({ state: 'in', sent: ['start'] }, { state: 'in', period: 4, clock: 390, away: 17, home: 24, ball: 'home' }, 'football', 4), []);
  // leading team has the ball, up 3: close
  assert.deepEqual(dueAlerts({ state: 'in', sent: ['start'] }, { state: 'in', period: 4, clock: 270, away: 20, home: 17, ball: 'away' }, 'football', 4), ['close']);
  // 7:30 left: too early
  assert.deepEqual(dueAlerts({ state: 'in', sent: [] }, { state: 'in', period: 4, clock: 450, away: 20, home: 17, ball: 'home' }, 'football', 4), []);
  // already sent
  assert.deepEqual(dueAlerts({ state: 'in', sent: ['start', 'close'] }, { state: 'in', period: 4, clock: 100, away: 20, home: 17 }, 'football', 4), []);
  // blowout late: nothing
  assert.deepEqual(dueAlerts({ state: 'in', sent: [] }, { state: 'in', period: 4, clock: 100, away: 40, home: 10 }, 'football', 4), []);
  // college hoops: 2 halves, 2:30 left, 4 points
  assert.deepEqual(dueAlerts({ state: 'in', sent: [] }, { state: 'in', period: 2, clock: 150, away: 66, home: 70 }, 'basketball', 2), ['close']);
  // overtime always counts as late
  assert.deepEqual(dueAlerts({ state: 'in', sent: [] }, { state: 'in', period: 5, clock: 290, away: 100, home: 101 }, 'basketball', 4), ['close']);
  // soccer counts up: 85th minute, 1-1
  assert.deepEqual(dueAlerts({ state: 'in', sent: [] }, { state: 'in', period: 2, clock: 85 * 60, away: 1, home: 1 }, 'soccer', 2), ['close']);
  assert.deepEqual(dueAlerts({ state: 'in', sent: ['start'] }, { state: 'post', period: 4, clock: 0, away: 24, home: 21 }, 'football', 4), ['final']);
  // a final seen cold (alerts turned on after the game) does not fire
  assert.deepEqual(dueAlerts(null, { state: 'post', period: 4, clock: 0, away: 24, home: 21 }, 'football', 4), []);
});

test('alerts: wording', () => {
  const g = { away: { abbr: 'WSH', name: 'Commanders' }, home: { abbr: 'NYG', name: 'Giants' }, awayScore: 24, homeScore: 21 };
  assert.equal(alertText('final', g).title, 'Final: Commanders beat Giants');
  assert.equal(alertText('close', g, '2:00 - 4th').body, '2:00 - 4th · Commanders at Giants');
  assert.equal(alertText('start', g).title, 'WSH at NYG is underway');
});
