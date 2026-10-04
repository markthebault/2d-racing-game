import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const output = resolve('outputs/camera-walls-demo');
const destination = resolve('docs/videos');
await mkdir(output, { recursive: true });
await mkdir(destination, { recursive: true });
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const browser = await chromium.launch({
  channel: process.env.RACING_BROWSER_CHANNEL,
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1400, height: 950 },
  recordVideo: { dir: output, size: { width: 1400, height: 950 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const origin = Date.now(),
  clips = [];
const mark = (name) => clips.push({ name, time: (Date.now() - origin) / 1000 });
const canvas = page.locator('.canvas-host canvas');
async function drag(button, dx, dy) {
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.mouse.down({ button });
  await page.mouse.move(
    box.x + box.width * 0.7 + dx,
    box.y + box.height * 0.5 + dy,
    { steps: 10 },
  );
  await page.mouse.up({ button });
}
try {
  await page.goto(process.env.RACING_URL || 'http://127.0.0.1:8093/', {
    waitUntil: 'domcontentloaded',
  });
  await canvas.waitFor({ timeout: 90000 });
  assert.equal(await page.getByRole('button', { name: 'Expand debug menu', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Sensor rays', exact: true }).getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: '3D overhead', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('canvas.camera-interactive'),
  );
  await page.locator('.race-panel').scrollIntoViewIfNeeded();
  mark('Manual free camera');
  await drag('right', 55, -15);
  await drag('left', 30, -20);
  await page.mouse.wheel(0, -550);
  await page.waitForTimeout(2500);
  await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(350);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Fit track', exact: true }).click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1300);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Start race', exact: true }).click();
  await page.locator('.countdown').waitFor();
  await page
    .locator('.countdown')
    .waitFor({ state: 'detached', timeout: 15000 });
  await page.locator('.race-panel').scrollIntoViewIfNeeded();
  mark('Driving into a solid tire wall');
  await page.keyboard.down('ArrowUp');
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(
    () => Number(document.querySelector('.speed strong')?.textContent) > 5,
  );
  await page.waitForFunction(
    () => Number(document.querySelector('.speed strong')?.textContent) === 0,
    null,
    { timeout: 60000 },
  );
  mark('Holding gas stays stopped');
  await page.waitForTimeout(2500);
  assert.equal(Number(await page.locator('.speed strong').innerText()), 0);
  await page.screenshot({ path: `${output}/wall-contact.png` });
  await page.keyboard.up('ArrowUp');
  await page.keyboard.up('ArrowRight');
  mark('Reversing away from the wall');
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(3500);
  await page.keyboard.up('ArrowDown');
  assert.ok(Number(await page.locator('.speed strong').innerText()) > 0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Resume race', exact: true })
    .waitFor();
  mark('Paused camera remains movable');
  await drag('right', -45, 15);
  await drag('left', -30, 15);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Resume race', exact: true }).click();
  await page.waitForTimeout(1500);
  mark('End');
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await browser.close();
}
const recording = await page.video().path();
await writeFile(
  `${output}/clips.json`,
  JSON.stringify({ recording, clips, errors }, null, 2),
);
function encode(args) {
  const result = spawnSync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-filter_threads', '1', ...args],
    { encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
}
const video = `${destination}/manual-camera-walls-demo.mp4`;
encode([
  '-y',
  '-i',
  recording,
  '-vf',
  `trim=start=${clips[0].time}:end=${clips.at(-1).time},setpts=PTS-STARTPTS,scale=1280:868,setsar=1,fps=24`,
  '-an',
  '-c:v',
  'libx264',
  '-threads',
  '2',
  '-preset',
  'fast',
  '-crf',
  '22',
  '-pix_fmt',
  'yuv420p',
  '-movflags',
  '+faststart',
  video,
]);
const contactTime =
  clips.find((clip) => clip.name === 'Holding gas stays stopped').time -
  clips[0].time +
  1;
encode([
  '-y',
  '-ss',
  String(contactTime),
  '-i',
  video,
  '-frames:v',
  '1',
  `${destination}/manual-camera-walls-poster.png`,
]);
console.log(
  `Recorded and checked manual camera navigation, hard tire-wall impact and reverse: ${video}`,
);
