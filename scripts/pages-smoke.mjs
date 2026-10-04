import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const origin = process.env.RACING_URL || 'http://127.0.0.1:5264';
const preview = process.env.RACING_URL ? null : spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', '5264', '--strictPort'],
  { stdio: 'pipe' });
let output = '';
preview?.stdout.on('data', chunk => { output += chunk; });
preview?.stderr.on('data', chunk => { output += chunk; });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    if (preview?.exitCode != null) throw new Error(output);
    try { if ((await fetch(origin)).ok) break; } catch { /* Starting preview. */ }
    if (i === 99) throw new Error(`Preview did not start: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    channel: process.env.RACING_BROWSER_CHANNEL || 'chrome',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.addInitScript(() => {
    window.__pagesWorkerErrors = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'stats') window.__pagesStats = data.stats;
          if (data.type === 'error') window.__pagesWorkerErrors.push(data.message);
        });
      }
    };
  });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.locator('.track-option').count(), 5);
  await page.waitForSelector('.canvas-host canvas');
  assert.equal(await page.locator('.game-overlay[role=alert]').count(), 0);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(247, 248, 245)');
  assert.equal(await page.evaluate(() => document.fonts.check('400 16px "Inter Variable"')), true);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
  await mkdir('docs/previews', { recursive: true });
  await page.screenshot({ path: 'docs/previews/desktop.png', fullPage: true });
  assert.equal(await page.locator('.debug-dock').evaluate(element => element.classList.contains('is-open')), false);
  for (const circuit of ['Pine bend', 'Desert switchback', 'Coastal sweep', 'Slate canyon', 'Park oval']) {
    await page.getByRole('button', { name: new RegExp(circuit) }).click();
    await page.waitForFunction(name => document.querySelector('.race-heading h2')?.textContent === name, circuit);
    await page.waitForSelector('.canvas-host canvas');
  }
  await page.getByRole('button', { name: 'Fewer laps', exact: true }).click();
  await page.getByRole('button', { name: 'Fewer laps', exact: true }).click();
  assert.equal(await page.getByLabel('Number of laps').inputValue(), '1');
  await page.getByRole('button', { name: 'Start race', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mode-tag')?.textContent === 'TIME ATTACK');
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => Number(document.querySelector('.speed strong')?.textContent) > 0);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('heading', { name: 'Taking a pit stop.' }).isVisible(), true);
  await page.getByRole('button', { name: 'Resume race', exact: true }).click();
  await page.getByRole('button', { name: 'Reset race', exact: true }).click();
  await page.getByRole('button', { name: 'Expand debug menu', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: 'Controls & position', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: 'Show rays', exact: true }).click();
  await page.getByRole('button', { name: 'Hide rays', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse debug menu', exact: true }).click();
  await page.getByRole('button', { name: 'Train AI', exact: true }).click();
  await page.waitForFunction(() => window.__pagesStats?.status === 'ready', null, { timeout: 60000 });
  await page.locator('.lab-disclosure').first().locator('summary').first().click();
  await page.getByLabel('Guided warm-up before RL', { exact: true }).click();
  await page.waitForFunction(() => window.__pagesStats?.coachEnabled === false);
  await page.locator('.training-actions select').first().selectOption('0');
  await page.getByRole('button', { name: 'Start training', exact: true }).click();
  await page.waitForFunction(() => window.__pagesStats?.steps > 10, null, { timeout: 60000 });
  await page.getByRole('button', { name: 'Pause all', exact: true }).click();
  await page.waitForFunction(() => window.__pagesStats?.status === 'paused');
  const pausedSteps = await page.evaluate(() => window.__pagesStats.steps);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__pagesStats.steps), pausedSteps);
  for (const name of ['Results', 'Models', 'Learn', 'Train']) {
    await page.getByRole('tab', { name, exact: true }).click();
    assert.equal(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'), 'true');
  }
  await mkdir('docs/previews', { recursive: true });
  await page.screenshot({ path: 'docs/previews/ai-desktop.png', fullPage: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `AI view overflows at ${width}px`);
  }
  await page.getByRole('button', { name: 'Manual drive', exact: true }).click();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Racing view overflows at ${width}px`);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'docs/previews/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'docs/previews/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Start race', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mode-tag')?.textContent === 'TIME ATTACK');
  const accelerator = page.getByRole('button', { name: 'Accelerate', exact: true });
  await accelerator.scrollIntoViewIfNeeded();
  const box = await accelerator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => Number(document.querySelector('.speed strong')?.textContent) > 0);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Reset race', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__pagesWorkerErrors), []);
  assert.deepEqual(errors, []);
  console.log('Passed: five circuits, branding and image loading, keyboard and touch acceleration, pause/resume/reset, sensor controls, real static training worker, AI tabs, and five responsive widths.');
} finally {
  await browser?.close();
  preview?.kill();
}
