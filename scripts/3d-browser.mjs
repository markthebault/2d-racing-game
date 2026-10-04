import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const output = 'outputs/3d-validation';
await mkdir(output, { recursive: true });
const sourceModel = process.env.TRAINED_MODEL
  ? JSON.parse(await readFile(process.env.TRAINED_MODEL, 'utf8'))
  : null;
const browser = await chromium.launch({
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
// Observe the actual worker. No replacement learner, physics, or model outputs.
await page.addInitScript(() => {
  window.__raceTest = { workers: 0, frames: 0, errors: [] };
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args);
      window.__raceTest.workers++;
      this.addEventListener('message', ({ data: message }) => {
        const state = window.__raceTest;
        if (message.type === 'stats') state.stats = message.stats;
        if (message.type === 'frame') {
          state.frame = message.frame;
          state.frames++;
        }
        if (message.type === 'fleet') state.fleet = message.frame;
        if (message.type === 'checkpoint')
          state.checkpoint = message.checkpoint;
        if (message.type === 'error') state.errors.push(message.message);
      });
    }
  };
});
if (sourceModel)
  await page.addInitScript(
    (model) =>
      localStorage.setItem(
        `pocket-circuit-model-v2-${model.id}`,
        JSON.stringify(model),
      ),
    sourceModel,
  );
const wait = (predicate) =>
  page.waitForFunction(predicate, null, { timeout: 240000 });
async function view(label, mode, effective = mode) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForFunction(
    ([mode, effective]) => {
      const canvas = document.querySelector('.canvas-host canvas');
      return (
        canvas?.dataset.camera === mode &&
        canvas.dataset.effectiveCamera === effective
      );
    },
    [mode, effective],
  );
}
const training = () => page.evaluate(() => window.__raceTest.stats);
const pause = async () => {
  await page.getByRole('button', { name: 'Pause all', exact: true }).click();
  await wait(() => window.__raceTest.stats.status === 'paused');
};
async function loadGuided(model) {
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  await page
    .getByRole('combobox', { name: /^Saved model/ })
    .selectOption(`pocket-circuit-model-v2-${model.id}`);
  const count = await page.evaluate(() => window.__raceTest.workers);
  await page
    .getByRole('button', { name: 'Load on Park oval', exact: true })
    .click();
  await page.waitForFunction(
    (count) =>
      window.__raceTest.workers > count &&
      window.__raceTest.stats?.status === 'ready' &&
      window.__raceTest.stats.best?.guided &&
      window.__raceTest.stats.best.evaluations?.length === 3,
    count,
    { timeout: 240000 },
  );
}
try {
  await page.goto(process.env.RACING_URL || 'http://localhost:8090/', {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.locator('.canvas-host canvas').waitFor({ timeout: 90000 });
  await page
    .getByRole('button', { name: 'Collapse debug menu', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sensor rays', exact: true }).click();
  for (let track = 0; track < 5; track++) {
    await page.locator('.track-option').nth(track).click();
    for (const [label, mode] of [
      ['2D top', 'top'],
      ['3D chase', 'chase'],
      ['3D overhead', 'overhead'],
    ]) {
      await view(label, mode);
      await page
        .locator('.race-panel')
        .screenshot({ path: `${output}/track-${track}-${mode}.png` });
    }
  }
  console.log('PASS: all five circuits render in all three camera views.');
  await page.locator('.track-option').first().click();
  await view('3D chase', 'chase');
  await page.evaluate(() => {
    window.__raceCanvas = document.querySelector('.canvas-host canvas');
  });
  const countdownStart = Date.now();
  await page.getByRole('button', { name: 'Start race', exact: true }).click();
  await page.locator('.countdown').waitFor();
  await page
    .locator('.countdown')
    .waitFor({ state: 'detached', timeout: 15000 });
  assert.ok(
    Date.now() - countdownStart < 10000,
    'The three-second countdown does not stall on software WebGL',
  );
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(900);
  await page.keyboard.up('ArrowUp');
  assert.ok(
    Number(await page.locator('.speed strong').innerText()) > 0,
    'Manual driving accelerates the actual vehicle',
  );
  await page
    .locator('.race-footer')
    .getByRole('button', { name: 'Pause', exact: true })
    .click();
  await page.locator('.game-overlay').waitFor();
  const clock = await page.locator('.hud strong').nth(1).innerText();
  const position = await page
    .locator('.chase-map circle')
    .evaluate((circle) => [
      circle.getAttribute('cx'),
      circle.getAttribute('cy'),
    ]);
  await view('2D top', 'top');
  await view('3D overhead', 'overhead');
  await view('3D chase', 'chase');
  assert.equal(
    await page.locator('.hud strong').nth(1).innerText(),
    clock,
    'Switching cameras retains the paused clock',
  );
  assert.deepEqual(
    await page
      .locator('.chase-map circle')
      .evaluate((circle) => [
        circle.getAttribute('cx'),
        circle.getAttribute('cy'),
      ]),
    position,
  );
  assert.ok(
    await page.evaluate(
      () =>
        window.__raceCanvas === document.querySelector('.canvas-host canvas'),
    ),
    'Camera changes reuse the renderer',
  );
  await page.getByRole('button', { name: 'Resume race', exact: true }).click();
  await page
    .locator('.race-footer')
    .getByRole('button', { name: 'Reset race', exact: true })
    .click();
  await page.locator('.ready-label').waitFor();
  assert.equal(
    await page.locator('.hud strong').nth(1).innerText(),
    '00:00.00',
  );
  console.log(
    'PASS: manual drive, pause, camera switches, resume and reset preserve the correct state.',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [label, mode] of [
    ['3D chase', 'chase'],
    ['3D overhead', 'overhead'],
    ['2D top', 'top'],
  ]) {
    await view(label, mode);
    await page.locator('.race-panel').scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      'No horizontal overflow on mobile',
    );
    await page.screenshot({ path: `${output}/mobile-${mode}.png` });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: 'Train AI', exact: true }).click();
  await wait(() => window.__raceTest.stats?.status === 'ready');
  if (sourceModel) await loadGuided(sourceModel);
  await page.getByLabel('Training speed', { exact: true }).selectOption('0');
  await page
    .getByRole('button', { name: 'Start training', exact: true })
    .click();
  if (!sourceModel) {
    await wait(() => window.__raceTest.stats.status === 'coaching');
    await pause();
    const warmup = await training();
    await view('3D chase', 'chase', 'overhead');
    await view('3D overhead', 'overhead');
    await page.waitForTimeout(250);
    assert.equal((await training()).coachUpdates, warmup.coachUpdates);
    await page.getByRole('button', { name: 'Resume all', exact: true }).click();
  }
  await wait(
    () =>
      window.__raceTest.stats.best?.guided &&
      window.__raceTest.stats.updates > 2 &&
      (window.__raceTest.stats.coachUpdates === 4000 ||
        !window.__raceTest.stats.coachEnabled),
  );
  const guided = await training();
  assert.equal(guided.best.evaluations.length, 3);
  assert.ok(
    guided.best.evaluations.every((result) => result.successRate === 1),
    'The guided network completes all fifteen three-lap evaluation starts',
  );
  console.log(
    `PASS: ${sourceModel ? 'saved guided model and continued RL' : 'real guided warm-up and pause/resume'}, RL updates and 15/15 three-lap evaluation starts.`,
  );
  await pause();
  const guidedModel =
    sourceModel ?? (await page.evaluate(() => window.__raceTest.checkpoint));
  await writeFile(`${output}/trained-model.json`, JSON.stringify(guidedModel));
  // Exercise 50 real short exploratory attempts in a separate fresh session.
  // Long successful three-lap runs would make this CPU regression needlessly slow.
  await page.getByRole('tab', { name: 'Train', exact: true }).click();
  await page
    .locator('summary')
    .filter({ hasText: 'Input parameters & experiment' })
    .click();
  const freshCount = await page.evaluate(() => window.__raceTest.workers);
  await page
    .getByRole('button', { name: 'Start fresh session', exact: true })
    .click();
  await page.waitForFunction(
    (count) =>
      window.__raceTest.workers > count &&
      window.__raceTest.stats.status === 'ready' &&
      window.__raceTest.stats.steps === 0,
    freshCount,
  );
  await page.getByLabel('Number of laps', { exact: true }).fill('1');
  await wait(
    () =>
      window.__raceTest.stats.status === 'ready' &&
      window.__raceTest.stats.targetLaps === 1,
  );
  await page
    .locator('summary')
    .filter({ hasText: /^Training setup/ })
    .click();
  // This controlled checkbox is acknowledged by the worker asynchronously.
  await page.getByLabel('Guided warm-up before RL', { exact: true }).click();
  await wait(() => window.__raceTest.stats.coachEnabled === false);
  await page.getByLabel('Training speed', { exact: true }).selectOption('0');
  await page
    .getByRole('button', { name: 'Start training', exact: true })
    .click();
  await wait(
    () =>
      window.__raceTest.stats.episode >= 50 &&
      window.__raceTest.fleet?.poses.length > 0,
  );
  await pause();
  const fleetStats = await training();
  await view('3D chase', 'chase', 'overhead');
  const fleetTime = await page.evaluate(() => window.__raceTest.fleet.time);
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(() => window.__raceTest.fleet.time),
    fleetTime,
  );
  await page
    .locator('.race-panel')
    .screenshot({ path: `${output}/fleet-3d.png` });
  assert.ok(
    await page.evaluate(() => window.__raceTest.fleet.poses.length <= 50),
  );
  console.log(
    'PASS: real 50-attempt fleet replay remains visible from overhead, and pause freezes it.',
  );
  await page.getByLabel('Number of laps', { exact: true }).fill('3');
  await wait(() => window.__raceTest.stats.targetLaps === 3);
  await loadGuided(guidedModel);
  await view('3D chase', 'chase', 'overhead');
  await page.getByLabel('Training speed', { exact: true }).selectOption('0');
  await page
    .getByRole('button', { name: 'Run best model', exact: true })
    .click();
  await wait(
    () =>
      window.__raceTest.stats.status === 'playing' &&
      window.__raceTest.frame?.time > 0.2,
  );
  await page.waitForFunction(
    () =>
      document.querySelector('.canvas-host canvas').dataset.effectiveCamera ===
      'chase',
  );
  await pause();
  const before = await training(),
    frameBefore = await page.evaluate(() => window.__raceTest.frame);
  const workerCount = await page.evaluate(() => window.__raceTest.workers);
  for (const [label, mode] of [
    ['2D top', 'top'],
    ['3D overhead', 'overhead'],
    ['3D chase', 'chase'],
  ])
    await view(label, mode);
  const after = await training();
  for (const key of [
    'steps',
    'updates',
    'episode',
    'replaySize',
    'playbackEpisode',
  ])
    assert.equal(after[key], before[key], key);
  assert.equal(
    await page.evaluate(() => window.__raceTest.frame.time),
    frameBefore.time,
  );
  assert.equal(
    await page.evaluate(() => window.__raceTest.workers),
    workerCount,
    'View changes retain the same learning worker',
  );
  await page
    .locator('.race-footer')
    .getByRole('button', { name: 'Reset race', exact: true })
    .click();
  await wait(() => window.__raceTest.frame.time === 0);
  assert.equal((await training()).status, 'paused');
  assert.equal((await training()).steps, before.steps);
  await page
    .locator('.race-footer')
    .getByRole('button', { name: 'Resume', exact: true })
    .click();
  await page.waitForFunction(
    (steps) =>
      window.__raceTest.frame.time > 0.5 &&
      window.__raceTest.stats.steps > steps,
    before.steps,
    { timeout: 240000 },
  );
  await pause();
  await page
    .locator('.race-panel')
    .screenshot({ path: `${output}/best-model-chase.png` });
  const state = await page.evaluate(() => window.__raceTest);
  assert.deepEqual(state.errors, []);
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/browser-report.json`,
    JSON.stringify(
      {
        views: 3,
        circuits: 5,
        mobileWidth: 390,
        fleetEpisodes: fleetStats.episode,
        fleetUpdates: fleetStats.updates,
        guidedUpdates: guided.updates,
        playbackUpdates: state.stats.updates,
        guidedEvaluations: guided.best.evaluations,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: best-model chase, camera switches retain learning state, paused reset, resumed background learning, mobile layout, and zero browser/worker errors.',
  );
} catch (error) {
  const state = await page.evaluate(() => window.__raceTest).catch(() => null);
  await writeFile(
    `${output}/failure-state.json`,
    JSON.stringify(state, null, 2),
  );
  console.error('Last state:', {
    workers: state?.workers,
    errors: state?.errors,
    status: state?.stats?.status,
    episode: state?.stats?.episode,
    coachUpdates: state?.stats?.coachUpdates,
    steps: state?.stats?.steps,
  });
  await page
    .screenshot({ path: `${output}/failure.png`, fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
