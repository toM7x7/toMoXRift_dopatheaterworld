import * as THREE from 'three'

/**
 * Turns the shared video into small, blurred, time-smoothed pictures that the room shaders
 * read (the "ambient light" source), plus a few averaged colors on the CPU for real lights.
 *
 * video ─▶ 256×144 ─┬▶ 128×72 ─▶ light blur ─▶ mix with last (fade) ─▶ glowSharp (halo next to the frame, walls)
 *                   └▶ 64×36  ─▶ wide blur  ─▶ mix with last (fade) ─▶ glow      (room light, far halo)
 *                                                                        └▶ 4×1 probe ─▶ CPU colors
 *
 * Nothing goes over the network: every client computes this from the stream it already gets.
 */

export interface AmbientSettings {
  /** How much the halo image is enlarged around the screen (>1 = larger). */
  spread: number
  /** How far the halo reaches beyond the screen edge, in meters. */
  reach: number
  /** Halo brightness at the screen edge. */
  haloGain: number
  /** Blur width multiplier for the 64×36 picture. */
  blur: number
  /** Blur width multiplier for the 128×72 picture (keeps shapes readable next to the frame). */
  sharpBlur: number
  /** The picture continued across side walls, ceiling and floor (0 = off). */
  wall: number
  /** Seconds for colors to follow the picture (bigger = calmer). */
  fade: number
  /** Saturation multiplier for all ambient colors. */
  saturation: number
  /** Screen brightness as a light source for walls, floor and seats. */
  radiance: number
  /** Floor gloss (screen reflection strength). */
  gloss: number
  /** How quickly the floor reflection blurs with distance. */
  roughness: number
  /** Projector beam brightness. */
  beam: number
  /** Brightness of the lights that fall on avatars. */
  lights: number
  /** Update rate cap for the picture analysis. */
  fps: number
  /** Room dissolve: -1 never, 0 while a share is on (default), 1 as soon as there is a picture. */
  immerse: number
}

/** Seconds of picture before the room starts to dissolve (the light spreads first). */
export const IMMERSE_DELAY = 2
/** Seconds the dissolve takes to sweep from the screen to the back of the room. */
export const IMMERSE_IN = 5
/** Seconds the room takes to come back once the show is over. */
export const IMMERSE_OUT = 3
/**
 * A share that is gone for less than this (a reconnect, someone else taking over) changes
 * nothing: the room stays dissolved and the light keeps the last picture's colours.
 */
export const SHARE_GRACE = 3

/**
 * Is the shared video still a live source? A stalled or frozen stream still is (its track stays
 * live), only an ended track is not. The host normally drops the element when sharing stops;
 * this also covers it keeping the element with a dead stream.
 */
function sourceAlive(texture: THREE.Texture): boolean {
  const v = texture.image as HTMLVideoElement | null
  if (!v || typeof v !== 'object' || !('videoWidth' in v)) return true
  const stream = v.srcObject as { getVideoTracks?: () => { readyState: string }[] } | null
  if (stream && typeof stream.getVideoTracks === 'function') {
    // No video track (not arrived yet, or removed) counts as no share: at the start nothing lights
    // up until it arrives, mid-show the grace period starts.
    return stream.getVideoTracks().some((t) => t.readyState !== 'ended')
  }
  return !!(v.currentSrc || v.src)
}

export const DEFAULT_SETTINGS: AmbientSettings = {
  spread: 1.7,
  reach: 2.8,
  haloGain: 1.7,
  blur: 1.6,
  sharpBlur: 1,
  wall: 1,
  fade: 0.25,
  saturation: 1.4,
  radiance: 6,
  gloss: 0.7,
  roughness: 0.05,
  beam: 1,
  lights: 1,
  fps: 30,
  immerse: 0,
}

/** Uniforms shared by every ambient-aware material (same objects, so one update reaches all). */
export interface AmbientUniforms {
  uGlow: { value: THREE.Texture | null }
  uGlowSharp: { value: THREE.Texture | null }
  uScreenCenter: { value: THREE.Vector3 }
  uScreenRight: { value: THREE.Vector3 }
  uScreenUp: { value: THREE.Vector3 }
  uScreenNormal: { value: THREE.Vector3 }
  uScreenSize: { value: THREE.Vector2 }
  /** Fixed point in the audience the wall projection is aimed from (stable, not per-head). */
  uViewPoint: { value: THREE.Vector3 }
  /** 0..1, fades in while a picture is on the screen. */
  uActive: { value: number }
  /** Per-viewer strength (projector switch). */
  uLevel: { value: number }
  uSat: { value: number }
  uRadiance: { value: number }
  uSpread: { value: number }
  uReach: { value: number }
  uHaloGain: { value: number }
  uWall: { value: number }
  uGloss: { value: number }
  uRoughness: { value: number }
  uBeam: { value: number }
  /** House lights, dimmed while the picture is on. */
  uHouse: { value: number }
  /** 0..1: how far the room has dissolved into the picture (while a share is on). */
  uImmerse: { value: number }
  uTime: { value: number }
}

const W_MID = 256
const H_MID = 144
const W_MED = 128
const H_MED = 72
const W_SMALL = 64
const H_SMALL = 36

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const DOWNSAMPLE_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec3 s = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      s += texture2D(uSrc, vUv + (vec2(float(i), float(j)) - 1.5) * uStep).rgb;
    }
  }
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`

const BLUR_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(uSrc, vUv).rgb * 0.2270270270;
  s += texture2D(uSrc, vUv + uDir * 1.0).rgb * 0.1945945946;
  s += texture2D(uSrc, vUv - uDir * 1.0).rgb * 0.1945945946;
  s += texture2D(uSrc, vUv + uDir * 2.0).rgb * 0.1216216216;
  s += texture2D(uSrc, vUv - uDir * 2.0).rgb * 0.1216216216;
  s += texture2D(uSrc, vUv + uDir * 3.0).rgb * 0.0540540541;
  s += texture2D(uSrc, vUv - uDir * 3.0).rgb * 0.0540540541;
  s += texture2D(uSrc, vUv + uDir * 4.0).rgb * 0.0162162162;
  s += texture2D(uSrc, vUv - uDir * 4.0).rgb * 0.0162162162;
  gl_FragColor = vec4(s, 1.0);
}
`

const BLEND_FRAG = /* glsl */ `
uniform sampler2D uPrev;
uniform sampler2D uCur;
uniform float uK;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(mix(texture2D(uPrev, vUv).rgb, texture2D(uCur, vUv).rgb, uK), 1.0);
}
`

/** 4×1: left half, right half, whole picture, (unused). sqrt-encoded for 8-bit precision. */
const PROBE_FRAG = /* glsl */ `
uniform sampler2D uSrc;
void main() {
  float x = floor(gl_FragCoord.x);
  vec2 lo = vec2(0.0);
  vec2 hi = vec2(1.0);
  if (x < 0.5) hi.x = 0.5;
  else if (x < 1.5) lo.x = 0.5;
  vec3 s = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 6; i++) {
      vec2 uv = lo + (hi - lo) * (vec2(float(i), float(j)) + 0.5) / vec2(6.0, 4.0);
      s += texture2D(uSrc, uv).rgb;
    }
  }
  gl_FragColor = vec4(sqrt(clamp(s / 24.0, 0.0, 1.0)), 1.0);
}
`

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  })
}

interface Targets {
  mid: THREE.WebGLRenderTarget
  med: THREE.WebGLRenderTarget
  medTmp: THREE.WebGLRenderTarget
  sharpA: THREE.WebGLRenderTarget
  sharpB: THREE.WebGLRenderTarget
  small: THREE.WebGLRenderTarget
  tmp: THREE.WebGLRenderTarget
  glowA: THREE.WebGLRenderTarget
  glowB: THREE.WebGLRenderTarget
  probe: THREE.WebGLRenderTarget
}

export class AmbientEngine {
  readonly uniforms: AmbientUniforms = {
    uGlow: { value: null },
    uGlowSharp: { value: null },
    uScreenCenter: { value: new THREE.Vector3() },
    uScreenRight: { value: new THREE.Vector3(1, 0, 0) },
    uScreenUp: { value: new THREE.Vector3(0, 1, 0) },
    uScreenNormal: { value: new THREE.Vector3(0, 0, 1) },
    uScreenSize: { value: new THREE.Vector2(1, 1) },
    uViewPoint: { value: new THREE.Vector3(0, 2.6, 1.5) },
    uActive: { value: 0 },
    uLevel: { value: 1 },
    uSat: { value: 1 },
    uRadiance: { value: 1 },
    uSpread: { value: 1 },
    uReach: { value: 1 },
    uHaloGain: { value: 1 },
    uWall: { value: 1 },
    uGloss: { value: 0 },
    uRoughness: { value: 0 },
    uBeam: { value: 1 },
    uHouse: { value: 1 },
    uImmerse: { value: 0 },
    uTime: { value: 0 },
  }

  settings: AmbientSettings = { ...DEFAULT_SETTINGS }
  /** Set by the screen while a picture is shown. */
  video: THREE.Texture | null = null
  /** Averaged picture colors (linear) for real lights: left half, right half, whole. */
  readonly colors = {
    left: new THREE.Color(0, 0, 0),
    right: new THREE.Color(0, 0, 0),
    whole: new THREE.Color(0, 0, 0),
  }
  /** Bumped every time a pass ran; handy for dev checks. */
  frames = 0
  /**
   * The screening, driven only by the share being there (never by what the picture shows, so a
   * buffering spinner, a stalled live stream or a still game screen changes nothing):
   * - present: a live shared video exists
   * - onAir: seconds of picture in this screening (kept through a short gap)
   * - gap: seconds since the share went away (0 while present)
   * - lit: the picture's light is on (also during a short gap, on the last colours)
   * - immersed: the room should be dissolved
   * - progress: 0..1 dissolve, moving at a fixed speed toward 0 or 1
   */
  readonly show = { present: false, onAir: 0, gap: 0, lit: false, immersed: false, progress: 0 }
  /** Dev/screenshots: pin the dissolve at this value (null = normal). */
  holdImmerse: number | null = null

  private targets: Targets | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: THREE.Mesh
  private readonly downsample = pass(DOWNSAMPLE_FRAG, { uSrc: { value: null }, uStep: { value: new THREE.Vector2() } })
  private readonly blurMat = pass(BLUR_FRAG, { uSrc: { value: null }, uDir: { value: new THREE.Vector2() } })
  private readonly blendMat = pass(BLEND_FRAG, { uPrev: { value: null }, uCur: { value: null }, uK: { value: 1 } })
  private readonly probeMat = pass(PROBE_FRAG, { uSrc: { value: null } })
  private sinceUpdate = 0
  private sinceProbe = 0
  private lastTime: number | null = null
  private probeBusy = false
  private readonly probeBuffer = new Uint8Array(16)
  private flip = false

  constructor() {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.downsample)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)
  }

  private ensure(gl: THREE.WebGLRenderer): Targets {
    if (this.targets) return this.targets
    const ext = gl.extensions
    const halfOk = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float')
    const type = halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType
    const make = (w: number, h: number, t: THREE.TextureDataType = type) =>
      new THREE.WebGLRenderTarget(w, h, {
        type: t,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      })
    this.targets = {
      mid: make(W_MID, H_MID),
      med: make(W_MED, H_MED),
      medTmp: make(W_MED, H_MED),
      sharpA: make(W_MED, H_MED),
      sharpB: make(W_MED, H_MED),
      small: make(W_SMALL, H_SMALL),
      tmp: make(W_SMALL, H_SMALL),
      glowA: make(W_SMALL, H_SMALL),
      glowB: make(W_SMALL, H_SMALL),
      probe: make(4, 1, THREE.UnsignedByteType),
    }
    this.uniforms.uGlow.value = this.targets.glowA.texture
    this.uniforms.uGlowSharp.value = this.targets.sharpA.texture
    return this.targets
  }

  private draw(gl: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
    this.quad.material = material
    gl.setRenderTarget(target)
    gl.render(this.scene, this.camera)
  }

  private blur(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget, width: number, height: number, scale: number) {
    const b = this.blurMat.uniforms
    b.uSrc.value = target.texture
    b.uDir.value.set(scale / width, 0)
    this.draw(gl, this.blurMat, tmp)
    b.uSrc.value = tmp.texture
    b.uDir.value.set(0, scale / height)
    this.draw(gl, this.blurMat, target)
  }

  private blend(gl: THREE.WebGLRenderer, prev: THREE.WebGLRenderTarget, cur: THREE.WebGLRenderTarget, next: THREE.WebGLRenderTarget, k: number) {
    const bl = this.blendMat.uniforms
    bl.uPrev.value = prev.texture
    bl.uCur.value = cur.texture
    bl.uK.value = k
    this.draw(gl, this.blendMat, next)
  }

  /**
   * Push settings into the shared uniforms (cheap; call every frame). `dt` is clamped for smooth
   * fades; `realDt` is wall-clock time so the share timers stay true after a hidden tab or a slow frame.
   */
  private applySettings(dt: number, realDt: number) {
    const s = this.settings
    const u = this.uniforms
    u.uSat.value = s.saturation
    u.uRadiance.value = s.radiance
    u.uSpread.value = s.spread
    u.uReach.value = s.reach
    u.uHaloGain.value = s.haloGain
    u.uWall.value = s.wall
    u.uGloss.value = s.gloss
    u.uRoughness.value = s.roughness
    u.uBeam.value = s.beam
    this.updateShow(realDt)
    const target = this.show.lit ? 1 : 0
    u.uActive.value += (target - u.uActive.value) * (1 - Math.exp(-dt / 0.9))
    if (Math.abs(target - u.uActive.value) < 1e-3) u.uActive.value = target
    // House lights dim as the picture comes up, like a real cinema.
    u.uHouse.value = 0.55 - 0.48 * u.uActive.value
    this.updateImmerse(dt)
  }

  /**
   * Share on → after IMMERSE_DELAY s of picture the room dissolves and stays dissolved for the
   * whole share. Share gone for more than SHARE_GRACE s → the show is over, the room comes back.
   */
  private updateShow(dt: number) {
    const sh = this.show
    sh.present = !!this.video && sourceAlive(this.video)
    sh.gap = sh.present ? 0 : sh.gap + dt
    if (sh.gap > SHARE_GRACE) {
      sh.onAir = 0
      sh.immersed = false
    }
    const v = this.video?.image as HTMLVideoElement | undefined
    if (sh.present && (v?.videoWidth ?? 0) > 0) sh.onAir += dt
    if (sh.onAir > IMMERSE_DELAY) sh.immersed = true
    sh.lit = sh.present || (sh.onAir > 0 && sh.gap <= SHARE_GRACE)
  }

  /** Moves the dissolve at a fixed speed (a steady burn from the screen to the back). */
  private updateImmerse(dt: number) {
    const s = this.settings
    const u = this.uniforms
    const sh = this.show
    let target = s.immerse > 0.5 ? 1 : s.immerse < -0.5 ? 0 : sh.immersed ? 1 : 0
    if (!sh.lit || u.uLevel.value <= 0) target = 0
    if (target > sh.progress) sh.progress = Math.min(target, sh.progress + dt / IMMERSE_IN)
    else sh.progress = Math.max(target, sh.progress - dt / IMMERSE_OUT)
    u.uImmerse.value = this.holdImmerse ?? sh.progress
  }

  /** The screen shows black instead of its "start sharing" card while the light is held. */
  get holding(): boolean {
    return !this.show.present && this.show.lit
  }

  /** @param dt clamped frame time; @param time clock time in seconds (wall clock). */
  tick(gl: THREE.WebGLRenderer, dt: number, time: number) {
    const realDt = this.lastTime === null ? dt : Math.max(0, time - this.lastTime)
    this.lastTime = time
    this.uniforms.uTime.value = time
    this.applySettings(dt, realDt)
    this.sinceUpdate += dt
    this.sinceProbe += dt
    // No live picture: keep the last blurred pictures and colours (held light during a gap).
    if (!this.video || !this.show.present) return
    // Light switched off (切): everything it feeds is multiplied by 0, so skip the GPU work.
    if (this.uniforms.uLevel.value <= 0) return
    if (this.sinceUpdate < 1 / Math.max(1, this.settings.fps) - 1e-4) return
    const step = this.sinceUpdate
    this.sinceUpdate = 0

    const t = this.ensure(gl)
    const prevTarget = gl.getRenderTarget()
    const xrEnabled = gl.xr.enabled
    const shadowAuto = gl.shadowMap.autoUpdate
    // Same trick as three's Reflector: our offscreen passes must not be turned into XR views.
    gl.xr.enabled = false
    gl.shadowMap.autoUpdate = false
    try {
      this.runPasses(gl, t, step)
    } finally {
      // The renderer is the host's: always hand it back as we found it.
      gl.setRenderTarget(prevTarget)
      gl.xr.enabled = xrEnabled
      gl.shadowMap.autoUpdate = shadowAuto
    }
  }

  private runPasses(gl: THREE.WebGLRenderer, t: Targets, step: number) {
    const d = this.downsample.uniforms
    d.uSrc.value = this.video
    d.uStep.value.set(1 / W_MID / 4, 1 / H_MID / 4)
    this.draw(gl, this.downsample, t.mid)
    d.uSrc.value = t.mid.texture
    d.uStep.value.set(1 / W_MED / 4, 1 / H_MED / 4)
    this.draw(gl, this.downsample, t.med)
    d.uStep.value.set(1 / W_MID, 1 / H_MID)
    this.draw(gl, this.downsample, t.small)

    this.blur(gl, t.med, t.medTmp, W_MED, H_MED, this.settings.sharpBlur)
    this.blur(gl, t.small, t.tmp, W_SMALL, H_SMALL, this.settings.blur)

    // A fresh picture after a pause snaps in instead of crawling up from black.
    const k = this.frames === 0 ? 1 : 1 - Math.exp(-step / Math.max(0.01, this.settings.fade))
    const glowNext = this.flip ? t.glowA : t.glowB
    const sharpNext = this.flip ? t.sharpA : t.sharpB
    this.blend(gl, this.flip ? t.glowB : t.glowA, t.small, glowNext, k)
    this.blend(gl, this.flip ? t.sharpB : t.sharpA, t.med, sharpNext, k)
    this.flip = !this.flip
    this.uniforms.uGlow.value = glowNext.texture
    this.uniforms.uGlowSharp.value = sharpNext.texture
    this.frames++

    if (this.sinceProbe >= 0.1 && !this.probeBusy) {
      this.sinceProbe = 0
      this.probeMat.uniforms.uSrc.value = glowNext.texture
      this.draw(gl, this.probeMat, t.probe)
      this.readProbe(gl, t.probe)
    }
  }

  private readProbe(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    const buf = this.probeBuffer
    const apply = () => {
      const decode = (c: THREE.Color, i: number) => {
        const r = buf[i * 4] / 255
        const g = buf[i * 4 + 1] / 255
        const b = buf[i * 4 + 2] / 255
        c.setRGB(r * r, g * g, b * b)
      }
      decode(this.colors.left, 0)
      decode(this.colors.right, 1)
      decode(this.colors.whole, 2)
    }
    const asyncRead = (gl as unknown as { readRenderTargetPixelsAsync?: THREE.WebGLRenderer['readRenderTargetPixels'] })
      .readRenderTargetPixelsAsync
    if (typeof asyncRead === 'function') {
      this.probeBusy = true
      Promise.resolve(asyncRead.call(gl, target, 0, 0, 4, 1, buf))
        .then(apply)
        .catch(() => undefined)
        .finally(() => {
          this.probeBusy = false
        })
      return
    }
    gl.readRenderTargetPixels(target, 0, 0, 4, 1, buf)
    apply()
  }

  /** Called when the screen's picture area changes. */
  setScreen(center: THREE.Vector3, quaternion: THREE.Quaternion, width: number, height: number) {
    const u = this.uniforms
    u.uScreenCenter.value.copy(center)
    u.uScreenRight.value.set(1, 0, 0).applyQuaternion(quaternion)
    u.uScreenUp.value.set(0, 1, 0).applyQuaternion(quaternion)
    u.uScreenNormal.value.set(0, 0, 1).applyQuaternion(quaternion)
    u.uScreenSize.value.set(width, height)
  }

  dispose() {
    if (this.targets) {
      for (const target of Object.values(this.targets)) target.dispose()
      this.targets = null
    }
    // Disposed three objects are rebuilt on next use, so a StrictMode remount keeps working.
    for (const m of [this.downsample, this.blurMat, this.blendMat, this.probeMat]) m.dispose()
    this.quad.geometry.dispose()
    this.uniforms.uGlow.value = null
    this.uniforms.uGlowSharp.value = null
    this.frames = 0
    this.lastTime = null
  }
}
