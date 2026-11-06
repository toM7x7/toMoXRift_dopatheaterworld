import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useAmbient } from './ambient/context'
import { createBeamMaterial, createDustMaterial, createHaloMaterial } from './ambient/materials'
import { PROJECTOR, ROOM, SCREEN } from './layout'

/** Additive glow across the whole screen wall; the shader keeps it around the picture. */
export function Halo() {
  const { engine } = useAmbient()
  const material = useMemo(() => createHaloMaterial(engine.uniforms), [engine])
  useEffect(() => () => material.dispose(), [material])
  const w = ROOM.halfWidth * 2
  return (
    <mesh position={[0, ROOM.height / 2, ROOM.front + 0.03]} material={material} renderOrder={2}>
      <planeGeometry args={[w, ROOM.height]} />
    </mesh>
  )
}

/** Pyramid from the lens to the picture corners, reading the picture colors. */
export function ProjectorBeam() {
  const { engine } = useAmbient()
  const projector = useMemo(() => new THREE.Vector3(...PROJECTOR), [])
  const material = useMemo(() => createBeamMaterial(engine.uniforms, projector), [engine, projector])
  useEffect(() => () => material.dispose(), [material])

  const geometry = useMemo(() => new THREE.BufferGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // Rebuild when the picture size changes (letterboxing).
  const lastSize = useRef(new THREE.Vector2(-1, -1))
  useFrame(() => {
    const size = engine.uniforms.uScreenSize.value
    if (size.equals(lastSize.current)) return
    lastSize.current.copy(size)
    const c = new THREE.Vector3(...SCREEN.center)
    const hw = size.x / 2
    const hh = size.y / 2
    const corners = [
      new THREE.Vector3(c.x - hw, c.y - hh, c.z),
      new THREE.Vector3(c.x + hw, c.y - hh, c.z),
      new THREE.Vector3(c.x + hw, c.y + hh, c.z),
      new THREE.Vector3(c.x - hw, c.y + hh, c.z),
    ]
    const p = projector
    const tris: THREE.Vector3[] = []
    const planes = material.uniforms.uPlanes.value as THREE.Vector3[]
    for (let i = 0; i < 4; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % 4]
      tris.push(p, a, b)
      // Inward normal of the side plane through the lens (the winding gives the outward one).
      planes[i].subVectors(a, p).cross(new THREE.Vector3().subVectors(b, p)).normalize().negate()
    }
    ;(material.uniforms.uAxis.value as THREE.Vector3).subVectors(c, p).normalize()
    geometry.setFromPoints(tris)
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
  })

  return <mesh geometry={geometry} material={material} renderOrder={3} />
}

const DUST_COUNT = 700

/** Motes drifting in the house light while nothing is playing; gone once the picture is up. */
export function BeamDust() {
  const { engine } = useAmbient()
  const material = useMemo(
    () => createDustMaterial(
      engine.uniforms,
      new THREE.Vector3(-ROOM.halfWidth + 0.3, 0.4, ROOM.front + 0.5),
      new THREE.Vector3(ROOM.halfWidth - 0.3, ROOM.height - 0.4, ROOM.back - 0.3),
    ),
    [engine],
  )
  useEffect(() => () => material.dispose(), [material])

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const seeds = new Float32Array(DUST_COUNT * 3)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_COUNT * 3), 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3))
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const pointsRef = useRef<THREE.Points>(null)
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const dpr = useThree((s) => s.viewport.dpr)
  useFrame(() => {
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 60
    material.uniforms.uPixelScale.value = (size.height * dpr) / (2 * Math.tan((fov * Math.PI) / 360))
    // Skip drawing entirely once the show is fully on.
    if (pointsRef.current) pointsRef.current.visible = engine.uniforms.uActive.value < 0.999
  })

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />
}

const tmpColor = new THREE.Color()

function driveSpot(light: THREE.SpotLight | null, source: THREE.Color, gain: number) {
  if (!light) return
  const peak = Math.max(source.r, source.g, source.b)
  if (peak < 1e-4) {
    light.intensity = 0
    return
  }
  tmpColor.copy(source).multiplyScalar(1 / peak)
  light.color.copy(tmpColor)
  light.intensity = peak * gain
}

/**
 * Real lights so avatars and anything with a standard material pick up the picture colors:
 * the left half lights from the left, the right half from the right. House lights dim with the show.
 */
export function AudienceLights() {
  const { engine } = useAmbient()
  const left = useRef<THREE.SpotLight>(null)
  const right = useRef<THREE.SpotLight>(null)
  const ambient = useRef<THREE.AmbientLight>(null)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const targets = useMemo(() => {
    const l = new THREE.Object3D()
    const r = new THREE.Object3D()
    l.position.set(-2.5, 1, 4)
    r.position.set(2.5, 1, 4)
    return { l, r }
  }, [])

  useFrame(() => {
    const u = engine.uniforms
    const k = u.uActive.value * u.uLevel.value * engine.settings.lights
    const gain = 260 * k
    driveSpot(left.current, engine.colors.left, gain)
    driveSpot(right.current, engine.colors.right, gain)
    if (ambient.current) {
      ambient.current.intensity = 0.25 + u.uHouse.value * 0.9
    }
    if (hemi.current) {
      hemi.current.intensity = u.uHouse.value * 1.2
    }
  })

  const z = ROOM.front + 0.8
  const y = SCREEN.center[1]
  return (
    <>
      <primitive object={targets.l} />
      <primitive object={targets.r} />
      <spotLight ref={left} position={[-SCREEN.width / 4, y, z]} target={targets.l} angle={1.05} penumbra={1} decay={2} intensity={0} />
      <spotLight ref={right} position={[SCREEN.width / 4, y, z]} target={targets.r} angle={1.05} penumbra={1} decay={2} intensity={0} />
      <ambientLight ref={ambient} color="#ffe2c4" intensity={0.6} />
      <hemisphereLight ref={hemi} args={['#fff1dc', '#2a2030', 0.6]} />
    </>
  )
}
