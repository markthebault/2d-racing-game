# Pocket Circuit

A top-down, single-car Three.js racer with three closed circuits and 1–10 lap races.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by the dev server. Requires WebGL and hardware acceleration.

## Controls

- Up: accelerate
- Down: brake, then reverse
- Left / right: steer while moving
- Escape: pause or resume
- R: return to the nearest point on the track

Choose a circuit and lap count, then start the race. Follow the painted arrows clockwise. Grass slows the car and does not earn lap progress. Losing window focus pauses an active race. Touch controls are available on narrow screens.

## Checks

```sh
npm run build
npx tsc --noEmit
node --experimental-strip-types --test tests/race.test.mjs
```

Track definitions and lap logic are in `lib/race.ts`; rendering and physics are in `lib/engine.ts`. The orthographic camera presents the Three.js scene as a 2D game. All game assets are generated geometry, with no external image downloads.

The optional `start_race` WebMCP action uses the selected race settings. It is feature-detected and does not affect normal keyboard play. No supported browser WebMCP validation context was available during development.
