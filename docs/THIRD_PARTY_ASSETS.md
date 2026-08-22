# Third-party assets

## 911 TURBO 930_Improved

- Archived experimental file (not loaded by the game): `models/vehicle-porsche-911-turbo.glb`
- Author: [WolfGames36](https://sketchfab.com/WolfGames36)
- Original model: [Lexyc16](https://sketchfab.com/Lexyc16)
- Source: [Sketchfab model page](https://sketchfab.com/3d-models/911-turbo-930-improved-acdbf6d555f949afa91e0cc6f6215f19)
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

The downloaded model was modified for Usion Racing. Its visual geometry and
materials are unchanged, but the scene hierarchy was reorganized into one body
and four independently animated wheel pivots. Meshes sharing a material within
each region were joined to reduce browser draw calls. The prepared GLB retains
the author, source, title, and license metadata embedded by Sketchfab.

Rebuild the game-ready file from an authorized Sketchfab download with:

```bash
npm run prepare:porsche -- /path/to/911_turbo_930_improved.glb
```

## Circuit de Monaco map geometry

- Runtime data: `js/MonacoLayout.js`
- Source: [OpenStreetMap relation 148194](https://www.openstreetmap.org/relation/148194), version 61 (2026-08-21)
- Copyright: © OpenStreetMap contributors
- License: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- Official circuit facts checked against the FIA circuit map: 3.337 km and 19 turns

The source centreline was joined in race direction and converted from
latitude/longitude to local metres. It is retained as a geometry reference in
`js/MonacoLayout.js`. The playable course is a deliberately stylized orthogonal
trace assembled from the same Kenney straight, corner, and finish tiles as the OG
course, with the same per-tile wall collider builder. It is not a one-to-one road
survey. No Formula 1, FIA, sponsor, or event logos are included.
