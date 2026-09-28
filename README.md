# One Thumb Heist

A mobile stealth-puzzle game about planning a heist with a single stroke of your thumb.

Press on the thief and draw one continuous route: grab the loot, then reach the exit. While your thumb is down, the building shows the moment the thief will reach your fingertip, so you can see where every guard and camera will be. Hold still to wait. Slide back along the line to undo. Lift your thumb and the plan runs. No second chances.

- 30 hand-made jobs across 5 cases, each case introducing a new trick: cameras, guards, lasers and keycards, creaky floorboards that lure guards, and fuse boxes that black out the building.
- Three stars per job: escape with the loot, grab every coin, beat the par time.
- Progress, stars, best times and settings save on the device.
- Everything is drawn live on a canvas and every sound, including the noir-jazz score, is synthesised with Web Audio. No image or audio files.
- Installable as a full-screen, portrait, offline-capable web app.

## Play

It is a static site with no build step. Serve the repository root over HTTP(S) and open `index.html`:

```sh
npx http-server -p 8080 .
# then open http://localhost:8080 on your phone (same network) or in a mobile emulator
```

### Install to your home screen

Host it anywhere with HTTPS (GitHub Pages works, see below), open it on the phone, then:

- **iPhone / iPad (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app (or the "Install to home screen" button on the title screen).

After the first load the service worker caches the whole game, so it also plays offline.

### GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, pick the branch that holds this code and the `/ (root)` folder. The site appears at `https://<user>.github.io/<repo>/`. A `.nojekyll` file is included so files are served as-is.

## How it's built

| Path | What it does |
| --- | --- |
| `js/level.js`, `js/levels.js` | ASCII level format and the 30 levels |
| `js/sim.js` | Deterministic simulation (guards, cameras, lasers, noise, fuse box). Drives the live preview, the playback and the solver |
| `js/plan.js` | The drawn route: collision-aware drawing, retrace-to-undo, waits, pickups that lock the line |
| `js/game.js` | Level state machine: intro, planning, playback, slow-motion close calls, results |
| `js/render.js`, `js/sprites.js`, `js/fx.js` | Canvas renderer, procedural characters and loot, particles |
| `js/audio.js` | Synthesised sound effects and generative music |
| `js/main.js` + `index.html` + `css/style.css` | Menus, HUD, briefings, saving, PWA glue |
| `sw.js`, `manifest.webmanifest` | Offline cache and install metadata |

### Level tools

Every level is checked by a solver that searches the real simulation for a route, replays it, and derives the par time.

```sh
node tools/solve.mjs 2-3 -v          # solve one level and print the route
./tools/solve-all.sh                 # solve every level in parallel (writes tools/results/)
node tools/apply-pars.mjs            # write par times into js/levels.js
node tools/cover.mjs 1-4             # heatmap of how often each tile is watched
node tests/unit.mjs                  # drawing logic + every stored route beats its level under par
```

`node tools/build-artifact.mjs <esbuild>` produces a single self-contained HTML file in `dist/`.

## Credits

Type: Big Shoulders Display, Barlow Semi Condensed and Special Elite, bundled under their open font licenses.
