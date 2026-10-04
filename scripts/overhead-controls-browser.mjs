import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import * as THREE from 'three';

const output = 'outputs/overhead-controls';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
// Read matrices and instanced draws uploaded to the real WebGL renderer.
// Observe the real worker without replacing simulations or network outputs.
await page.addInitScript(() => {
  window.__overhead = { fleetDraws: 0, groups: [], errors: [] };
  const locations = new WeakMap();
  const getLocation = Reflect.get(
    WebGL2RenderingContext.prototype,
    'getUniformLocation',
  );
  WebGL2RenderingContext.prototype.getUniformLocation = function (
    program,
    name,
  ) {
    const location = getLocation.call(this, program, name);
    if (location) locations.set(location, name);
    return location;
  };
  const uploadMatrix = Reflect.get(
    WebGL2RenderingContext.prototype,
    'uniformMatrix4fv',
  );
  WebGL2RenderingContext.prototype.uniformMatrix4fv = function (
    location,
    transpose,
    value,
    ...rest
  ) {
    if (locations.get(location) === 'viewMatrix')
      window.__overhead.viewMatrix = Array.from(value);
    return uploadMatrix.call(this, location, transpose, value, ...rest);
  };
  const draw = Reflect.get(
    WebGL2RenderingContext.prototype,
    'drawElementsInstanced',
  );
  WebGL2RenderingContext.prototype.drawElementsInstanced = function (...args) {
    if (args[4] > 0 && args[4] <= 50) window.__overhead.fleetDraws++;
    return draw.apply(this, args);
  };
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', ({ data: message }) => {
        const state = window.__overhead;
        if (message.type === 'stats') state.stats = message.stats;
        if (message.type === 'fleet') {
          state.fleet = message.frame;
          if (message.frame && state.groups.at(-1) !== message.frame.first)
            state.groups.push(message.frame.first);
        }
        if (message.type === 'error') state.errors.push(message.message);
      });
    }
  };
});
const wait = (predicate) =>
  page.waitForFunction(predicate, null, { timeout: 180000 });
const canvas = page.locator('.canvas-host canvas');
async function camera() {
  // Wait for an actual render, rather than sampling a stale matrix on slow GPUs.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const values = await page.evaluate(() => window.__overhead.viewMatrix);
  assert.equal(values?.length, 16, 'Renderer uploads an actual camera matrix');
  const matrix = new THREE.Matrix4().fromArray(values).invert();
  return {
    position: new THREE.Vector3().setFromMatrixPosition(matrix),
    matrix,
  };
}
async function fit() {
  await page.getByRole('button', { name: 'Fit track', exact: true }).click();
  await page.waitForTimeout(200);
}
async function holdArrow(shift = false) {
  if (shift) await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowRight');
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
}
async function drag(button, dx, dy) {
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up({ button });
  await page.waitForTimeout(200);
}
try {
  await page.goto(process.env.RACING_URL || 'http://127.0.0.1:8093/', {
    waitUntil: 'domcontentloaded',
  });
  await canvas.waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Train AI', exact: true }).click();
  await wait(() => window.__overhead.stats?.status === 'ready');
  await page.getByRole('button', { name: '3D overhead', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('canvas.camera-interactive'),
  );
  await page.waitForTimeout(300);
  const initial = await camera();
  await holdArrow();
  const normalDistance = (await camera()).position.distanceTo(initial.position);
  assert.ok(normalDistance > 1, 'Arrow keys pan the real camera');
  await fit();
  const restored = await camera();
  assert.ok(
    restored.position.distanceTo(initial.position) < 0.001,
    `Fit track: ${restored.position.toArray().join(',')} vs initial ${initial.position.toArray().join(',')}`,
  );
  await holdArrow(true);
  const fastDistance = (await camera()).position.distanceTo(initial.position);
  console.log('Keyboard movement', { normalDistance, fastDistance });
  assert.ok(
    fastDistance > normalDistance * 1.5,
    'Shift accelerates keyboard panning',
  );
  await fit();
  await drag('left', 80, 45);
  const panned = await camera();
  assert.ok(panned.position.distanceTo(initial.position) > 1, 'Left-drag pans');
  await drag('right', 65, 20);
  const rotated = await camera();
  assert.ok(
    rotated.matrix.elements.some(
      (value, i) =>
        i < 12 && Math.abs(value - panned.matrix.elements[i]) > 0.01,
    ),
    'Right-drag changes orientation',
  );
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(200);
  const zoomed = await camera();
  assert.ok(zoomed.position.distanceTo(rotated.position) > 1, 'Wheel zooms');
  await page.getByRole('button', { name: '2D top', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('canvas.camera-interactive'),
  );
  const top = await camera();
  await holdArrow();
  assert.ok(
    (await camera()).position.distanceTo(top.position) < 0.001,
    'Keys do not move the top camera',
  );
  await page.getByRole('button', { name: '3D overhead', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('canvas.camera-interactive'),
  );
  assert.ok(
    (await camera()).position.distanceTo(zoomed.position) < 0.001,
    'View switches retain overhead position',
  );
  await page.setViewportSize({ width: 1250, height: 900 });
  await page.waitForTimeout(300);
  assert.ok(
    (await camera()).position.distanceTo(zoomed.position) < 0.001,
    'Resize retains the custom view',
  );
  await fit();
  const resizedFit = await camera();
  console.log(
    'PASS: drag pan, right-drag rotation, wheel zoom, arrows, Shift speed, Fit track, view switches and resize.',
  );

  await page.getByLabel('Number of laps', { exact: true }).fill('1');
  await wait(
    () =>
      window.__overhead.stats.targetLaps === 1 &&
      window.__overhead.stats.status === 'ready',
  );
  await page
    .locator('summary')
    .filter({ hasText: /^Training setup/ })
    .click();
  await page.getByLabel('Guided warm-up before RL', { exact: true }).click();
  await wait(() => window.__overhead.stats.coachEnabled === false);
  await page.getByLabel('Training speed', { exact: true }).selectOption('0');
  await page
    .getByRole('button', { name: 'Start training', exact: true })
    .click();
  await wait(() => window.__overhead.stats.steps > 10);
  const liveSteps = await page.evaluate(() => window.__overhead.stats.steps);
  await canvas.click();
  await holdArrow();
  await page.waitForFunction(
    (steps) => window.__overhead.stats.steps > steps,
    liveSteps,
  );
  for (const first of [1, 51]) {
    await page.waitForFunction(
      (first) => window.__overhead.fleet?.first === first,
      first,
      { timeout: 180000 },
    );
    await page.getByRole('button', { name: 'Pause all', exact: true }).click();
    await wait(() => window.__overhead.stats.status === 'paused');
    const before = await page.evaluate(() => ({
      stats: window.__overhead.stats,
      fleet: window.__overhead.fleet,
      draws: window.__overhead.fleetDraws,
    }));
    assert.equal(before.fleet.last, first + 49);
    assert.ok(before.fleet.poses.length > 0);
    assert.ok(before.draws > 0, 'Replay cars are drawn by WebGL');
    await fit();
    assert.ok(
      (await camera()).position.distanceTo(resizedFit.position) < 0.001,
    );
    await canvas.click();
    await holdArrow(true);
    await drag('left', -50, -25);
    await fit();
    const after = await page.evaluate(() => ({
      stats: window.__overhead.stats,
      fleet: window.__overhead.fleet,
      draws: window.__overhead.fleetDraws,
    }));
    for (const key of ['steps', 'updates', 'episode', 'replaySize'])
      assert.equal(after.stats[key], before.stats[key], key);
    assert.equal(
      after.fleet.time,
      before.fleet.time,
      'Camera controls preserve paused replay time',
    );
    assert.ok(
      after.draws > before.draws,
      'Navigation redraws the paused fleet',
    );
    await page
      .locator('.race-panel')
      .screenshot({ path: `${output}/replay-${first}.png` });
    console.log(
      `PASS: episodes ${first}–${first + 49} render; camera controls preserve the paused learner and replay.`,
    );
    await page.getByRole('button', { name: 'Resume all', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Pause all', exact: true }).click();
  await wait(() => window.__overhead.stats.status === 'paused');
  await page
    .locator('summary')
    .filter({ hasText: 'Input parameters & experiment' })
    .click();
  const seed = page.getByLabel('Training seed', { exact: true });
  await seed.focus();
  const beforeInput = await camera();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  assert.ok(
    (await camera()).position.distanceTo(beforeInput.position) < 0.001,
    'Arrow keys in inputs do not pan',
  );
  await page.getByRole('button', { name: 'Manual drive', exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector('canvas.camera-interactive'),
  );
  await page.getByRole('button', { name: 'Start race', exact: true }).click();
  await page.locator('.countdown').waitFor();
  await page
    .locator('.countdown')
    .waitFor({ state: 'detached', timeout: 15000 });
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowUp');
  assert.ok(
    Number(await page.locator('.speed strong').innerText()) > 0,
    'Manual arrow-key driving still works',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => window.__overhead.errors), []);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      { normalDistance, fastDistance, replayGroups: [1, 51], errors },
      null,
      2,
    ),
  );
  console.log(
    'PASS: focused inputs and manual driving retain their normal arrow-key behavior; zero browser or worker errors.',
  );
} catch (error) {
  console.error(
    'Browser state:',
    errors,
    await page.evaluate(() => ({
      matrix: window.__overhead.viewMatrix,
      stats: window.__overhead.stats?.status,
    })),
  );
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
