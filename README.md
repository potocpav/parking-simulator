# Parking Trainer

A top-down car parking trainer that runs in the browser. You steer a white hatchback (about the size of a Ford Focus) into parallel, perpendicular and diagonal bays, and through busy car parks. It works with a keyboard on desktop and with on-screen controls on phones. It is a fully static site with no build step and no dependencies.

**▶ Play online: https://potocpav.github.io/parking-simulator/**

Every scenario has its own URL, so you can send a link straight to one:

| Scenario | Link |
|---|---|
| Diagonal 45° | https://potocpav.github.io/parking-simulator/#/play/diagonal-45 |
| Diagonal 60°, reverse | https://potocpav.github.io/parking-simulator/#/play/diagonal-60-reverse |
| Reverse into a bay | https://potocpav.github.io/parking-simulator/#/play/perpendicular-reverse |
| Nose-in bay | https://potocpav.github.io/parking-simulator/#/play/perpendicular-forward |
| Parallel parking | https://potocpav.github.io/parking-simulator/#/play/parallel-easy |
| Tight parallel | https://potocpav.github.io/parking-simulator/#/play/parallel-tight |
| Leave the car park | https://potocpav.github.io/parking-simulator/#/play/carpark-exit |
| Find a free bay | https://potocpav.github.io/parking-simulator/#/play/carpark-find-slot |

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Steer | `←` `→` (or `A` `D`) | ◀ ▶ (bottom left) |
| Forward / reverse | `↑` `↓` (or `W` `S`) | ▲ D / ▼ R (bottom right) |
| Pause | `Esc` or `P` | ⏸ in the top bar |
| Reset | `R` | ⟲ in the top bar |

- The wheels turn at a fixed rate while you hold a key and, when you let go, **return to straight as the car rolls**, in proportion to the distance driven (about 3 m from full lock). They stay put while the car is stopped.
- Speed is capped at parking pace: 18 km/h forward and 13 km/h in reverse. Pressing the opposite pedal brakes first.
- Bumping into something stops the car and shows a red marker. That direction stays blocked; drive the other way to back out. Parked cars you hit keep scratch marks where you hit them until you reset.
- To finish, put the car fully inside the dashed box, facing the chevrons, and **hold still for 1 second**. The car-park exit only needs you to drive into the finish box.

The ⚙ menu lets you switch scenario and toggle the **trajectory** (predicted front-wheel paths, 1.5 m ahead and behind, for the current steering), **parking sensors**, **driven path**, **follow camera** (on by default on the big car-park maps), **on-screen controls** (on by default on touch devices) and **sound**.

Sounds are synthesised in the browser with the Web Audio API, so there are no audio files. They are a soft engine hum whose pitch follows speed and throttle, parking-sensor beeps in four steps that match the on-screen bars (slow under 1.5 m, medium under 1.0 m, fast under 0.6 m, a solid tone under 0.3 m), and a thud when you hit something. Sound starts after your first key press or tap, which browsers require, and it is muted while the game is paused or in the background.

Your progress stays in your browser's `localStorage`. For each finished scenario it saves your best result: fewest crashes, then fastest time.

## Run locally

ES modules need to be served over HTTP; opening `index.html` as a file won't work.

**Auto-reloading dev server** (reloads the browser whenever you save a file):

```sh
npx live-server --port=8000
# or: npm run dev
```

Then open http://localhost:8000/.

Without Node, a plain static server works too, but you have to reload manually:

```sh
python3 -m http.server 8000
```

**Tests** (geometry, physics and a consistency check of every scenario: nothing overlaps, and every target fits the car):

```sh
npm test        # = node --test tests/*.test.js
```

## Deploy to GitHub Pages

1. Push this repo to `github.com/potocpav/parking-simulator`.
2. Go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The site appears at https://potocpav.github.io/parking-simulator/ after a minute or so.

All paths are relative and routing uses the URL hash (`#/play/<id>`), so the site needs no 404 handling. `.nojekyll` makes Pages serve the files as they are.

## Project layout

```
index.html        page shell: menu, game view, overlays
css/style.css     all styling
js/main.js        boot, hash router, DOM/HUD glue
js/game.js        simulation loop, collisions, sensors, success detection, world rendering
js/car.js         car dimensions + kinematic bicycle model + path prediction
js/collision.js   oriented-rectangle SAT, contact points, ray casts
js/render.js      canvas drawing (scenery, cars, targets, overlays, camera)
js/hud.js         parking-sensor widget
js/input.js       keyboard + multi-touch controls
js/audio.js       synthesised engine, sensor-beep and bump sounds
js/menu.js        scenario cards with rendered previews
js/storage.js     localStorage (best results, settings)
js/scenarios.js   scenario definitions
tests/            node:test unit tests
```

### Adding a scenario

Add an entry to `SCENARIOS` in `js/scenarios.js`. The existing helpers (`streetScenario`, `lotScenario`, `angledScenario`, `carParkScenario`) cover most layouts. The raw shape is:

```js
{
  id: 'my-scenario',              // used in the URL
  title, description, difficulty, // shown on the card
  bounds: { x, y, w, h },         // world rectangle in metres; edges are invisible walls
  bg: '#5f8a43',                  // ground colour
  largeMap: false,                // true → camera follows the car by default
  start: { x, y, angle },         // car body centre; angle in radians, 0 = facing right, +y is down
  targets: [{ x, y, w, h, angle, headings: [rad], tol: 7, requireStop: true, label }],
  obstacles: [{ type: 'car' | 'curb' | 'wall' | 'island' | 'hedge' | 'post', x, y, w, h, angle, color }],
  scenery: [{ type: 'rect' | 'line' | 'tree' | 'arrow' | 'text', layer: 'ground' | 'top', ... }],
}
```

All rectangles are centre-based, with `w` measured along `angle`. Run `npm test` afterwards: it checks that the start pose is clear, that no parked cars overlap, and that every target can hold the car.

## Ideas / future

- Mirror / 360° camera inset while reversing
- "Realistic" steering mode (wheels only turn while rolling)
- Star ratings, and a readout of final accuracy (angle error, distance to curb)
- Ghost replay of your best run, or of a reference solution
- More scenarios: left-side parallel parking, garage, three-point turn, randomised layouts
- Several player cars (city car, SUV, van) with different turning circles
- Pinch-zoom in follow mode
- First-play tutorial
