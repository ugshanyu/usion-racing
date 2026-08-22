# Classic coupe img2threejs review

## Pipeline identity

- Repository: `img2threejs` 1.4.4
- Commit: `d667338`
- Primary admitted view: `references/front-three-quarter.png`
- Supporting admitted views: `references/side.png`, `references/front.png`, and `references/rear-three-quarter.png`
- Original combined sheet: rejected by the repository admission gate because its largest connected foreground component was 0.54, below the required 0.60.

## Changes produced by the workflow

- Replaced the previous coarse eight-point closed loft with a traced side-profile extrusion containing real front and rear wheel-well holes.
- Added separate, thinner painted wheel-arch lips and dark inner liners.
- Rebuilt the cabin with separate windshield, side glass, quarter glass, rear glass, painted A/B/C pillars, roof rails, and a longer roof/fastback envelope.
- Embedded round headlamps into shaped fender crowns and moved the lamp stack rearward after side-view review.
- Rebuilt each wheel with an independent game pivot, smaller tire, open five-spoke face, center cap, barrel, rim ring, and tread bands. No solid disc covers the spokes.
- Added the front bumper layers and amber indicators plus the rear grille, full-width segmented lamp band, bumper guards, and single left exhaust.
- Preserved the existing local sphere physics and `Body`, wheel, and axle-socket runtime names.

## Deterministic evidence

- Strict ObjectSculptSpec validation: **PASS**.
- Material-region extraction: **PASS**, with PBR confidence 0.866 for paint, 0.909 for glass, 0.836 for tire rubber, and 0.909 for wheel metal.
- Part coverage: **PASS**, 21 specified components represented by 21 built parts, zero errors and zero warnings. The runtime root is an additional container.
- Multi-angle degeneration check: **PASS**. Side, front, and rear-three-quarter silhouette-area ratios were 1.322, 1.124, and 1.505; none collapsed toward the 0.15 limit.
- Framing-aligned Tier 1 values: aspect-ratio delta 0.0054 and scale delta 0.0589 both pass, but silhouette IoU 0.7414 remains below the repository's 0.85 threshold.
- Local game test: **PASS**. The race initializes and the red reconstructed bot participates without blocking the game.

## Honest remaining mismatch

The result is a substantially closer, lightweight real-time approximation, not an exact image-to-mesh recovery. The concept's fender crowns, roof arc, and rear deck use smoother compound surfaces than the current browser-friendly procedural mesh. The lamp bezels also remain thicker than the reference. Because the strict silhouette gate is still below threshold, the img2threejs blockout is recorded as `refine-code`; no Tier 2 acceptance or 0.85+ fidelity claim is made.

The next meaningful fidelity step would be a denser variable-width surface loft with section-specific fender crowns, not additional small decorations or more camera tuning.
