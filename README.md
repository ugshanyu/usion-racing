# Usion Racing

2–4 player multiplayer racing mini-game for the [Usion](https://usions.com) platform,
based on [mrdoob/Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing)
(a three.js port of Kenney's Starter Kit Racing).

Live: https://usion-racing.vercel.app

## What was added on top of the starter kit

- **Usion SDK integration** — identity, launch modes, leaderboard (best lap, lower wins),
  Game Center match results (`Usion.game.reportResult`).
- **Multiplayer over the platform relay** (2–4 players, one truck color per seat):
  each client simulates its own car locally (instant input feel) and broadcasts
  position/velocity at 15 Hz; remote cars render ~120 ms in the past with snapshot
  interpolation. Car-to-car hits apply a symmetric impulse on each client's own
  physics body — everyone bounces.
- **Waiting room** — roster with avatars, per-player READY, host-only start,
  `Usion.game.invite()`, play-with-bots escape hatch.
- **Instant solo play** (GameTok / Explore): 3-lap race against three bot drivers
  with real physics bodies (they collide with you and each other).
- **Quick chat** — localized canned phrases + free text, rendered as bubbles over cars.
- **Mobile friendly** — floating touch joystick (from the kit), safe-area aware HUD,
  ResizeObserver-driven resize, capped DPR.
- **i18n** — English + Mongolian.

## Race rules

3 laps. Placements = order of finish-line crossings (sequenced `finished` actions,
identical on every client). Best lap submits to the leaderboard (ascending — lower
is better). The host reports the match result so a result card lands back in the
chat the game started from.

## Development

Static site — no build step. Serve the folder and open it:

```bash
npx serve .
```

Outside the Usion host the SDK is stubbed and the game boots straight into a solo
bot race. `editor.html` (from the starter kit) still works for building tracks.

## Credits

- Game assets by [Kenney](https://kenney.nl/) (CC0)
- Base game: [mrdoob/Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing) (MIT)
- Physics: [crashcat](https://github.com/isaac-mason/crashcat) · Rendering: [three.js](https://threejs.org)
