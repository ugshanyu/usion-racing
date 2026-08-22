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
