import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_PASS_PRODUCTS, passAcceptedStars, passProductConfig } from '../src/entitlements.js';

const cfg = { passPrices: { MATCH_PASS: 75, DAY_PASS: 150, WEEKEND_PASS: 299 }, passUsageLimits: { WEEKEND_PASS: 6 } };

test('new prices come from configuration; completed payments at the previous default price are still accepted', () => {
  const match = passProductConfig('MATCH_PASS', cfg);
  assert.equal(match.stars, 75);
  assert.deepEqual([...passAcceptedStars(match)].sort((a, b) => a - b), [39, 75]);
  assert.deepEqual([...passAcceptedStars(passProductConfig('DAY_PASS', cfg))].sort((a, b) => a - b), [89, 150]);
  assert.deepEqual([...passAcceptedStars(passProductConfig('WEEKEND_PASS', cfg))].sort((a, b) => a - b), [149, 299]);
  assert.equal(passAcceptedStars(passProductConfig('MATCH_PASS', cfg)).has(50), false, 'any other amount is rejected');
  assert.equal(DEFAULT_PASS_PRODUCTS.MATCH_PASS.stars, 39);
});

test('a pass payment records the amount actually paid; pre-checkout accepts only the current price', () => {
  const entitlements = fs.readFileSync('src/entitlements.js', 'utf8');
  assert.match(entitlements, /paidStars === null \|\| !passAcceptedStars\(product\)\.has\(paidStars\)/);
  assert.match(entitlements, /p_stars_amount: paidStars,/);
  assert.match(entitlements, /stars_amount:paidStars,/);
  const orchestration = fs.readFileSync('src/telegram-update-orchestration.js', 'utf8');
  assert.match(orchestration, /samePositiveInteger\(planCfg\.stars,checkoutAmount\)/, 'pre-checkout compares with the current plan price only');
});

test('production prices are set in wrangler vars', () => {
  const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
  for (const [name, value] of Object.entries({ PRO_STARS_PRICE: 499, PREMIUM_STARS_PRICE: 999, MATCH_PASS_STARS_PRICE: 75, DAY_PASS_STARS_PRICE: 150, WEEKEND_PASS_STARS_PRICE: 299 })) {
    assert.match(wrangler, new RegExp(`"${name}": "${value}"`), name);
  }
});
