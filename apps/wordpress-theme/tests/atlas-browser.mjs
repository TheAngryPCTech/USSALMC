// Run against a configured local WordPress + KB API, not production.
// ATLAS_PREVIEW_URL=http://localhost:8093 node apps/wordpress-theme/tests/atlas-browser.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../admin/package.json', import.meta.url));
const { chromium } = require('playwright');
const base = process.env.ATLAS_PREVIEW_URL || 'http://localhost:8093';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const go = async path => { const r = await page.goto(base + path); assert.equal(r.status(), 200, path); };
try {
  await go('/');
  assert.equal(await page.locator('.atlas-category').count(), 6);
  assert.equal(await page.locator('.atlas-brand img').getAttribute('src').then(x => x.split('/').pop()), 'ussa-mark.png');
  await page.locator('.atlas-category').first().click();
  assert.equal(new URL(page.url()).searchParams.get('category'), 'ship');
  assert.match(await page.locator('h1:visible').innerText(), /Find your next ship/);
  const names = () => page.locator('.atlas-entity-card h2').allTextContents();
  const firstPage = await names();
  assert.ok(firstPage.length > 0 && firstPage.length <= 24);
  if (await page.locator('[rel=next]').count()) {
    await page.locator('[rel=next]').click();
    assert.equal(new URL(page.url()).searchParams.get('kb_page'), '2');
    assert.notEqual((await names())[0], firstPage[0]);
  }
  await page.locator('#atlas-category-filter').fill('400i');
  await page.locator('.atlas-filter button').click();
  assert.ok((await names()).every(n => n.toLowerCase().includes('400i')));
  assert.ok((await names()).length > 0);
  assert.equal(new URL(page.url()).searchParams.has('kb_page'), false);
  await page.locator('.atlas-entity-card').first().click();
  assert.equal(await page.locator('.ussalmc-entity__name').innerText(), '400i');
  await go('/wiki/?category=ship&filter=no-such-ship-atlas-check');
  assert.equal(await page.locator('.atlas-entity-card').count(), 0);
  assert.match(await page.locator('.atlas-empty').innerText(), /No matches/);
  await go('/wiki/?category=ship&sort=za');
  const reverseFirst = (await names())[0];
  assert.notEqual(reverseFirst, firstPage[0]);
  await go('/wiki/?category=ship&kb_page=999999');
  assert.ok((await names()).length > 0);
  assert.equal(await page.locator('[rel=next]').count(), 0);
  await go('/wiki/');
  assert.ok(await page.locator('.atlas-directory .atlas-category').count() >= 6);
  await go('/wiki/?q=400i');
  assert.ok(await page.locator('.ussalmc-result').count() > 0);
  await go('/wiki/?tool=sig-ident');
  assert.ok(await page.locator('input[name=sig]').count() > 0);
  await page.locator('input[name=sig]').fill('8600');
  await page.locator('.ussalmc-sig-ident button').click();
  assert.equal(new URL(page.url()).searchParams.get('tool'), 'sig-ident');
  assert.equal(new URL(page.url()).searchParams.get('sig'), '8600');
  assert.ok(await page.locator('input[name=sig]').count() > 0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/wiki/?category=ship', '/wiki/?entity=ship_400i']) {
      await go(path);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}: ${path}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: home/real-logo navigation, ships, page 2, filtering, reset-to-page-1, entity detail, empty state, reverse sort, page clamping, directory, search, mining tool, and three responsive widths; no browser errors.');
} finally { await browser.close(); }
