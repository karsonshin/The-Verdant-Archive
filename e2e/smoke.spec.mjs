// Browser tests against the built container: docker compose run --rm e2e
import { test, expect } from '@playwright/test';

test('health endpoint and landing page render', async ({ page, request }) => {
  expect((await request.get('/healthz')).ok()).toBeTruthy();
  await page.goto('/');
  await expect(page).toHaveTitle(/Verdant Archive/);
  await expect(page.locator('.home')).toBeVisible();
});

test('gallery grid opens the lightbox and arrow keys navigate', async ({ page }) => {
  await page.goto('/#/gallery');
  await page.locator('a.tile').first().click();
  const img = page.locator('.lb .lb-img');
  await expect(img).toBeVisible();
  const count = page.locator('.lb-count');
  const first = await count.textContent();
  await page.keyboard.press('ArrowRight');
  await expect(count).not.toHaveText(first);
  await page.keyboard.press('Escape');
  await expect(page.locator('.lb')).toBeHidden();
});

test('media loads from the CDN when mediaBase is set', async ({ page }) => {
  const cdn = 'https://cdn.example.test';
  await page.route('**/site.config.json', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), mediaBase: cdn } });
  });
  // pretend the CDN is an origin-pull of this site
  await page.route(`${cdn}/media/**`, (route) => route.continue({ url: route.request().url().replace(cdn, 'http://site:8080') }));
  const cdnReq = page.waitForRequest((r) => r.url().startsWith(`${cdn}/media/`));
  await page.goto('/#/gallery');
  await cdnReq;
  await expect.poll(() => page.locator('a.tile img').first().evaluate((i) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
});
