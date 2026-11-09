// One uber-shader for everything opaque (static world = LIGHTMAP variant, moving objects =
// DYNAMIC variant with a light-probe ambient cube), plus decals, glows and particles.
// Tone mapping, grading, vignette, grain and dither happen inside each shader:
// zero full-screen passes on any profile.
import * as THREE from 'three';

export const MAX_DYN = 4;

// uniforms shared (by reference) by every material
export const U = {
  uTime: { value: 0 }, uExposure: { value: 1.0 }, uRes: { value: new THREE.Vector2(1, 1) },
  uGrain: { value: 0.0 }, uVignette: { value: 0.0 },
  uFogColor: { value: new THREE.Color(0.01, 0.011, 0.012) }, uFogDensity: { value: 0.03 },
  uDynPos: { value: Array.from({ length: MAX_DYN }, () => new THREE.Vector4()) },
  uDynCol: { value: Array.from({ length: MAX_DYN }, () => new THREE.Vector4()) },
  uDynDir: { value: Array.from({ length: MAX_DYN }, () => new THREE.Vector4(0, 0, -1, 0.9)) },
  uDynCount: { value: 0 },
  uFlashOn: { value: 0 },
  uAmb: { value: Array.from({ length: 6 }, () => new THREE.Vector3(0.05, 0.05, 0.05)) },
  uAmbAvg: { value: new THREE.Vector3(0.05, 0.05, 0.05) },
  // the two strongest baked fixtures near the camera, re-applied to moving objects only
  uPrbPos: { value: [new THREE.Vector4(0, 10, 0, 1), new THREE.Vector4(0, 10, 0, 1)] },
  uPrbCol: { value: [new THREE.Vector3(), new THREE.Vector3()] },
};

const COMMON = /* glsl */`
#define PI 3.14159265
uniform float uTime, uExposure, uGrain, uVignette, uFogDensity;
uniform vec2 uRes;
uniform vec3 uFogColor;
uniform vec4 uDynPos[${MAX_DYN}], uDynCol[${MAX_DYN}], uDynDir[${MAX_DYN}];
uniform int uDynCount;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
vec3 finish(vec3 c){
  c *= uExposure;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0); // ACES fit
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 0.88);                                 // slightly muted, documentary look
  c *= mix(vec3(0.97, 1.0, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.0, 0.6, l)); // cool shadows, warm highlights
  c = srgb(clamp(c, 0.0, 1.0));
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 1.6;
  float n = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 517.0);
  c += (n - 0.5) * (uGrain + 1.0 / 255.0);
  return c;
}
float D_GGX(float NoH, float a){ float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
float V_SJ(float NoV, float NoL, float a){ float a2 = a * a; float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2); float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2); return 0.5 / max(gv + gl, 1e-5); }
vec3 specBRDF(vec3 N, vec3 V, vec3 L, vec3 f0, float a){
  vec3 H = normalize(V + L);
  float NoH = max(dot(N, H), 0.0), NoV = max(dot(N, V), 1e-3), NoL = max(dot(N, L), 0.0), VoH = max(dot(V, H), 0.0);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
  return D_GGX(NoH, a) * V_SJ(NoV, NoL, a) * F;
}
vec3 envBRDF(vec3 f0, float rough, float NoV){ // Karis mobile approximation
  vec4 c0 = vec4(-1, -0.0275, -0.572, 0.022), c1 = vec4(1, 0.0425, 1.04, -0.04);
  vec4 r = rough * c0 + c1; float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw; return f0 * AB.x + AB.y;
}
vec3 dynLights(vec3 P, vec3 N, vec3 V, vec3 diff, vec3 f0, float a){
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_DYN}; i++) {
    if (i >= uDynCount) break;
    vec3 Lv = uDynPos[i].xyz - P; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
    float r = uDynPos[i].w, f = clamp(1.0 - (d2 * d2) / (r * r * r * r), 0.0, 1.0);
    float att = f * f / max(d2, 0.02);
    if (uDynCol[i].w > 0.5) { // spot with a soft hotspot + spill ring
      float cd = dot(-L, uDynDir[i].xyz), co = uDynDir[i].w;
      float spot = smoothstep(co, mix(co, 1.0, 0.75), cd) * 0.8 + smoothstep(co - 0.14, co, cd) * 0.2;
      att *= spot;
    }
    float NoL = max(dot(N, L), 0.0);
    if (NoL * att <= 0.0) continue;
    acc += (diff / PI + specBRDF(N, V, L, f0, a)) * uDynCol[i].rgb * att * NoL;
  }
  return acc;
}
`;

const VERT = /* glsl */`
attribute float aLayer; attribute vec3 aTint; attribute float aEmit;
#ifdef LIGHTMAP
attribute vec2 lmuv; varying vec2 vLm;
#endif
varying vec3 vPos; varying vec3 vN; varying vec2 vUv; flat varying float vLayer; varying vec3 vTint; varying float vEmit;
void main(){
  vec4 wp = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  wp = instanceMatrix * wp; n = mat3(instanceMatrix) * n;
#endif
  wp = modelMatrix * wp; n = mat3(modelMatrix) * n;
  vPos = wp.xyz; vN = n; vUv = uv; vLayer = aLayer; vTint = aTint * 2.0; vEmit = aEmit;
#ifdef LIGHTMAP
  vLm = lmuv;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAlb, uNrm;
uniform float uFlashOn;
#ifdef LIGHTMAP
uniform sampler2D uLm0, uLm1, uDir0, uDir1; uniform float uDoor; varying vec2 vLm;
#else
uniform vec3 uAmb[6]; uniform vec4 uPrbPos[2]; uniform vec3 uPrbCol[2];
#endif
varying vec3 vPos; varying vec3 vN; varying vec2 vUv; flat varying float vLayer; varying vec3 vTint; varying float vEmit;
${COMMON}
vec3 decodeLm(vec4 t){ vec3 v = t.rgb * t.a * 4.0; return v * v; }
vec3 perturb(vec3 N, vec3 p, vec2 uv, vec3 tn){
  vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x, B = dp2perp * duv1.y + dp1perp * duv2.y;
  float m = max(dot(T, T), dot(B, B));
  if (m < 1e-20) return N;
  float s = inversesqrt(m);
  return normalize(mat3(T * s, B * s, N) * tn);
}
#ifndef LIGHTMAP
vec3 ambCube(vec3 n){ vec3 s = n * n; return s.x * (n.x > 0.0 ? uAmb[0] : uAmb[1]) + s.y * (n.y > 0.0 ? uAmb[2] : uAmb[3]) + s.z * (n.z > 0.0 ? uAmb[4] : uAmb[5]); }
#endif
void main(){
  vec4 A = texture(uAlb, vec3(vUv, vLayer));
  vec4 Nt = texture(uNrm, vec3(vUv, vLayer));
  vec3 albedo = A.rgb * mix(vec3(1.0), vTint, Nt.b);
  float rough = clamp(A.a, 0.05, 1.0), metal = Nt.a;
  vec3 tn = vec3(Nt.rg * 2.0 - 1.0, 0.0); tn.z = sqrt(max(1.0 - dot(tn.xy, tn.xy), 0.0));
  vec3 Ng = normalize(vN);
  if (!gl_FrontFacing) Ng = -Ng;
  vec3 N = perturb(Ng, vPos, vUv, tn);
  vec3 V = normalize(cameraPosition - vPos);
  float NoV = max(dot(N, V), 1e-3);
  vec3 diff = albedo * (1.0 - metal), f0 = mix(vec3(0.04), albedo, metal);
  float a = max(rough * rough, 0.002);
  vec3 col;
#ifdef LIGHTMAP
  vec3 lm = mix(decodeLm(texture(uLm0, vLm)), decodeLm(texture(uLm1, vLm)), uDoor);
  vec4 dd = mix(texture(uDir0, vLm), texture(uDir1, vLm), uDoor);
  vec3 ld = dd.xyz * 2.0 - 1.0; float dl = length(ld); ld = dl > 1e-3 ? ld / dl : Ng; float w = dd.a;
  float hg = max(dot(Ng, ld) * 0.5 + 0.5, 0.2);
  col = diff * lm * mix(1.0, (dot(N, ld) * 0.5 + 0.5) / hg, w);
  vec3 Eperp = lm * PI * w / max(dot(Ng, ld), 0.25);
  col += specBRDF(N, V, ld, f0, a) * Eperp * max(dot(N, ld), 0.0);
  col += envBRDF(f0, rough, NoV) * lm * (1.0 - 0.5 * w) * 0.9;
#else
  col = diff * ambCube(N);
  col += envBRDF(f0, rough, NoV) * ambCube(reflect(-V, N)) * 1.1;
  for (int i = 0; i < 2; i++) {
    vec3 Lv = uPrbPos[i].xyz - vPos; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
    float NoL = max(dot(N, L), 0.0);
    float soft = 1.0 / max(d2, uPrbPos[i].w);
    col += (diff / PI + specBRDF(N, V, L, f0, max(a, 0.03))) * uPrbCol[i] * soft * NoL * max(L.y, 0.0);
  }
#endif
  col += dynLights(vPos, N, V, diff, f0, a);
  float e = vEmit < 0.0 ? -vEmit * uFlashOn : vEmit; // negative = weapon-light lens
  col += A.rgb * vTint * e;
  float fd = length(cameraPosition - vPos);
  col = mix(col, uFogColor, 1.0 - exp(-fd * uFogDensity));
  gl_FragColor = vec4(finish(col), 1.0);
}`;

export function makeWorldMaterial(arrays, lm) {
  return new THREE.ShaderMaterial({
    defines: { LIGHTMAP: 1 },
    uniforms: { ...U, uAlb: { value: arrays.albedo }, uNrm: { value: arrays.normal }, uLm0: { value: lm.lm0 }, uLm1: { value: lm.lm1 }, uDir0: { value: lm.dir0 }, uDir1: { value: lm.dir1 }, uDoor: { value: 0 } },
    vertexShader: VERT, fragmentShader: FRAG,
  });
}
export function makeDynamicMaterial(arrays) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uAlb: { value: arrays.albedo }, uNrm: { value: arrays.normal } },
    vertexShader: VERT, fragmentShader: FRAG,
  });
}

// ---- decals: premultiplied alpha, lit by the zone lightmap (or a per-instance light colour) ----
const DECAL_VERT = /* glsl */`
attribute vec4 aTint; attribute float aWet;
#ifdef INSTANCED_LIGHT
attribute vec3 aLight; attribute vec4 aCell; varying vec3 vLight;
#else
attribute vec2 lmuv; varying vec2 vLm;
#endif
varying vec3 vPos; varying vec3 vN; varying vec2 vUv; varying vec4 vTint; varying float vWet;
void main(){
  vec4 wp = vec4(position, 1.0); vec3 n = normal;
#ifdef USE_INSTANCING
  wp = instanceMatrix * wp; n = mat3(instanceMatrix) * n;
#endif
  wp = modelMatrix * wp;
  vPos = wp.xyz; vN = n; vTint = aTint; vWet = aWet;
#ifdef INSTANCED_LIGHT
  vLight = aLight; vUv = mix(aCell.xy, aCell.zw, uv);
#else
  vLm = lmuv; vUv = uv;
#endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DECAL_FRAG = /* glsl */`
uniform sampler2D uMap;
#ifdef INSTANCED_LIGHT
varying vec3 vLight;
#else
uniform sampler2D uLm0, uLm1, uDir0, uDir1; uniform float uDoor; varying vec2 vLm;
#endif
varying vec3 vPos; varying vec3 vN; varying vec2 vUv; varying vec4 vTint; varying float vWet;
${COMMON}
vec3 decodeLm(vec4 t){ vec3 v = t.rgb * t.a * 4.0; return v * v; }
void main(){
  vec4 t = texture2D(uMap, vUv);
  float al = t.a * vTint.a;
  if (al < 0.004) discard;
  vec3 N = normalize(vN), V = normalize(cameraPosition - vPos);
  vec3 alb = t.rgb * vTint.rgb;
  vec3 lm, ld; float w;
#ifdef INSTANCED_LIGHT
  lm = vLight; ld = N; w = 0.0;
#else
  if (vLm.x < 0.0) { lm = vec3(0.05); ld = N; w = 0.0; }
  else {
    lm = mix(decodeLm(texture2D(uLm0, vLm)), decodeLm(texture2D(uLm1, vLm)), uDoor);
    vec4 dd = mix(texture2D(uDir0, vLm), texture2D(uDir1, vLm), uDoor);
    ld = normalize(dd.xyz * 2.0 - 1.0 + 1e-4); w = dd.a;
  }
#endif
  vec3 col = alb * lm + dynLights(vPos, N, V, alb, vec3(0.04), 0.5);
  // wetness: a near-mirror coat that picks up the fixtures' highlights
  float wet = vWet * al;
  vec3 sp = vec3(0.0);
  if (wet > 0.0) {
    float a = 0.06;
    sp = specBRDF(N, V, ld, vec3(0.03), a) * lm * PI * w / max(dot(N, ld), 0.25) * max(dot(N, ld), 0.0);
    sp += dynLights(vPos, N, V, vec3(0.0), vec3(0.03), a);
    sp += envBRDF(vec3(0.03), 0.1, max(dot(N, V), 1e-3)) * lm * 1.5;
  }
  float fd = length(cameraPosition - vPos), fog = 1.0 - exp(-fd * uFogDensity);
  col = mix(col, uFogColor, fog);
  vec3 c = finish(col + sp * wet);
  gl_FragColor = vec4(c * al, al * (1.0 - fog * 0.5));
}`;
const premult = m => { m.transparent = true; m.depthWrite = false; m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; return m; };
export function makeDecalMaterial(atlas, lm) {
  return premult(new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: atlas }, uLm0: { value: lm.lm0 }, uLm1: { value: lm.lm1 }, uDir0: { value: lm.dir0 }, uDir1: { value: lm.dir1 }, uDoor: { value: 0 } },
    vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG,
  }));
}
export function makeHoleMaterial(atlas) {
  return premult(new THREE.ShaderMaterial({ defines: { INSTANCED_LIGHT: 1 }, uniforms: { ...U, uMap: { value: atlas } }, vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG }));
}

// ---- light glows: camera-facing additive halos, visibility from CPU rays ----
export function makeGlowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uVis: { value: new Float32Array(32).fill(1) } },
    vertexShader: /* glsl */`
      attribute vec2 corner; attribute vec3 gcol; attribute vec2 gsize;
      uniform float uVis[32];
      varying vec2 vC; varying vec3 vCol;
      void main(){
        vec4 mv = viewMatrix * vec4(position, 1.0);
        float vis = uVis[int(gsize.y)];
        mv.xy += corner * gsize.x;
        vC = corner; vCol = gcol * vis;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uExposure; varying vec2 vC; varying vec3 vCol;
      void main(){
        float r2 = dot(vC, vC);
        float g = exp(-r2 * 9.0) * 0.012 + exp(-r2 * 40.0) * 0.02;
        vec3 c = vCol * g * uExposure;
        gl_FragColor = vec4(1.0 - exp(-c), 0.0);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
}

// ---- particles: soft points (smoke/dust) and additive sparks ----
export function makeSmokeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: /* glsl */`
      attribute float aSize; attribute float aAlpha; attribute float aLit;
      varying float vA; varying vec3 vPos; varying float vLit;
      void main(){
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * projectionMatrix[1][1] * uRes.y * 0.5 / max(-mv.z, 0.05);
        vA = aAlpha; vPos = position; vLit = aLit;
      }`.replace('void main', 'uniform vec2 uRes;\nvoid main'),
    fragmentShader: /* glsl */`
      uniform vec3 uAmbAvg;
      varying float vA; varying vec3 vPos; varying float vLit;
      ${COMMON}
      void main(){
        vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        float a = vA * (1.0 - r2) * (1.0 - r2);
        vec3 N = vec3(0.0, 1.0, 0.0), V = normalize(cameraPosition - vPos);
        vec3 l = uAmbAvg * 1.6 * vLit + dynLights(vPos, V, V, vec3(0.55), vec3(0.0), 1.0) * 1.2;
        vec3 col = finish(vec3(0.5, 0.49, 0.47) * l);
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}
export function makeSparkMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: /* glsl */`attribute float aHeat; varying float vH; void main(){ vH = aHeat; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uExposure; varying float vH; void main(){ vec3 c = vec3(6.0, 2.6, 0.7) * vH * uExposure; gl_FragColor = vec4(1.0 - exp(-c), 0.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
// muzzle flash: procedural star, additive
export function makeFlashMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uSeed: { value: 0 }, uI: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vU; void main(){ vU = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uSeed, uI; varying vec2 vU;
      void main(){
        float r = length(vU), a = atan(vU.y, vU.x);
        float petals = 0.55 + 0.45 * pow(abs(cos(a * 2.5 + uSeed * 6.28)), 3.0);
        float core = exp(-r * r * 22.0), star = exp(-r * 6.0 / petals) * (1.0 - r);
        vec3 c = (vec3(1.0, 0.82, 0.55) * core * 3.0 + vec3(1.0, 0.55, 0.18) * star * 1.4) * uI;
        gl_FragColor = vec4(1.0 - exp(-c), 0.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
// red-dot reticle (2 MOA dot + faint ring), on the sight's lens
export function makeReticleMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uB: { value: 1 } },
    vertexShader: /* glsl */`varying vec2 vU; void main(){ vU = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uB; varying vec2 vU;
      void main(){
        float r = length(vU);
        float dot_ = smoothstep(0.075, 0.035, r), halo = exp(-r * r * 60.0) * 0.35;
        float tintGlass = smoothstep(1.0, 0.92, r) * 0.08;
        vec3 c = vec3(1.0, 0.08, 0.04) * (dot_ + halo) * uB;
        gl_FragColor = vec4(c + vec3(0.02, 0.03, 0.035) * tintGlass, max(dot_ + halo, tintGlass));
      }`,
    transparent: true, depthWrite: false,
  });
}

// ---- the bottomless shaft (render/abyss.js): light dies off with depth, surfaces sink into black,
// lamps fade slower than walls so they recede long after the walls are gone
export const ABYSS_VERT = VERT;
export const ABYSS_FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAlb, uNrm;
uniform float uTop, uFall, uLampTop, uLampStep, uR;
uniform vec2 uC;
uniform vec3 uTopLight, uLampCol;
varying vec3 vPos; varying vec3 vN; varying vec2 vUv; flat varying float vLayer; varying vec3 vTint; varying float vEmit;
${COMMON}
void main(){
  vec4 A = texture(uAlb, vec3(vUv, vLayer));
  vec4 Nt = texture(uNrm, vec3(vUv, vLayer));
  vec3 albedo = A.rgb * mix(vec3(1.0), vTint, Nt.b);
  vec3 N = normalize(vN), V = normalize(cameraPosition - vPos);
  float depth = max(uTop - vPos.y, 0.0);
  // what the bake left at the top, falling off with depth (light from far above, faint bounce)
  vec3 E = uTopLight * (exp(-depth / uFall) * 0.85 + exp(-depth / (uFall * 4.0)) * 0.15);
  float dist = length(cameraPosition - vPos);
  // the gloom: what light comes from above dies in the dust
  float gloom = 1.0 - exp(-depth * 0.03 - dist * 0.004);
  vec3 col = (albedo * E + dynLights(vPos, N, V, albedo, vec3(0.04), 0.6)) * (1.0 - gloom);
  // each warning-lamp level lights a red band of wall round it (ring light), seen through the haze
  float yl = min(uLampTop, uLampTop - uLampStep * floor((uLampTop - vPos.y) / uLampStep + 0.5));
  float dy = vPos.y - yl, dr = uR - length(vPos.xz - uC);
  vec3 ring = uLampCol / (0.5 + dy * dy + dr * dr * 0.8);
  col += albedo * ring * exp(-dist * 0.012);
  // lamps: emissive, seen through the dark much further
  col += A.rgb * vTint * vEmit * exp(-dist / 140.0);
  gl_FragColor = vec4(finish(col), 1.0);
}`;
// lamp halos: additive points, a fixed world size but never under 1.5 px, so levels recede for ever
export function makeHaloMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uSize: { value: 1.6 } },
    vertexShader: /* glsl */`
      uniform vec2 uRes; uniform float uSize; varying float vK;
      void main(){
        vec4 mv = viewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = uSize * projectionMatrix[1][1] * uRes.y * 0.5 / max(-mv.z, 0.1);
        gl_PointSize = max(px, 1.5);
        vK = exp(-(-mv.z) / 160.0) * min(1.0, px / 1.5);
      }`,
    fragmentShader: /* glsl */`
      uniform float uExposure; varying float vK;
      void main(){
        vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        vec3 col = vec3(1.0, 0.16, 0.06) * (exp(-r2 * 14.0) * 1.6 + exp(-r2 * 3.5) * 0.25) * vK * uExposure;
        gl_FragColor = vec4(1.0 - exp(-col), 0.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
