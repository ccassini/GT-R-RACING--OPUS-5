# Sunset Racing — Supercar Asset Credits

This notice covers the source vehicle shells used to generate
`authored-race-cars.glb`. The source GLB files are build inputs and are not
shipped with the game. Exact download URLs, file sizes and SHA-256 digests are
recorded in [`tools/supercar_sources.json`](../../../tools/supercar_sources.json).

## License policy

All six source records are treated by this project as licensed under the
[Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/)
(CC BY 4.0). The Unity Fan Sketchfab titles mention public domain/CC0, while
the archived Objaverse metadata labels the records `by`; Sunset Racing applies
the stricter CC BY 4.0 attribution requirements rather than relying on the more
permissive wording.

The CC BY 4.0 license applies to the credited source assets and their adapted
geometry. It does not grant rights to third-party trademarks, logos or brand
names.

## Unity Fan source concepts

The following concepts were created by **Unity Fan**, modified for Sunset
Racing, and are used under CC BY 4.0:

- **Comet — Free Concept Car 040**  
  [Original source page](https://sketchfab.com/3d-models/free-concept-car-040-public-domain-cc0-9363e93183274ea1bad403ea6fe3ee79)  
  Free Concept Car 040 by Unity Fan, modified for Sunset Racing, used under CC BY 4.0.
- **Vulcan — Free Concept Car 039**  
  [Original source page](https://sketchfab.com/3d-models/free-concept-car-039-public-domain-cc0-f17b9d37e0e34f15b4c2e417a98f5ed6)  
  Free Concept Car 039 by Unity Fan, modified for Sunset Racing, used under CC BY 4.0.
- **Bolt — Free Concept Car 002**  
  [Original source page](https://sketchfab.com/3d-models/free-concept-car-002-public-domain-cc0-090898c41395478d9dc4dea261944581)  
  Free Concept Car 002 by Unity Fan, modified for Sunset Racing, used under CC BY 4.0.
- **Onyx — Free Concept Car 037**  
  [Original source page](https://sketchfab.com/3d-models/free-concept-car-037-public-domain-cc0-646a3a31b0224379b6e767abc34d58dd)  
  Free Concept Car 037 by Unity Fan, modified for Sunset Racing, used under CC BY 4.0.
- **Orion — Free Concept Car 033**  
  [Original source page](https://sketchfab.com/3d-models/free-concept-car-033-public-domain-cc0-58f9d30f8e734de8ba05fa64e0e6584a)  
  Free Concept Car 033 by Unity Fan, modified for Sunset Racing, used under CC BY 4.0.

## Khronos / Darmstadt Graphics Group source

**Sable — Car Concept**

- © 2024 Darmstadt Graphics Group GmbH
- Model and textures: Eric Chadwick
- Based on Unity Fan’s Free Concept Car 004
- License: [CC BY 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- [Khronos Car Concept source and legal notice](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept#legal)
- [Unity Fan original Concept 004 page](https://sketchfab.com/3d-models/free-concept-car-004-public-domain-cc0-4cba124633eb494eadc3bb0c4660ad7e)

Attribution: Car Concept © 2024 Darmstadt Graphics Group GmbH; model and textures by Eric Chadwick; based on Unity Fan's Free Concept Car 004. Modified for Sunset Racing. Used under CC BY 4.0.

## Modifications and excluded source content

The source concepts are build-time starting surfaces, not untouched models.
The generation pipeline:

- removes every source material, image and texture;
- removes source wheels, tyres, badges, emblems, text, plates and logo-bearing
  geometry;
- reshapes and re-proportions each surviving shell for the game’s stance and
  wheelbase;
- reduces and reorganizes geometry for real-time rendering;
- adds newly authored wheels, brakes, aero, lighting signatures, exhaust and
  identity details; and
- assigns new brand-neutral game materials.

Some Unity Fan source tyre normal maps contain visible Bridgestone/Potenza
markings. Those tyre meshes and **all source textures are stripped before
export**, so these markings are not present in `authored-race-cars.glb`.
Khronos and other source logos are likewise removed; no trademark license or
brand affiliation is claimed.

This file is an attribution record, not legal advice.
