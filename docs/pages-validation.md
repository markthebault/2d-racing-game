# Pages release checks

Checked on 4 October 2026:

- Static Vite production build passes on Node 22.16.0, the same version selected for Cloudflare and CI.
- All 84 unit tests pass, including 3D camera framing and retention, tire-wall collisions, reverse recovery and saved-model evaluation invalidation.
- The bundled worker regression passes: training/playback, pause/resume, 50-car replay, track switching, evaluation and saved-model transfers.
- `npm run test:pages` passes against the built site: five circuits, actual WebGL rendering, keyboard/touch acceleration, pause/reset, sensor tools, real browser-worker training, AI tabs and all three camera views at five responsive widths (320–1440 px) in both manual and AI modes. Camera controls remain inside the toolbar, and camera changes preserve the paused clock and renderer.
- `scripts/overhead-controls-browser.mjs` passes: actual WebGL camera matrices verify manual/AI panning, rotation, zoom, faster Shift movement, Fit track and position retention. The manual car stops against a tire wall under sustained throttle and reverses away. Real AI replay groups 1–50 and 51–100 render and retain paused learner/replay state during camera movement, with no browser or worker errors.
- TypeScript (`npx tsc --noEmit`) and Oxlint on the changed application files pass.
- Full-repository Oxlint still reports existing rules in the unchanged UI template components, `hooks/use-mobile.ts`, and `scripts/multitrack-browser.mjs`. Those template errors are outside this release; the build and browser checks pass.
- The output contains 17 static files, no `_worker.js`, no Pages Functions and no server bindings. The largest file is the 1.75 MB browser training worker, within the Pages asset limit.

The landing page's production build and browser suite pass, including six viewport widths, automated WCAG checks, all eight projects, filtering, the new image dialog, and content without JavaScript.

Visual previews are in `docs/previews/`; image provenance and the exact generation prompt are in `docs/project-artwork.md`.
