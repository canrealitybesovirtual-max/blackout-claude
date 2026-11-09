# BLACKSITE

Standalone first-person shooter. three.js r170 + WebGL2, no build step, no downloads besides the code.
Runs in any modern browser: Chromebook, Windows, Android/iOS, Xbox Edge, Quest browser.

## Run
```
cd blacksite && python3 -m http.server 8000   # open http://localhost:8000
node tools/bake.mjs                             # re-bake lighting after editing a zone (~7 s)
```
URL options: `?q=ultralow|low|medium|high|vr`, `?nointro`. `P` toggles the performance overlay.

## Why it is fast
| Decision | Effect |
| --- | --- |
| Baked lighting (area lights, soft shadows, 1 bounce, directional lightmaps) | zero runtime lights; normal maps + speculars still react |
| One uber-shader, 13-layer texture array | whole world = 1 program, 1 material per zone |
| Zone = 1 merged mesh + 1 decal mesh + 1 glow mesh | ~12-18 draw calls per frame in total |
| Portal visibility + zone streaming (load current + neighbours, unload the rest) | only visible rooms drawn, only nearby rooms in memory |
| Tone map, grading, grain, vignette inside the shader | no full-screen post passes |
| Procedural textures + synthesized audio | nothing to download; size per quality profile |
| Dynamic resolution per profile | holds the frame-time target |
| Pooled effects (sparks, smoke, holes, cases) | no allocation during play |

## Measured (headless SwiftShader = CPU software rendering, worst case)
ULTRA LOW 576x324: 12 draw calls, 5.2k tris, CPU 1.9 ms/frame, 6.7 MB textures, boot 0.36 s.
MEDIUM: 12-18 draw calls, 8.8k tris, CPU 2.8-3.3 ms/frame, 17-19 MB textures.

## Layout
`src/world` zones (data), kit (modular pieces), build (merge + lightmap charts), bake, grid (raycasts), zoneManager (streaming).
`src/render` shaders + procedural textures. `src/game` player, weapons, view models, effects, door/targets. `src/audio` synth + reverb.
Add a zone: new file in `src/world/zones`, list it in `level.js` with neighbours/portals, run the bake.

## Checklist
- [x] Quality profiles, auto-detect, dynamic resolution, perf overlay (FPS, 1% low, CPU/GPU ms, draw calls, tris, memory)
- [x] Corridor, armory/test lane, streamed maintenance tunnel, sliding door (lighting follows the door)
- [x] Player: walk/sprint/crouch/jump, stamina, step-up, surface footsteps, wake-up intro
- [x] Rifle + pistol: auto/semi, chamber logic, tactical/empty reloads, ADS red dot, recoil, sway, inspect, switch, weapon light
- [x] Hitscan, impacts per surface, bullet holes, sparks, smoke, ejected cases, steel targets
- [x] Keyboard/mouse, controller, touch
- [ ] Enemy AI · more of the facility · XR session · real photo textures / recorded audio
