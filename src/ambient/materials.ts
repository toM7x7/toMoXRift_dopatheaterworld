import * as THREE from 'three'
import type { AmbientUniforms } from './engine'

/**
 * Shader pieces that read the ambient picture. All screen math is in "screen space":
 * q = (-0.5..0.5, -0.5..0.5) across the picture, uv = q + 0.5.
 */
const COMMON = /* glsl */ `
uniform sampler2D uGlow;
uniform sampler2D uGlowSharp;
uniform vec3 uScreenCenter;
uniform vec3 uScreenRight;
uniform vec3 uScreenUp;
uniform vec3 uScreenNormal;
uniform vec2 uScreenSize;
uniform vec3 uViewPoint;
uniform float uActive;
uniform float uLevel;
uniform float uSat;
uniform float uRadiance;
uniform float uSpread;
uniform float uReach;
uniform float uHaloGain;
uniform float uWall;
uniform float uGloss;
uniform float uRoughness;
uniform float uBeam;
uniform float uHouse;
uniform float uImmerse;
uniform float uTime;

vec3 ambSat(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(l), c, uSat), 0.0);
}
/** Heavily blurred picture (room light, far halo). */
vec3 glowAt(vec2 uv) {
  return ambSat(texture2D(uGlow, clamp(uv, 0.0, 1.0)).rgb);
}
/** Lightly blurred picture: shapes stay readable right outside the frame. */
vec3 sharpAt(vec2 uv) {
  return ambSat(texture2D(uGlowSharp, clamp(uv, 0.0, 1.0)).rgb);
}
/**
 * Hue-preserving tone curve used instead of the renderer's (ACES turns bright colour
 * into pastel/white; the glow should stay as vivid as the browser extension's).
 */
vec3 ambTone(vec3 c) {
  float m = max(max(c.r, c.g), c.b);
  if (m <= 1e-5) return c;
  return c * ((1.0 - exp(-m * 1.15)) / m);
}
/** Screen-space coordinate q of a world point lying on the screen plane. */
vec2 screenQ(vec3 x) {
  vec3 d = x - uScreenCenter;
  return vec2(dot(d, uScreenRight) / uScreenSize.x, dot(d, uScreenUp) / uScreenSize.y);
}
/** Distance (m) from q to the picture rectangle, 0 inside. */
float outside(vec2 q) {
  vec2 d = max(abs(q * uScreenSize) - uScreenSize * 0.5, 0.0);
  return length(d);
}
/**
 * The halo painted on the wall around the picture, layered like the browser extension:
 * right at the frame a barely enlarged, lightly blurred copy (shapes carry on past the edge),
 * further out a strongly enlarged, heavily blurred copy, fading slowly.
 */
vec3 haloAt(vec2 q) {
  float dist = outside(q);
  float t = smoothstep(0.0, uReach * 0.9, dist);
  vec3 nearC = sharpAt(0.5 + q / 1.08);
  vec3 farC = glowAt(0.5 + q / uSpread);
  float fall = 0.55 * exp(-dist / (uReach * 0.45)) + 0.45 * exp(-dist / uReach);
  return mix(nearC, farC, t) * fall * uHaloGain;
}
/**
 * The picture continued over the room: a ray from a fixed audience point through P hits the
 * (infinitely extended) screen plane; that spot of the enlarged picture is what P shows.
 * Near the frame it is the picture itself enlarged; far out it becomes the edge colours,
 * so the left wall carries the left edge, the ceiling the top, keeping the vertical layout.
 */
vec3 projectAt(vec3 P, out float weight) {
  vec3 dv = P - uViewPoint;
  float dn = dot(dv, uScreenNormal);
  weight = 0.0;
  if (dn > -1e-3) return vec3(0.0);
  float fwd = -dn / length(dv);
  float t = dot(uScreenCenter - uViewPoint, uScreenNormal) / dn;
  vec2 q = screenQ(uViewPoint + dv * t);
  vec2 uv = 0.5 + clamp(q / (uSpread * 1.35), -0.5, 0.5);
  weight = pow(clamp(fwd, 0.0, 1.0), 1.3);
  float far = smoothstep(0.6, 2.0, max(abs(q.x), abs(q.y)));
  return mix(sharpAt(uv), glowAt(uv), far);
}
/** What the screen wall emits at q: the picture itself inside, the halo outside. */
vec3 wallAt(vec2 q, float soft) {
  // 1 - smoothstep(lo, hi): GLSL leaves smoothstep undefined when edge0 > edge1.
  vec2 e = 1.0 - smoothstep(vec2(0.5 - soft), vec2(0.5 + soft), abs(q));
  float inside = e.x * e.y;
  return mix(haloAt(q) * 0.6, glowAt(q + 0.5), inside);
}
float ambStrength() {
  return uActive * uLevel;
}
float dhash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dhash(i), dhash(i + vec3(1, 0, 0)), f.x), mix(dhash(i + vec3(0, 1, 0)), dhash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dhash(i + vec3(0, 0, 1)), dhash(i + vec3(1, 0, 1)), f.x), mix(dhash(i + vec3(0, 1, 1)), dhash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
/**
 * Room dissolve (while a share is on): where this point sits on the wave that sweeps from the screen to the back
 * (0 = goes first). Returns the distance past the threshold; < 0 means already dissolved.
 */
float dissolveLeft(vec3 P) {
  float front = clamp(dot(P - uScreenCenter, uScreenNormal) / 22.0, 0.0, 1.0);
  float n = dnoise(P * 3.1) * 0.55 + dnoise(P * 9.7) * 0.45;
  float t = front * 0.62 + n * 0.38;
  return t - (uImmerse * 1.3 - 0.15);
}
/** Colour of the glowing rim where a part is dissolving. */
vec3 dissolveGlow(vec3 P) {
  float w;
  vec3 pc = projectAt(P, w);
  return mix(sharpAt(vec2(0.5)), pc, w) * 3.0 + vec3(0.12);
}
`

/**
 * Lambert light from the picture, sampled on a 6×4 grid of patches (runs per vertex).
 * Falloff is deliberately softer than 1/d² (≈1/d) so the colour reaches the back of the room:
 * near the screen it is ~7× brighter than 9 m away instead of ~80×.
 */
const SCREEN_LIGHT = /* glsl */ `
vec3 screenLight(vec3 P, vec3 N, out vec3 bounce) {
  vec3 sum = vec3(0.0);
  vec3 avg = vec3(0.0);
  float area = uScreenSize.x * uScreenSize.y / 24.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 6; i++) {
      vec2 uv = (vec2(float(i), float(j)) + 0.5) / vec2(6.0, 4.0);
      vec3 S = uScreenCenter + uScreenRight * (uv.x - 0.5) * uScreenSize.x + uScreenUp * (uv.y - 0.5) * uScreenSize.y;
      vec3 d = P - S;
      float dist = length(d) + 1e-4;
      vec3 L = d / dist;
      float cs = max(dot(uScreenNormal, L), 0.0);
      float cr = max(dot(N, -L), 0.0);
      vec3 c = glowAt(uv);
      sum += c * (cs * cr * area / (3.14159 * (dist * 3.0 + 1.0)));
      avg += c;
    }
  }
  bounce = avg / 24.0;
  return sum;
}
/**
 * The halo on the screen wall also lights what is next to it (side walls, ceiling, floor near
 * the front), so the glow wraps around the corners instead of stopping at them.
 */
vec3 haloWrap(vec3 P, vec3 N) {
  float away = dot(P - uScreenCenter, uScreenNormal);
  vec3 onWall = P - uScreenNormal * away;
  float facing = 1.0 - abs(dot(N, uScreenNormal));
  return haloAt(screenQ(onWall)) * exp(-max(away, 0.0) / 1.8) * facing;
}
`

export interface RoomMaterialOptions {
  color: THREE.ColorRepresentation
  /** Floor: adds a glossy reflection of the screen and its halo. */
  reflect?: boolean
  /** Fabric panel seams across world X/Z, for a sense of scale on walls. */
  panels?: boolean
  /** Light emitted regardless of the screen (e.g. aisle strips). */
  emissive?: THREE.ColorRepresentation
  /** Multiplies the global floor gloss for this surface (polished stage vs carpet). */
  glossScale?: number
  /** Shows the enlarged picture continued over this surface (walls, ceiling, floor). */
  project?: boolean
  /** Velvet sheen (seats, curtains, pilasters). */
  velvet?: boolean
  /** Procedural cinema carpet pattern (world XZ). */
  carpet?: boolean
  /** Metal: reflections tinted by the base colour, weaker diffuse. */
  metal?: boolean
  /** Bare wall / ceiling / floor: stays when the room dissolves and turns into the picture. */
  base?: boolean
  /** How strongly a base surface shows the picture once the room has dissolved (the screen wall also gets the halo). */
  baseGain?: number
  /** Detail: dissolves while a share is on (screen side first, glowing rim). */
  dissolve?: boolean
}

const ROOM_VERT = /* glsl */ `
${COMMON}
${SCREEN_LIGHT}
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vScreenLight;
varying vec3 vBounce;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(m) * normal);
  vec3 bounce;
  vScreenLight = screenLight(wp.xyz, vNormal, bounce) + haloWrap(wp.xyz, vNormal) * 0.22;
  vBounce = bounce;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const ROOM_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uGlossScale;
uniform float uMetal;
uniform float uBaseGain;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vScreenLight;
varying vec3 vBounce;
void main() {
#ifdef USE_DISSOLVE
  float dLeft = dissolveLeft(vWorldPos);
  if (uImmerse > 0.0 && dLeft < 0.0) discard;
#endif
  vec3 N = normalize(vNormal);
  vec3 albedo = uColor;
#ifdef USE_PANELS
  // Vertical fabric panels with thin seams.
  float u = abs(N.x) > 0.5 ? vWorldPos.z : vWorldPos.x;
  float seam = smoothstep(0.0, 0.03, abs(fract(u / 1.2) - 0.5) * 1.2 - 0.57);
  albedo *= 1.0 - 0.35 * (1.0 - seam);
#endif
#ifdef USE_CARPET
  // Cinema carpet: diamonds (gold / teal, alternating) on a 0.6 m grid, dots between them.
  vec2 cp = vWorldPos.xz / 0.6;
  vec2 cell = floor(cp);
  vec2 cf = fract(cp) - 0.5;
  float dia = abs(cf.x) + abs(cf.y);
  float aa = fwidth(dia) * 1.5 + 1e-4;
  float ring = 1.0 - smoothstep(0.022, 0.022 + aa, abs(dia - 0.15));
  vec2 df = fract(cp + 0.5) - 0.5;
  float dl = length(df);
  float dotm = 1.0 - smoothstep(0.035, 0.035 + fwidth(dl) * 1.5 + 1e-4, dl);
  vec3 motif = mod(cell.x + cell.y, 2.0) < 0.5 ? vec3(0.62, 0.45, 0.18) : vec3(0.12, 0.42, 0.4);
  albedo = mix(albedo, motif, ring * 0.85);
  albedo = mix(albedo, vec3(0.62, 0.45, 0.18), dotm * 0.8);
#endif
  float k = ambStrength();
  vec3 house = vec3(1.0, 0.86, 0.7) * uHouse * (0.35 + 0.65 * max(N.y, 0.0) + 0.25 * max(-N.y, 0.0));
  vec3 light = vScreenLight * uRadiance * k + vBounce * 0.06 * uRadiance * k + house * 0.6;
  vec3 col = albedo * light * (1.0 - 0.5 * uMetal) + uEmissive;
#ifdef USE_VELVET
  // Velvet: the pile catches light at grazing angles, so edges and folds glow.
  vec3 Vv = normalize(cameraPosition - vWorldPos);
  float rim = pow(1.0 - max(dot(N, Vv), 0.0), 2.2);
  col += albedo * light * rim * 1.6 + albedo * 0.04 * uHouse;
#endif
#ifdef USE_REFLECT
  vec3 V = normalize(vWorldPos - cameraPosition);
  vec3 R = reflect(V, N);
  float denom = dot(R, uScreenNormal);
  if (denom < -1e-3) {
    float t = dot(uScreenCenter - vWorldPos, uScreenNormal) / denom;
    if (t > 0.0) {
      vec2 q = screenQ(vWorldPos + R * t);
      float soft = 0.015 + t * uRoughness / max(uGlossScale, 0.5);
      float fres = 0.08 + 0.92 * pow(1.0 - max(dot(-V, N), 0.0), 4.0);
      vec3 tint = mix(vec3(1.0), albedo * 1.6, uMetal);
      col += wallAt(q, soft) * fres * uGloss * uGlossScale * uRadiance * 0.22 * k * tint;
      col += tint * uHouse * fres * 0.05 * uGlossScale;
    }
  }
#endif
#ifdef USE_PROJECT
  float pw;
  vec3 pc = projectAt(vWorldPos, pw);
  float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  col += pc * pw * (0.12 + lum * 4.0) * 0.6 * uWall * k;
#endif
#ifdef USE_BASE
  // Once the room has dissolved the bare walls, ceiling and floor become the picture itself.
  if (uImmerse > 0.0) {
    float bw;
    vec3 bc = projectAt(vWorldPos, bw);
    vec3 pure = (bc * (0.25 + 0.75 * bw) * 1.3 + glowAt(vec2(0.5)) * 0.08) * uWall * k * uBaseGain;
    col = mix(col, col * 0.35 + pure, uImmerse);
  }
#endif
#ifdef USE_DISSOLVE
  if (uImmerse > 0.0) col += dissolveGlow(vWorldPos) * (1.0 - smoothstep(0.0, 0.022, dLeft)) * k;
#endif
  gl_FragColor = vec4(ambTone(col), 1.0);
  #include <colorspace_fragment>
}
`

export function createRoomMaterial(uniforms: AmbientUniforms, options: RoomMaterialOptions) {
  const defines: Record<string, string> = {}
  if (options.reflect) defines.USE_REFLECT = ''
  if (options.panels) defines.USE_PANELS = ''
  if (options.project) defines.USE_PROJECT = ''
  if (options.velvet) defines.USE_VELVET = ''
  if (options.carpet) defines.USE_CARPET = ''
  if (options.base) defines.USE_BASE = ''
  else if (options.dissolve) defines.USE_DISSOLVE = ''
  return new THREE.ShaderMaterial({
    vertexShader: ROOM_VERT,
    fragmentShader: ROOM_FRAG,
    defines,
    toneMapped: false,
    uniforms: {
      ...uniforms,
      uColor: { value: new THREE.Color(options.color) },
      uEmissive: { value: new THREE.Color(options.emissive ?? 0x000000) },
      uGlossScale: { value: options.glossScale ?? 1 },
      uMetal: { value: options.metal ? 1 : 0 },
      uBaseGain: { value: options.baseGain ?? 1 },
    },
  })
}

const GLOW_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const GLOW_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uColor;
uniform float uHouseDim;
varying vec3 vWorldPos;
void main() {
  float dLeft = dissolveLeft(vWorldPos);
  if (uImmerse > 0.0 && dLeft < 0.0) discard;
  // House-dimmed lights fall to ~25% while the picture is up.
  float dim = mix(1.0, 0.25 + uHouse * 1.36, uHouseDim);
  vec3 c = uColor * dim;
  if (uImmerse > 0.0) c += dissolveGlow(vWorldPos) * (1.0 - smoothstep(0.0, 0.022, dLeft)) * ambStrength();
  gl_FragColor = vec4(ambTone(c), 1.0);
  #include <colorspace_fragment>
}
`

/** Self-lit parts (cove lines, downlights, sconces, step lights, exit signs). */
export function createGlowMaterial(uniforms: AmbientUniforms, color: THREE.ColorRepresentation, intensity: number, houseDim: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    toneMapped: false,
    uniforms: {
      ...uniforms,
      uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
      uHouseDim: { value: houseDim ? 1 : 0 },
    },
  })
}

const HALO_VERT = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const HALO_FRAG = /* glsl */ `
${COMMON}
varying vec3 vWorldPos;
void main() {
  vec2 q = screenQ(vWorldPos);
  vec3 c = haloAt(q) * ambStrength();
  gl_FragColor = vec4(ambTone(c), 1.0);
  #include <colorspace_fragment>
}
`

/** Additive glow on the screen wall, like the browser extension's light around the player. */
export function createHaloMaterial(uniforms: AmbientUniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    uniforms: { ...uniforms },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
}

const BEAM_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

/**
 * Volumetric beam without ray marching: drawn on the pyramid's back faces, each fragment clips
 * the view ray against the pyramid's planes and integrates a few samples along the inside part.
 * Thin at the silhouette, thick through the middle, and it still works with the camera inside.
 */
const BEAM_FRAG = /* glsl */ `
${COMMON}
uniform vec3 uProjector;
uniform vec3 uPlanes[4];
uniform vec3 uAxis;
varying vec3 vWorldPos;
varying vec3 vNormal;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void clipPlane(vec3 ro, vec3 rd, vec3 point, vec3 n, inout float t0, inout float t1) {
  float d0 = dot(ro - point, n);
  float den = dot(rd, n);
  if (abs(den) < 1e-6) {
    if (d0 < 0.0) t1 = -1.0;
    return;
  }
  float t = -d0 / den;
  if (den > 0.0) t0 = max(t0, t);
  else t1 = min(t1, t);
}
vec3 beamSample(vec3 p, float screenT) {
  vec3 dir = p - uProjector;
  float denom = dot(dir, uScreenNormal);
  float t = screenT / min(denom, -1e-4);
  vec2 q = screenQ(uProjector + dir * t);
  float along = clamp(1.0 / t, 0.0, 1.0);
  float fade = smoothstep(0.0, 0.1, along) * (1.0 - 0.7 * smoothstep(0.65, 1.0, along));
  // Spread over a wider cross-section near the lens: keep brightness per area roughly even.
  fade *= 1.0 / (0.4 + along * 1.2);
  vec3 h = p * 1.1 + vec3(0.0, uTime * 0.05, uTime * 0.03);
  float haze = 0.45 + 0.55 * noise(h) * noise(h * 2.3 + 3.1);
  return glowAt(q + 0.5) * fade * haze;
}
void main() {
  vec3 ro = cameraPosition;
  vec3 toFrag = vWorldPos - ro;
  float tFar = length(toFrag);
  vec3 rd = toFrag / tFar;
  float t0 = 0.0;
  float t1 = tFar;
  for (int i = 0; i < 4; i++) clipPlane(ro, rd, uProjector, uPlanes[i], t0, t1);
  clipPlane(ro, rd, uProjector, uAxis, t0, t1);
  clipPlane(ro, rd, uScreenCenter, uScreenNormal, t0, t1);
  float len = t1 - t0;
  if (len <= 0.0) discard;
  float screenT = dot(uScreenCenter - uProjector, uScreenNormal);
  vec3 c = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float f = (float(k) + 0.5) / 3.0;
    c += beamSample(ro + rd * mix(t0, t1, f), screenT);
  }
  c *= len / 3.0 * 0.03 * uBeam * ambStrength();
  gl_FragColor = vec4(ambTone(c), 1.0);
  #include <colorspace_fragment>
}
`

export function createBeamMaterial(uniforms: AmbientUniforms, projector: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: {
      ...uniforms,
      uProjector: { value: projector },
      uPlanes: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uAxis: { value: new THREE.Vector3(0, 0, -1) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
  })
}

/**
 * Idle ambience only: motes drifting through the whole room in the house light.
 * They fade out as the picture comes up so nothing floats between you and the screen.
 */
const DUST_VERT = /* glsl */ `
${COMMON}
uniform vec3 uRoomMin;
uniform vec3 uRoomMax;
uniform float uPixelScale;
attribute vec3 aSeed;
varying vec3 vColor;
void main() {
  vec3 drift = vec3(
    0.25 * sin(uTime * 0.07 + aSeed.y * 40.0),
    0.18 * sin(uTime * 0.05 + aSeed.z * 33.0) + uTime * 0.012,
    0.25 * cos(uTime * 0.06 + aSeed.x * 29.0)
  );
  vec3 span = uRoomMax - uRoomMin;
  vec3 p = aSeed * span + drift;
  p = uRoomMin + mod(p, span);
  float twinkle = 0.45 + 0.55 * sin(uTime * (0.6 + fract(aSeed.x * 91.0)) + aSeed.z * 80.0);
  vColor = vec3(1.0, 0.82, 0.58) * 0.5 * twinkle * uHouse * (1.0 - uActive);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.016 * uPixelScale / -mv.z, 1.0, 5.0);
}
`

const DUST_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.0, 0.5, length(d));
  gl_FragColor = vec4(vColor * a, 1.0);
  #include <colorspace_fragment>
}
`

export function createDustMaterial(uniforms: AmbientUniforms, roomMin: THREE.Vector3, roomMax: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    uniforms: { ...uniforms, uRoomMin: { value: roomMin }, uRoomMax: { value: roomMax }, uPixelScale: { value: 900 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })
}
