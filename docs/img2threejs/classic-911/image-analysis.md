# Classic 911-style coupe — image analysis

Reference: `../../concepts/classic-911-bot-reference.png` (1254 × 1254 four-view sheet)

## 1. Identification and classification

- Observed object: compact two-door rear-engine sports coupe rendered as a low-poly game asset.
- Broad class: road vehicle; hard-surface mechanical object; `primaryDomain: object`.
- Confidence: 0.99 for object class and 0.94 for the intended shared design across the four views.
- The sheet shows the same red coupe from front three-quarter, rear three-quarter, lateral orthographic, and frontal viewpoints. There are no logos, badges, inscriptions, or license plates.

## 2. Overall form and silhouette

- Bilaterally symmetric vehicle volume, approximately 2.25 wheel diameters tall and 5.2 wheel diameters long in the lateral view.
- Main body is a continuous variable-width loft, not a box stack: low front nose, raised front fender crowns, shallow hood, nearly horizontal beltline, broad rear haunch, and a rounded tail.
- Cabin is a second continuous/conforming shell: steep front windshield, shallow curved roof crown, long rearward roof arc, and sloping rear glass/deck transition.
- Four cylindrical wheel/tire assemblies are partially occluded by real wheel arches; roughly the upper 20–25% of each tire sits inside the body silhouette.
- Shape language is geometric low-poly with continuous sculpted macro surfaces and deliberately faceted meso surfaces.

## 3. Macro → meso → micro decomposition

### Macro

1. Lower body shell with integrated front and rear fender volumes.
2. Cabin/greenhouse shell with front, side, quarter, and rear glazing.
3. Four articulated wheel assemblies.

### Meso

- Hood panel with shallow central crown and two longitudinal edge creases.
- Front bumper/valance and black rub strip.
- Paired circular upright headlamp buckets integrated into the front fender crowns.
- Left/right front amber indicator lenses.
- Door shells with panel gaps, black handles, and lower rocker trim.
- Roof panel plus A, B, and C pillars.
- Rear deck/engine cover with six parallel grille slats.
- Full-width rear lamp band, rear bumper, vertical bumper guards, and one exhaust outlet.
- Side mirrors on short embedded stalks.

### Micro

- Five-spoke wheel pattern and recessed hub on each wheel.
- Dark headlamp retaining rings and faceted warm-white lenses.
- Thin black perimeter seals around glazing.
- Thin dark seams around hood, doors, and rear deck.
- Subtle clearcoat highlight over the red paint.

## 4. Spatial relationships

- `<body shell, encloses/overlaps, upper tire quadrants>` with wheel-arch contact; tires must not float outside the shell.
- `<cabin shell, overlaps, body beltline>` and grows continuously out of the body; no gap at the cowl or rear quarter.
- `<windshield, embedded-in, A-pillars+roof+cowl>` with a perimeter seal.
- `<side windows, embedded-in, A/B/C pillars+door beltline>`; rear quarter glass tapers to a point toward the rear deck.
- `<headlamp buckets, embedded-in, front fender crowns>`; lens faces are near vertical and only slightly proud of the painted ring.
- `<bumpers, overlap, front/rear body faces>`; black strips follow body width and sit flush against painted bumper volumes.
- `<wheel pivots, socketed-in, front/rear axle sockets>`; wheel centres align across the bilateral axis.
- `<grille slats, surface-contact, rear deck>` and follow the rear-deck slope.

## 5. Materials and surface response

- Painted body: dielectric red base coat, low metalness (0–0.08), roughness about 0.24–0.34, clearcoat 0.65–0.85, clearcoat roughness 0.16–0.24.
- Glazing: charcoal transparent/semi-transparent dielectric, roughness 0.12–0.22, no metallic response; interior remains mostly occluded.
- Tires/rub strips: dark charcoal rubber/plastic, roughness 0.72–0.92.
- Wheel centres: silver-gray metal, metalness 0.65–0.85, roughness 0.22–0.34.
- Headlamp lenses: warm off-white translucent/gloss response with a restrained emissive term for game readability.
- Rear/indicator lenses: dark red and amber glossy dielectric with low emissive contribution.

## 6. Color and finish

- Body base color: vivid warm red, high saturation, medium value; reference highlights shift toward orange-red while shadow faces shift toward deep crimson.
- Windows/trim/tires: near-black charcoal with distinct value steps so parts remain separable.
- Rims: medium-light neutral silver; hubs slightly darker.
- Headlamps: warm white; indicators: amber-orange; rear lamps: saturated deep red.
- Finish is clean and unworn. No scratches, dirt, stains, chips, or decals are visible.

## 7. Identity-defining features

Critical visual identity:

1. Upright circular lamps seated within raised front fender crowns.
2. Short shallow hood and low rounded nose.
3. Continuous roof-to-rear-deck arc and tapered rear quarter glazing.
4. Broad rear haunches with partially enclosed rear wheels.
5. Rear engine-cover grille and full-width rear light band.
6. Compact wheel diameter relative to body length and wheelbase.

Important secondary features: black bumper strips, five-spoke wheels, side mirrors, door handles, rocker trim, amber front indicators, rear bumper guards, exhaust outlet.

## 8. Uncertainty and limits

- The sheet is an AI-generated concept rather than measured orthographic CAD; minor cross-view inconsistencies exist in wheel diameter, mirror location, and bumper thickness.
- Underside, interior, exact tire tread, suspension, and concealed engine geometry are hidden and will not be reconstructed.
- The frontal and lateral views are the primary silhouette constraints. Three-quarter views govern volume and material readability.
- Hidden underside and interior confidence: 0.25. Rear-deck top and opposite lateral side confidence: 0.88 by multi-view evidence and symmetry.
- Target is a faithful low-poly game reconstruction, not manufacturing-grade geometry or an official branded Porsche model.

## Suitability verdict

`pass`: one unambiguous object is shown at useful scale in four complementary views; macro silhouette, major materials, symmetry, and identity features are visible and can be reconstructed procedurally. The only excluded regions are the hidden underside and interior.
