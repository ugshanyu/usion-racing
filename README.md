# Usion Racing

2–4 player multiplayer racing mini-game for the [Usion](https://usions.com) platform,
based on [mrdoob/Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing)
(a three.js port of Kenney's Starter Kit Racing).

The multiplayer build must run as a single WebSocket-capable service (the room
state is held in-process). A static-only Vercel deployment cannot host the
authoritative `/ws` endpoint.

## What was added on top of the starter kit

- **Usion SDK integration** — identity, launch modes, leaderboard (best lap, lower wins),
  and Game Center match results (signed direct-server result submission, with
  `Usion.game.reportResult` retained for relay fallback rooms).
- **Direct, server-sequenced multiplayer** (2–4 players, one truck color per
  seat): each client keeps responsive local vehicle physics and publishes its
  freshest state at 60 Hz. The room validates monotonic updates and broadcasts
  compact movement deltas at 60 Hz, plus reliable metadata keyframes. Remote
  cars dead-reckon position, height, velocity, and turn rate locally, then apply
  drift-sensitive smooth correction toward the owner's reported transform.
  Car-to-car collision response intentionally remains a local calculation.
- **Waiting room** — roster with avatars, per-player READY, host-only start,
  host-selectable 3/5/10 laps and OG/Monaco courses, and `Usion.game.invite()`.
- **Original starter-kit course** — the compact tiled loop and scenery from the
  initial racing version remains the default.
- **Monaco GP multiplayer course** — an opt-in Monaco-inspired route assembled
  from the same original straight, corner, finish, scenery, and collider tiles
  as the OG course, with server-synchronized track selection.
- **Instant solo play** (GameTok / Explore): 3-lap race against three bot drivers
  with real physics bodies (they collide with you and each other). All racers use
  the original Kenney truck models.
- **Quick chat** — localized canned phrases + free text, rendered as bubbles over cars.
- **Mobile friendly** — floating touch joystick (from the kit), safe-area aware HUD,
  ResizeObserver-driven resize, capped DPR.
- **i18n** — English + Mongolian.

## Race rules

The multiplayer host selects 3, 5, or 10 laps and either the OG Grid or Monaco GP.
Solo play stays on the OG Grid for 3 laps. Placements = order of finish-line
crossings (sequenced `finished` actions, identical on every client). Best lap
submits to the leaderboard (ascending — lower is better). Direct rooms submit the
signed match result from the server so a result card lands back in the originating
chat; relay fallback rooms use the host.

## Development

Install dependencies and start the game + room server:

```bash
npm install
npm run dev
```

For a local two-player test, open:

- `http://localhost:3017/?multiplayer=1&room=test&player=one`
- `http://localhost:3017/?multiplayer=1&room=test&player=two`

Run the protocol integration test with `npm test`. Outside the Usion host, a URL
without the multiplayer flags still boots into a solo bot race. `editor.html`
(from the starter kit) still works for building tracks.

## Production

Deploy the included Dockerfile to a WebSocket-capable host. Required production
variables are `SERVICE_ID`, `SIGNING_SECRET`, and `API_URL`; `JWKS_URL` and
`SIGNING_KEY_ID` are optional overrides. Keep exactly one replica unless the
room store is moved out of process.

Register the deployment as a Usion direct game with:

```bash
USION_API_TOKEN=... GAME_URL=https://your-game.example npm run register:usion
```

Import the generated `.env.railway.generated` values into the host, redeploy,
then publish with `USION_SERVICE_ID`, `USION_API_TOKEN`, and `GAME_URL` via
`npm run publish:usion`.

## Credits

- Game assets by [Kenney](https://kenney.nl/) (CC0)
- Monaco course geometry derived from [OpenStreetMap relation 148194](https://www.openstreetmap.org/relation/148194),
  © OpenStreetMap contributors, licensed under ODbL 1.0. FIA/F1 logos and branded
  trackside artwork are not included.
- “911 TURBO 930_Improved” by WolfGames36, based on the original model by
  Lexyc16, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  An archived experimental copy is retained for reference but is not loaded by
  the game. See `docs/THIRD_PARTY_ASSETS.md`.
- Base game: [mrdoob/Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing) (MIT)
- Physics: [crashcat](https://github.com/isaac-mason/crashcat) · Rendering: [three.js](https://threejs.org)
