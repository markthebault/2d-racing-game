import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) =>
    raf((time) => setTimeout(() => fn(time), 100));
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data: m }) => {
        if (m.type === 'stats') window.rlStats = m.stats;
        if (m.type === 'insight') window.insight = m.reading;
        if (m.type === 'error') window.rlError = m.message;
      });
    }
  };
});
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 120000 });
try {
  await page.goto(process.env.RACING_URL || 'http://100.90.198.2:8088/');
  await page.getByRole('button', { name: 'Train AI', exact: true }).click();
  await wait(() => window.rlStats?.status === 'ready');
  await page.getByRole('button', { name: /See how the AI learns/ }).click();
  await wait(() => window.insight?.network.hidden.length === 2);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Network', exact: true }).click();
  assert.equal(await page.locator('.neuron-grid span').count(), 128);
  await page.waitForTimeout(350);
  await page.screenshot({ path: '/tmp/learning-network-desktop.png' });
  await dialog
    .getByRole('button', { name: 'Walk through a run', exact: true })
    .click();
  await wait(
    () =>
      window.insight?.source === 'walkthrough' &&
      window.rlStats.status === 'paused',
  );
  const before = await page.evaluate(() => ({
    steps: window.rlStats.steps,
    updates: window.rlStats.updates,
  }));
  await dialog.getByRole('button', { name: 'Decision', exact: true }).click();
  await dialog.getByRole('button', { name: /Accelerate \/ straight:/ }).click();
  await dialog.getByRole('button', { name: 'Next 0.1 s', exact: true }).click();
  await wait(() => window.insight?.after?.time > 0);
  assert.equal(await page.evaluate(() => window.insight.action), 1);
  assert.equal(await page.evaluate(() => window.insight.manual), true);
  assert.equal(await page.evaluate(() => window.rlStats.steps), before.steps);
  assert.equal(
    await page.evaluate(() => window.rlStats.updates),
    before.updates,
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: '/tmp/learning-decision-desktop.png' });
  await dialog.getByLabel('Walkthrough start').selectOption(String(1 / 3));
  await wait(
    () => window.insight?.after === null && window.insight?.before.time === 0,
  );
  assert.equal(await page.evaluate(() => window.insight.manual), false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByLabel('Guided warm-up before RL', { exact: true }).click();
  await wait(() => !window.rlStats.coachEnabled);
  await page.locator('.training-actions select').first().selectOption('0');
  await page.locator('.train-button').click();
  await page.getByRole('button', { name: /See how the AI learns/ }).click();
  await wait(() => window.insight?.update?.update > 1);
  await dialog
    .getByRole('button', { name: 'Learning update', exact: true })
    .click();
  assert.equal(await page.locator('.replay-samples button').count(), 8);
  const held = await page.locator('.replay-samples').innerText();
  const updates = await page.evaluate(() => window.rlStats.updates);
  await wait(() => window.rlStats.updates > 0);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.replay-samples').innerText(), held);
  await dialog
    .getByRole('button', { name: 'Refresh sampled update', exact: true })
    .click();
  assert.ok((await page.evaluate(() => window.rlStats.updates)) >= updates);
  await page.locator('.replay-samples button').nth(3).click();
  assert.equal(
    await page
      .locator('.replay-samples button')
      .nth(3)
      .getAttribute('aria-pressed'),
    'true',
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: '/tmp/learning-update-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Network', exact: true }).click();
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: '/tmp/learning-network-mobile.png' });
  await page.locator('.neuron-grid').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  await page.screenshot({ path: '/tmp/learning-neurons-mobile.png' });
  await dialog.getByRole('button', { name: 'Decision', exact: true }).click();
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
    false,
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: '/tmp/learning-decision-mobile.png' });
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => window.rlError), undefined);
  console.log(
    'PASS: real activations, isolated manual steps, restart, live replay updates, desktop and mobile dialogs, no browser errors.',
  );
} finally {
  await browser.close();
}
