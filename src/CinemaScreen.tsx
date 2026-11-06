import { Interactable, ScreenShareContext } from '@xrift/world-components'
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useAmbient } from './ambient/context'
import { SCREEN } from './layout'

/** Fit a picture of w×h inside the screen frame. */
export function containFit(resolution: [number, number] | null, frameW: number, frameH: number): [number, number] {
  if (!resolution) return [frameW, frameH]
  const aspect = resolution[0] / resolution[1]
  if (aspect >= frameW / frameH) return [frameW, frameW / aspect]
  return [frameH * aspect, frameH]
}

/** Japanese text drawn with the browser's own fonts (no font file to ship). */
function makePlaceholder(connected: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(640, 360, 40, 640, 360, 760)
  g.addColorStop(0, '#1c1a24')
  g.addColorStop(1, '#07070a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1280, 720)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#d9c9a3'
  ctx.font = '600 64px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif'
  ctx.fillText(connected ? 'スクリーンを選ぶと画面共有できます' : '音声通話につながると画面共有できます', 640, 320)
  ctx.fillStyle = '#8f8a99'
  ctx.font = '400 36px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif'
  ctx.fillText('映像の色がスクリーンの外へ広がり、部屋じゅうを染めます', 640, 410)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The screen. Same job as the official ScreenShareDisplay, but it owns the VideoTexture so the
 * ambient engine reads the very same upload (one texture upload per video frame, not two).
 */
export function CinemaScreen() {
  // useContext instead of useScreenShareContext(): no throw if a host ever lacks the provider.
  const share = useContext(ScreenShareContext)
  const videoElement = share?.videoElement ?? null
  const { engine } = useAmbient()
  const groupRef = useRef<THREE.Group>(null)
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null)
  const [resolution, setResolution] = useState<[number, number] | null>(null)

  useEffect(() => {
    if (!videoElement) {
      setTexture(null)
      setResolution(null)
      return
    }
    const tex = new THREE.VideoTexture(videoElement)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    setTexture(tex)

    // WebRTC tracks may report 0×0 at loadedmetadata; 'resize' settles it.
    const onSize = () => {
      if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        setResolution([videoElement.videoWidth, videoElement.videoHeight])
      }
    }
    const onPause = () => {
      videoElement.play().catch(() => undefined)
    }
    onSize()
    if (videoElement.paused) onPause()
    videoElement.addEventListener('loadedmetadata', onSize)
    videoElement.addEventListener('resize', onSize)
    videoElement.addEventListener('pause', onPause)
    return () => {
      videoElement.removeEventListener('loadedmetadata', onSize)
      videoElement.removeEventListener('resize', onSize)
      videoElement.removeEventListener('pause', onPause)
      tex.dispose()
    }
  }, [videoElement])

  useEffect(() => {
    engine.video = texture
    return () => {
      if (engine.video === texture) engine.video = null
    }
  }, [engine, texture])

  const size = useMemo(() => containFit(resolution, SCREEN.width, SCREEN.height), [resolution])

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.updateWorldMatrix(true, false)
    const center = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    group.getWorldPosition(center)
    group.getWorldQuaternion(quaternion)
    engine.setScreen(center, quaternion, size[0], size[1])
  }, [engine, size])

  const connected = share?.isRoomConnected ?? false
  const placeholder = useMemo(() => makePlaceholder(connected), [connected])
  useEffect(() => () => placeholder.dispose(), [placeholder])
  // The picture shows only while the engine counts the share as live (an ended track is not), and
  // a share that drops for a moment leaves a black screen, not the "start sharing" card.
  const videoRef = useRef<THREE.Mesh>(null)
  const placeholderRef = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const live = !!texture && engine.show.present
    if (videoRef.current) videoRef.current.visible = live
    if (placeholderRef.current) placeholderRef.current.visible = !live && !engine.holding
  })

  const sharing = share?.isSharing ?? false
  const onInteract = () => {
    if (!share) return
    if (sharing) share.stopScreenShare()
    else share.startScreenShare()
  }

  return (
    <group ref={groupRef} position={SCREEN.center}>
      <Interactable
        id="ambient-cinema-screen"
        onInteract={onInteract}
        interactionText={sharing ? '画面共有を止める' : '画面共有を始める'}
        enabled={!!share}
      >
        {/* Matte black frame: shows around a letterboxed picture. */}
        <mesh>
          <planeGeometry args={[SCREEN.width, SCREEN.height]} />
          <meshBasicMaterial color="#050506" toneMapped={false} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
        </mesh>
        <mesh ref={videoRef} visible={!!texture}>
          <planeGeometry args={[size[0], size[1]]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
        <mesh ref={placeholderRef} visible={!texture}>
          <planeGeometry args={[SCREEN.width, SCREEN.height]} />
          <meshBasicMaterial map={placeholder} toneMapped={false} />
        </mesh>
      </Interactable>
    </group>
  )
}
