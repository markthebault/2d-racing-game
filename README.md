# Pocket Circuit

A top-down, single-car Three.js racer with three closed circuits and 1–10 lap races.

![Pocket Circuit showing the Park Oval track, ray sensors, and circuit selection menu](docs/images/pocket-circuit.png)

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by the dev server. Requires WebGL and hardware acceleration.

## Controls

- Up: accelerate
- Down: brake, then reverse
- Left / right: progressive steering while moving. Hold for 0.35 seconds to reach full lock; short taps make small corrections.
- Escape: pause or resume
- R: return to the nearest point on the track

Choose a circuit and lap count, then start the race. Follow the painted arrows clockwise. Top speed on asphalt is 200 on the km/h display. Grass slows the car and does not earn lap progress. Losing window focus pauses an active race. Touch controls are available on narrow screens.

## Checks

```sh
npm run build
npx tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
```

Park Oval uses a closed cubic B-spline. Pine Bend has 12 corners with radius 8. Desert Switchback has an asymmetric outer section with diagonal bends and three infield hairpins. Its road is 30% narrower and its corner radius is 5.5, requiring slower turns and more precise positioning. Straight sections meet tangent circular corners without folded kerbs. Asphalt, kerbs, shoulders, start-line width, sensor boundaries, off-road slowdown, and lap validation all follow each circuit's road scale. Camera framing, movement limits, and menu previews fit each circuit. The road, kerbs, shoulders, menu maps, and ray boundaries share that geometry. Geometry tests check that offset edges never reverse direction or intersect themselves.

Track definitions and lap logic are in `lib/race.ts`; rendering and physics are in `lib/engine.ts`. The orthographic camera presents the Three.js scene as a 2D game. All game assets are generated geometry, with no external image downloads.

The optional `start_race` WebMCP action uses the selected race settings. It is feature-detected and does not affect normal keyboard play. No supported browser WebMCP validation context was available during development.

## Ray sensors

Rays are on by default. The foldable debug menu on the right displays readings while driving and retains them while paused. **Hide rays** hides the drawing only; sensing and readouts continue.

- Nine front rays use angles −75°, −50°, −30°, −15°, 0°, +15°, +30°, +50°, +75°, with fixed ranges of 10, 16, 24, 30, 32, 30, 24, 16, 10 world units.
- Three rear rays use angles −135°, 180°, +135°, with ranges of 10, 16, 10 units.
- Angles are relative to the car's nose; positive means right. Front origins sit 1.65 units ahead of the center, rear origins 1.65 units behind. Distances are measured from these bumper origins, not from the car center.
- Both asphalt boundaries come from the same offset geometry as the visible road. Exact 2D ray/segment intersections return the nearest forward crossing within range, including when the car is off-road. Kerbs, center markings, scenery, and the car itself are not sensor targets.
- Solid lines end at the measured point; white dots indicate hits. Faint dashed extensions show the remaining fixed range. Gray dots mean no edge was found within range. IDs at the range tips match the table.

`lib/sensors.ts` contains the pure sensing function and the fixed `RAY_DEFINITIONS` configuration. `senseTrack(position, headingRadians, edges)` returns readings in stable F1–F9, B1–B3 order. Each includes `distance`, `maxRange`, `normalizedDistance`, `hit`, `origin`, `end`, and `limit`. A miss returns the maximum distance, normalized value 1, and `hit: false`; a boundary exactly at maximum range has `hit: true`. Distances use the game's world units, not calibrated meters.

The engine calculates readings after movement each frame and publishes the same readings through `RaceStats.rays` to the UI about 15 times per second. Resetting or changing a circuit updates readings immediately. The sensing function is separate from keyboard controls and rendering for future reinforcement-learning integration; no learning or autonomous driving is implemented.

The debug menu also shows accelerator and brake/reverse positions, car position in world X/Z coordinates, heading in degrees clockwise from +X, steering input from -1 to +1, and a virtual steering-wheel angle. Steering uses a nearly linear exponential curve with exponent 0.35, reaching full lock in 0.35 seconds from center. Releasing the key returns linearly to center in at most 0.12 seconds; changing direction passes through center before ramping into the opposite turn. Both arrow keys together request centered steering. Keyboard auto-repeat does not restart the ramp. The same smoothed value drives turning and the wheel display. The wheel display maps full left/right steering to -90°/+90°; it is an input visualization, not a physical steering-rack angle. Pedals and steering use the same input values as the driving logic, and return to zero on pause or reset. Folding the menu does not stop the simulation or sensors.
