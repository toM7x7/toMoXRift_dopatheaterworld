/**
 * 開発用エントリーポイント（npm run dev）。本番では使われません。
 *
 * 本番の画面共有の代わりに、ここで用意した映像を ScreenShareContext に流し込みます。
 * スクリーンをクリックするとテスト映像が流れます（パネルから動画ファイルも選べます）。
 *
 * URL:
 *   ?play=1         読み込み後すぐテスト映像を流す
 *   ?scene=0..4     テスト映像の場面を固定（0 夕焼け / 1 海 / 2 左右で色違い / 3 ネオン / 4 森）
 *   ?video=/a.mp4   テスト映像の代わりに動画ファイル
 *   ?clean         テスト映像の左下の文字を出さない（撮影用）
 *   ?immerse=1|-1   部屋が消える演出を、待たずにすぐ／なし（既定は共有が始まって2秒後）
 *   ?nofakes        観客の代役（光の当たり方を見る人形）を出さない
 *   ?nopanel        調整パネルを隠す
 *   ?cam=x,y,z,tx,ty,tz  撮影用にカメラを固定
 */
import { useFrame, useThree } from '@react-three/fiber'
import { DevEnvironment, XRiftProvider, useSeatContext } from '@xrift/world-components'
import type { CameraConfig, PhysicsConfig, ScreenShareContextValue } from '@xrift/world-components'
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LEVELS, useAmbient } from './ambient/context'
import { DEFAULT_SETTINGS, IMMERSE_DELAY, SHARE_GRACE, type AmbientEngine, type AmbientSettings } from './ambient/engine'
import { TEST_SCENE_NAMES, startFileVideo, startTestPattern, type TestPattern } from './devTestPattern'
import { SEAT_ROWS, SPAWN, floorY } from './layout'
import { World } from './World'
import xriftConfig from '../xrift.json'

const query = new URLSearchParams(location.search)
const cam = query.get('cam')?.split(',').map(Number)
const pinned = !!cam && cam.length === 6
const sceneHold = query.has('scene') ? Number(query.get('scene')) : -1

function CameraPin({ pose }: { pose: number[] }) {
  useFrame((s) => {
    s.camera.position.set(pose[0], pose[1], pose[2])
    s.camera.lookAt(pose[3], pose[4], pose[5])
    s.gl.render(s.scene, s.camera)
  }, 1)
  return null
}

/** window.__ambient for browser checks. */
function DevHelper({ share }: { share: DevShare }) {
  const { engine, cycleLevel } = useAmbient()
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const seat = useSeatContext()
  useEffect(() => {
    const api = {
      engine,
      cycleLevel,
      share,
      info: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, programs: gl.info.programs?.length }),
      sit: (id: string) => seat.sit(id),
      occupant: (id: string) => seat.getOccupantId(id),
      look: (yaw: number, pitch: number) => {
        camera.rotation.order = 'YXZ'
        camera.rotation.set((pitch * Math.PI) / 180, (yaw * Math.PI) / 180, 0)
      },
      pos: () => camera.position.toArray().map((n) => Math.round(n * 100) / 100),
      colors: () => Object.fromEntries(Object.entries(engine.colors).map(([k, c]) => [k, c.toArray().map((n) => Math.round(n * 1000) / 1000)])),
    }
    ;(window as unknown as { __ambient: typeof api }).__ambient = api
  }, [engine, cycleLevel, camera, gl, seat, share])
  return null
}

/** Stand-ins for avatars: standard materials, so they show what the real lights do. */
function FakeAudience() {
  const people = useMemo(() => {
    const out: { p: [number, number, number]; seated: boolean; color: string }[] = []
    const palette = ['#d9d4cc', '#4f7fd9', '#e0457b', '#f0c24a', '#9ad16b', '#c9c9d6']
    const seats: [number, number][] = [[-1.65, 0], [2.3, 0], [-2.97, 2], [1.65, 2], [-1.65, 4], [3.63, 3]]
    seats.forEach(([x, row], i) => {
      const z = SEAT_ROWS[row] + 0.3
      out.push({ p: [x, floorY(z) + 0.5, z], seated: true, color: palette[i % palette.length] })
    })
    out.push({ p: [-1.2, 0, -6.5], seated: false, color: '#ffffff' })
    out.push({ p: [1.4, 0, -5.8], seated: false, color: '#b9b2ff' })
    return out
  }, [])
  return (
    <>
      {people.map((m, i) => (
        <group key={i} position={m.p}>
          <mesh position={[0, m.seated ? 0.42 : 0.85, 0]}>
            <capsuleGeometry args={[0.2, m.seated ? 0.5 : 0.95, 6, 14]} />
            <meshStandardMaterial color={m.color} roughness={0.6} />
          </mesh>
          <mesh position={[0, m.seated ? 0.98 : 1.58, 0]}>
            <sphereGeometry args={[0.13, 18, 14]} />
            <meshStandardMaterial color="#f2d2b6" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </>
  )
}

type Source = { kind: 'pattern' } | { kind: 'file'; src: string; name: string }

function useDevScreenShare() {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const current = useRef<TestPattern | null>(null)
  const nextSource = useRef<Source>(query.get('video') ? { kind: 'file', src: query.get('video')!, name: query.get('video')! } : { kind: 'pattern' })
  const [sourceName, setSourceName] = useState(nextSource.current.kind === 'file' ? nextSource.current.name : 'テスト映像')

  const stop = useCallback(() => {
    current.current?.stop()
    current.current = null
    setVideo(null)
  }, [])
  const start = useCallback(() => {
    current.current?.stop()
    const src = nextSource.current
    current.current = src.kind === 'file' ? startFileVideo(src.src) : startTestPattern(sceneHold, 5, !query.has('clean'))
    setSourceName(src.kind === 'file' ? src.name : 'テスト映像')
    setVideo(current.current.video)
  }, [])
  const chooseFile = useCallback((file: File) => {
    nextSource.current = { kind: 'file', src: URL.createObjectURL(file), name: file.name }
    start()
  }, [start])
  const choosePattern = useCallback(() => {
    nextSource.current = { kind: 'pattern' }
    start()
  }, [start])
  // Stall: the stream stays but no new frames come (a stuck live stream / buffering).
  const [frozen, setFrozen] = useState(false)
  const freeze = useCallback((on: boolean) => {
    current.current?.freeze?.(on)
    setFrozen(on)
  }, [])
  // Drop: the share disappears and a new one comes back after `seconds` (reconnect / takeover).
  const drop = useCallback((seconds: number) => {
    stop()
    setTimeout(start, seconds * 1000)
  }, [start, stop])

  useEffect(() => {
    if (query.get('play') === '1') start()
    return () => current.current?.stop()
  }, [start])

  const impl = useMemo<ScreenShareContextValue>(() => ({
    videoElement: video,
    isSharing: !!video,
    startScreenShare: start,
    stopScreenShare: stop,
    isRoomConnected: true,
  }), [video, start, stop])
  return { impl, sharing: !!video, sourceName, start, stop, chooseFile, choosePattern, frozen, freeze, drop }
}
type DevShare = ReturnType<typeof useDevScreenShare>

/** What the screening is doing, in words (dev readout). */
function describeShow(engine: AmbientEngine): string {
  const sh = engine.show
  const pct = `${Math.round(sh.progress * 100)}%`
  if (sh.present && sh.onAir === 0) return '映像待ち'
  if (sh.present && !sh.immersed) return `上映中・あと${Math.max(0, IMMERSE_DELAY - sh.onAir).toFixed(1)}秒で消え始める`
  if (sh.present) return `上映中・消え具合 ${pct}`
  if (sh.lit) return `途切れ・あと${Math.max(0, SHARE_GRACE - sh.gap).toFixed(1)}秒で終演（消え具合 ${pct}）`
  return sh.progress > 0 ? `終演・戻り中 ${pct}` : '共有なし'
}

const SLIDERS: { key: keyof AmbientSettings; label: string; min: number; max: number; step: number }[] = [
  { key: 'spread', label: '広がり（拡大率）', min: 1, max: 2.5, step: 0.05 },
  { key: 'reach', label: '後光の届く距離 m', min: 0.3, max: 5, step: 0.1 },
  { key: 'haloGain', label: '後光の明るさ', min: 0, max: 3, step: 0.05 },
  { key: 'blur', label: 'ぼかし（遠く）', min: 0.5, max: 4, step: 0.1 },
  { key: 'sharpBlur', label: 'ぼかし（縁のすぐ外）', min: 0.3, max: 4, step: 0.1 },
  { key: 'wall', label: '壁・天井・床へ映像を広げる', min: 0, max: 3, step: 0.05 },
  { key: 'fade', label: 'なめらかさ 秒', min: 0.02, max: 2, step: 0.02 },
  { key: 'saturation', label: '彩度', min: 0, max: 2.5, step: 0.05 },
  { key: 'radiance', label: '部屋を照らす強さ', min: 0, max: 15, step: 0.25 },
  { key: 'gloss', label: '床の映り込み', min: 0, max: 2, step: 0.05 },
  { key: 'roughness', label: '映り込みのぼけ', min: 0, max: 0.2, step: 0.005 },
  { key: 'beam', label: '映写の光の筋', min: 0, max: 3, step: 0.05 },
  { key: 'lights', label: 'アバターを照らす光', min: 0, max: 3, step: 0.05 },
  { key: 'fps', label: '更新 fps', min: 5, max: 60, step: 1 },
]

interface PanelProps {
  settings: AmbientSettings
  onChange: (s: AmbientSettings) => void
  share: DevShare
}

function DevPanel({ settings, onChange, share }: PanelProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(true)
  const [level, setLevel] = useState(0)
  const [show, setShow] = useState('')
  useEffect(() => {
    const t = setInterval(() => {
      const a = (window as unknown as { __ambient?: { engine: AmbientEngine } }).__ambient
      if (!a) return
      setLevel(LEVELS.findIndex((l) => l.value === a.engine.uniforms.uLevel.value))
      setShow(describeShow(a.engine))
    }, 200)
    return () => clearInterval(t)
  }, [])
  if (pinned || query.has('nopanel')) return null
  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: '.12em', color: '#d9c9a3', flex: 1 }}>DOPAGAKI CINEMA · DEV</div>
        <button style={{ ...btn, flex: 'none', padding: '2px 8px' }} onClick={() => setOpen(!open)}>{open ? '閉じる' : '開く'}</button>
      </div>
      <div style={{ fontSize: 12, margin: '4px 0 6px' }}>
        {share.sharing ? `再生中：${share.sourceName}` : '停止中（スクリーンをクリックで再生）'} / 光：{LEVELS[Math.max(0, level)]?.label}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button style={btn} onClick={share.choosePattern}>テスト映像</button>
        <button style={btn} onClick={() => fileRef.current?.click()}>動画ファイル…</button>
        <button style={btn} onClick={share.stop}>停止</button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button style={{ ...btn, outline: share.frozen ? '2px solid #d9c9a3' : 'none' }} onClick={() => share.freeze(!share.frozen)}>
          {share.frozen ? '動かす' : '固める（止まりかけ）'}
        </button>
        <button style={btn} onClick={() => share.drop(1.5)}>一瞬切る 1.5秒</button>
        <button style={btn} onClick={() => share.drop(6)}>切る 6秒</button>
      </div>
      <div style={{ fontSize: 12, margin: '8px 0 4px' }}>{show}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {[{ v: 0, l: '消える：共有中' }, { v: 1, l: 'すぐ' }, { v: -1, l: 'なし' }].map((m) => (
          <button key={m.v} style={{ ...btn, outline: settings.immerse === m.v ? '2px solid #d9c9a3' : 'none' }}
            onClick={() => onChange({ ...settings, immerse: m.v })}>{m.l}</button>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) share.chooseFile(f)
      }} />
      {open && (
        <div style={{ marginTop: 8 }}>
          {SLIDERS.map((s) => (
            <label key={s.key} style={{ display: 'block', marginTop: 4 }}>
              <span style={{ display: 'flex' }}>
                <span style={{ flex: 1 }}>{s.label}</span>
                <span style={{ color: '#d9c9a3' }}>{settings[s.key]}</span>
              </span>
              <input type="range" min={s.min} max={s.max} step={s.step} value={settings[s.key]} style={{ width: '100%' }}
                onChange={(e) => onChange({ ...settings, [s.key]: Number(e.target.value) })} />
            </label>
          ))}
          <button style={{ ...btn, marginTop: 6, width: '100%' }} onClick={() => onChange({ ...DEFAULT_SETTINGS })}>初期値に戻す</button>
          <div style={{ fontSize: 10, color: '#aaa', marginTop: 6, lineHeight: 1.6 }}>
            場面：{TEST_SCENE_NAMES.join(' → ')}。映写機に触れると自分の見え方だけ光の強さが変わる。
          </div>
        </div>
      )}
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'fixed', top: 12, right: 12, width: 270, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', padding: '10px 12px', zIndex: 10,
  background: 'rgba(16,14,20,.82)', color: '#eee', borderRadius: 8, font: '12px system-ui, "Yu Gothic", sans-serif',
}
const btn: React.CSSProperties = { flex: 1, padding: '5px 2px', background: '#3a3442', color: '#eee', border: 0, borderRadius: 4, cursor: 'pointer', font: 'inherit' }

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

const config = (xriftConfig as { world: { physics?: PhysicsConfig; camera?: CameraConfig } }).world

function DevRoot() {
  const share = useDevScreenShare()
  const [settings, setSettings] = useState<AmbientSettings>(() => ({
    ...DEFAULT_SETTINGS,
    immerse: query.has('immerse') ? Number(query.get('immerse')) : DEFAULT_SETTINGS.immerse,
  }))
  return (
    <XRiftProvider baseUrl="/" screenShareImplementation={share.impl}>
      <DevEnvironment physicsConfig={config.physics} camera={config.camera} spawnPosition={[SPAWN[0], SPAWN[1] + 1, SPAWN[2]]}>
        <World settings={settings} spawn={!pinned}>
          <DevHelper share={share} />
          {!query.has('nofakes') && <FakeAudience />}
        </World>
        {pinned && <CameraPin pose={cam!} />}
      </DevEnvironment>
      <DevPanel settings={settings} onChange={setSettings} share={share} />
    </XRiftProvider>
  )
}


createRoot(rootElement).render(
  <StrictMode>
    <DevRoot />
  </StrictMode>,
)
