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
- [x] Your rigged Saiga + pistol (models/fps_saiga.glb, fps_pistol.glb): their own idle / walk / fire / reload clips, real size, aim down the iron sights, chamber + magazine logic, recoil, sway; slot 3 = flashlight hands
- [x] Hitscan, impacts per surface, bullet holes, sparks, smoke, ejected cases, steel targets
- [x] Keyboard/mouse, controller, touch
- [ ] Enemy AI · more of the facility · XR session · real photo textures / recorded audio

## Photo textures (user-supplied)
`textures/src/*.png` are the originals; `python3 tools/prep_photos.py` makes the game copies (seamless, de-lit, albedo calibrated to the layer value, 512 px WebP). Floors use `concrete.webp`, ceilings / tunnel walls `ceiling.webp`; relief and roughness come from the photo's detail. Missing file = the generated layer.

## VR (WebXR)
Menu shows ENTER VR when the browser supports it (Quest browser, PC VR in Chrome / Edge). Quest auto-picks the VR profile (MSAA, no grain / vignette / head bob, foveation 1).
Controls: gun in the right hand (aims along the controller), flashlight in the left. Left stick move (click = run), right stick smooth turn, right trigger fire (or use, pointed at a door panel), A reload, B next gun, left trigger flashlight, left grip at the left thigh holsters / draws the flashlight; with it holstered, left grip on the gun's handguard holds the gun with both hands (the rig's own support hand, aim follows both hands), X crouch, Y stats, right stick click jump. Real walking is followed by the body and stopped at walls.
WebXR needs a secure origin: on Quest use `adb reverse tcp:8000 tcp:8000` and open http://localhost:8000, or host the folder over https (e.g. GitHub Pages).
Tested with the IWER Quest 3 emulator: enter, stick walk, smooth turn, physical walk into a wall (stopped), flashlight.
