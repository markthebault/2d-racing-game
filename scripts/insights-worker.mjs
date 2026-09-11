import { Worker } from 'node:worker_threads';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const folder = resolve('dist/client/_next/static');
const file = (await readdir(folder)).find((name) =>
  /^training\.worker-.*\.js$/.test(name),
);
assert.ok(file, 'Training worker must be included in the build');
const chunks = await readdir(resolve(folder, 'chunks'));
const page = (
  await Promise.all(
    chunks
      .filter((name) => /^page-.*\.js$/.test(name))
      .map((name) => readFile(resolve(folder, 'chunks', name), 'utf8')),
  )
).join('\n');
const constructor = page.match(/new Worker\(new URL\([^)]*\)/)?.[0];
assert.ok(
  constructor?.includes('window.location.href'),
  'Resolve the worker against the HTTP page, not a build-time file URL',
);
assert.ok(!constructor.includes('file:'));
assert.ok(page.includes(file));
const script = `import {parentPort} from 'node:worker_threads'; globalThis.self=globalThis; globalThis.process=undefined; globalThis.WorkerGlobalScope=class {}; globalThis.postMessage=(message)=>parentPort.postMessage(message); await import(${JSON.stringify(pathToFileURL(resolve(folder, file)).href)}); parentPort.on('message',data=>globalThis.onmessage({data}));`;
function launch() {
  const worker = new Worker(
    new URL('data:text/javascript,' + encodeURIComponent(script)),
    { type: 'module' },
  );
  const messages = [];
  let latest;
  worker.on('error', (error) =>
    messages.push({ type: 'error', message: error.message }),
  );
  worker.on('message', (m) => {
    messages.push(m);
    if (m.type === 'stats') latest = m.stats;
  });
  return {
    worker,
    messages,
    get latest() {
      return latest;
    },
    async wait(predicate) {
      const deadline = Date.now() + 600000;
      while (!predicate()) {
        const failure = messages.find((m) => m.type === 'error');
        if (failure) throw new Error(failure.message);
        if (Date.now() > deadline)
          throw new Error(
            'Worker timed out: ' +
              JSON.stringify({
                episode: latest?.episode,
                status: latest?.status,
                steps: latest?.steps,
                paused: latest?.pausedActivity,
              }),
          );
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}
const run = launch();
try {
  run.worker.postMessage({
    type: 'init',
    coach: false,
    track: 0,
    trainingTracks: [0, 1, 2],
    variedStarts: true,
    preset: 'local',
    seed: 42,
    laps: 3,
  });
  await run.wait(() => run.latest?.status === 'ready');
  run.worker.postMessage({ type: 'insights', enabled: true });
  await run.wait(() =>
    run.messages.some(
      (m) => m.type === 'insight' && m.reading?.source === 'preview',
    ),
  );
  run.worker.postMessage({ type: 'inspect', restart: true });
  await run.wait(() => run.latest.status === 'paused');
  run.worker.postMessage({ type: 'inspect', action: 1 });
  await run.wait(() =>
    run.messages.some((m) => m.type === 'insight' && m.reading?.manual),
  );
  assert.equal(run.latest.steps, 0);
  assert.equal(run.latest.updates, 0);
  run.worker.postMessage({ type: 'speed', speed: 0 });
  run.worker.postMessage({ type: 'resume' });
  await run.wait(() =>
    run.messages.some(
      (m) =>
        m.type === 'insight' &&
        m.reading?.source === 'training' &&
        m.reading?.update,
    ),
  );
  run.worker.postMessage({ type: 'pause' });
  await run.wait(() => run.latest.status === 'paused');
  const steps = run.latest.steps,
    updates = run.latest.updates;
  run.worker.postMessage({ type: 'inspect', restart: true, fraction: 1 / 3 });
  run.worker.postMessage({ type: 'inspect', action: 1 });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(run.latest.steps, steps);
  assert.equal(run.latest.updates, updates);
  run.worker.postMessage({ type: 'track', track: 4, laps: 3 });
  await run.wait(() => run.latest.track === 4);
  run.worker.postMessage({ type: 'inspect', restart: true });
  await run.wait(() =>
    run.messages.some(
      (m) =>
        m.type === 'insight' &&
        m.reading?.source === 'walkthrough' &&
        m.reading.track === 4,
    ),
  );
  run.worker.postMessage({ type: 'insights', enabled: false });
  run.worker.postMessage({ type: 'resume' });
  await run.wait(() => run.latest.steps > steps);
  console.log(
    'PASS: bundled-worker diagnostics, manual stepping, paused isolation, track changes and resuming the original learner.',
  );
} finally {
  await run.worker.terminate();
}
