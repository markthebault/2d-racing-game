import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const output = resolve('outputs/3d-demo'),
  destination = resolve('docs/videos');
await mkdir(output, { recursive: true });
await mkdir(destination, { recursive: true });
const model = JSON.parse(
  await readFile('outputs/3d-validation/trained-model.json', 'utf8'),
);
assert.ok(
  model?.guided && model.weights,
  'Run scripts/3d-browser.mjs first to produce a real trained checkpoint',
);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const recordOnly = process.env.RECORD_ONLY === '1';
if (recordOnly) {
  const report = JSON.parse(
    await readFile(`${output}/playback-report.json`, 'utf8'),
  );
  assert.ok(
    report.pausedReset &&
      report.cameraSwitchesRetainState &&
      report.stepsAfter > report.stepsBefore &&
      !report.errors.length,
    'The playback regression must pass before recording without repeating it',
  );
}
const browser = await chromium.launch({
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1200 },
  recordVideo: { dir: output, size: { width: 1600, height: 1200 } },
});
await context.addInitScript(
  ({ model }) => {
    localStorage.setItem(
      `pocket-circuit-model-v2-${model.id}`,
      JSON.stringify(model),
    );
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data: m }) => {
          if (m.type === 'stats') window.__demoStats = m.stats;
          if (m.type === 'frame') window.__demoFrame = m.frame;
          if (m.type === 'error') window.__demoError = m.message;
        });
      }
    };
  },
  { model },
);
const origin = Date.now(),
  page = await context.newPage(),
  errors = [],
  clips = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const wait = (predicate) =>
  page.waitForFunction(predicate, null, { timeout: 240000 });
async function shot(name, milliseconds) {
  await page.mouse.move(1590, 1190);
  const start = (Date.now() - origin) / 1000;
  await page.waitForTimeout(milliseconds);
  clips.push({ name, start, duration: (Date.now() - origin) / 1000 - start });
}
try {
  await page.goto(process.env.RACING_URL || 'http://localhost:8090/', {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('.canvas-host canvas').waitFor();
  await page
    .getByRole('button', { name: 'Collapse debug menu', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sensor rays', exact: true }).click();
  await page.getByRole('button', { name: '3D chase', exact: true }).click();
  await page.getByRole('button', { name: 'Train AI', exact: true }).click();
  await wait(() => window.__demoStats?.status === 'ready');
  await page.getByRole('tab', { name: 'Models', exact: true }).click();
  await page
    .getByRole('combobox', { name: /^Saved model/ })
    .selectOption(`pocket-circuit-model-v2-${model.id}`);
  await page
    .getByRole('button', { name: 'Load on Park oval', exact: true })
    .click();
  await wait(
    () =>
      window.__demoStats?.status === 'ready' && window.__demoStats.best?.guided,
  );
  await page.getByLabel('Training speed', { exact: true }).selectOption('0');
  await page
    .getByRole('button', { name: 'Run best model', exact: true })
    .click();
  await wait(
    () =>
      window.__demoStats?.status === 'playing' &&
      window.__demoFrame?.time > 0.2,
  );
  // Finish the playback regression before collecting the demonstration clips.
  if (!recordOnly) {
    await page.getByRole('button', { name: 'Pause all', exact: true }).click();
    await wait(() => window.__demoStats.status === 'paused');
    const before = await page.evaluate(() => ({
      stats: window.__demoStats,
      time: window.__demoFrame.time,
    }));
    for (const name of ['2D top', '3D overhead', '3D chase'])
      await page.getByRole('button', { name, exact: true }).click();
    const after = await page.evaluate(() => ({
      stats: window.__demoStats,
      time: window.__demoFrame.time,
    }));
    for (const key of [
      'steps',
      'updates',
      'episode',
      'replaySize',
      'playbackEpisode',
    ])
      assert.equal(after.stats[key], before.stats[key]);
    assert.equal(after.time, before.time);
    await page
      .locator('.race-footer')
      .getByRole('button', { name: 'Reset race', exact: true })
      .click();
    await wait(() => window.__demoFrame.time === 0);
    assert.equal(
      await page.evaluate(() => window.__demoStats.status),
      'paused',
    );
    assert.equal(
      await page.evaluate(() => window.__demoStats.steps),
      before.stats.steps,
    );
    await page
      .locator('.race-footer')
      .getByRole('button', { name: 'Resume', exact: true })
      .click();
    await page.waitForFunction(
      (steps) =>
        window.__demoFrame.time > 0.5 && window.__demoStats.steps > steps,
      before.stats.steps,
      { timeout: 240000 },
    );
    await page.getByRole('button', { name: 'Pause all', exact: true }).click();
    await wait(() => window.__demoStats.status === 'paused');
    assert.equal(await page.evaluate(() => window.__demoError), undefined);
    assert.deepEqual(errors, []);
    await writeFile(
      `${output}/playback-report.json`,
      JSON.stringify(
        {
          cameraSwitchesRetainState: true,
          pausedReset: true,
          resumedTime: await page.evaluate(() => window.__demoFrame.time),
          stepsBefore: before.stats.steps,
          stepsAfter: await page.evaluate(() => window.__demoStats.steps),
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS: model playback, retained state across all cameras, paused reset, resumed playback and independent background learning.',
    );
  } else {
    await page.getByRole('button', { name: 'Pause all', exact: true }).click();
    await wait(() => window.__demoStats.status === 'paused');
  }

  // Start a new visible run with the validated best snapshot, then record.
  await page
    .getByRole('button', { name: 'Run best model', exact: true })
    .click();
  await wait(() => window.__demoStats.status === 'playing');
  await page.getByRole('button', { name: 'Pause all', exact: true }).click();
  await wait(() => window.__demoStats.status === 'paused');
  await page
    .locator('.race-footer')
    .getByRole('button', { name: 'Reset race', exact: true })
    .click();
  await wait(() => window.__demoFrame.time === 0);
  await wait(
    () =>
      document.querySelectorAll('.hud strong')[1]?.textContent === '00:00.00',
  );
  await page.waitForTimeout(300);
  await shot('Chase camera on the grid', 2500);
  await page
    .locator('.race-footer')
    .getByRole('button', { name: 'Resume', exact: true })
    .click();
  await wait(
    () =>
      window.__demoStats.status === 'playing' && window.__demoFrame.time > 0.2,
  );
  // Capturing a clipped screenshot here alters Chromium's screencast surface.
  // Extract the poster from the completed video instead.
  await shot('Real trained model in 3D chase', 13000);
  await page.getByRole('button', { name: '3D overhead', exact: true }).click();
  await shot('Far overhead while the same model drives', 6000);
  await page.getByRole('button', { name: '2D top', exact: true }).click();
  await shot('Original top view during the same run', 3500);
  await page.getByRole('button', { name: '3D chase', exact: true }).click();
  await page.getByRole('button', { name: 'Pause all', exact: true }).click();
  await wait(() => window.__demoStats.status === 'paused');
  await page
    .locator('.race-footer')
    .getByRole('button', { name: 'Reset race', exact: true })
    .click();
  await wait(() => window.__demoFrame.time === 0);
  await wait(
    () =>
      document.querySelectorAll('.hud strong')[1]?.textContent === '00:00.00',
  );
  await page.waitForTimeout(300);
  await shot('Paused reset preserves the learner', 2000);
  await page
    .locator('.race-footer')
    .getByRole('button', { name: 'Resume', exact: true })
    .click();
  await wait(() => window.__demoFrame.time > 0.2);
  await shot('Resumed model and background learning', 4000);
  assert.equal(await page.evaluate(() => window.__demoError), undefined);
  assert.deepEqual(errors, []);
  console.log(
    'Recorded actual model driving, camera switches, paused reset and resumed training.',
  );
} finally {
  await context.close();
  await browser.close();
}
const recording = await page.video().path();
await writeFile(
  `${output}/clips.json`,
  JSON.stringify({ recording, clips }, null, 2),
);
const start = Math.max(0, clips[0].start - 0.2),
  end = clips.at(-1).start + clips.at(-1).duration;
// Keep the transitions in one continuous take, trimming setup and evaluation.
const filter = `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,scale=1280:960,setsar=1,fps=24[v]`;
const result = spawnSync(
  ffmpeg,
  [
    '-y',
    '-i',
    recording,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    `${destination}/3d-racing-demo.mp4`,
  ],
  { encoding: 'utf8' },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr);
const poster = spawnSync(
  ffmpeg,
  [
    '-y',
    '-ss',
    '16',
    '-i',
    `${destination}/3d-racing-demo.mp4`,
    '-frames:v',
    '1',
    `${destination}/3d-racing-poster.png`,
  ],
  { encoding: 'utf8' },
);
if (poster.error) throw poster.error;
if (poster.status !== 0) throw new Error(poster.stderr);
console.log(
  `Video: ${destination}/3d-racing-demo.mp4 (${(end - start).toFixed(1)} s)`,
);
