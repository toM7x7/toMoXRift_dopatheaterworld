import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { Interactable, Seat, useXRift } from '@xrift/world-components'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { LEVELS, useAmbient } from './ambient/context'
import { createGlowMaterial, createRoomMaterial, type RoomMaterialOptions } from './ambient/materials'
import {
  ARM_SPOTS,
  END_PANEL_SPOTS,
  PROJECTOR_BASE,
  RAKE_ANGLE,
  RAKE_END,
  RAKE_RISE,
  RAKE_START,
  ROOM,
  SEAT_SPOTS,
} from './layout'

const SLAB = 0.4
const MODEL = 'ambient-cinema.glb'

/**
 * How each Blender material (design/index.html "素材と光") is drawn: room shaders take the
 * screen's light; glows are self-lit, the house ones dim while the picture is up.
 */
const SURFACES: Record<string, Omit<RoomMaterialOptions, 'color'>> = {
  // Bare surfaces: stay while the room is dissolved and become the picture.
  AC_front_fabric: { base: true, baseGain: 0.45 },
  AC_wall_base: { project: true, base: true },
  AC_ceiling_base: { project: true, base: true },
  AC_stage: { reflect: true, glossScale: 2.2, project: true, base: true },
  AC_carpet: { reflect: true, glossScale: 0.35, project: true, carpet: true, base: true },
  // Details: dissolve while a share is on (see design/index.html), seats included.
  AC_wall_fabric: { project: true },
  AC_wood: { project: true, reflect: true, glossScale: 0.25 },
  AC_brass: { reflect: true, glossScale: 1.6, metal: true },
  AC_metal: { reflect: true, glossScale: 1.2, metal: true },
  AC_black_velvet: { velvet: true },
  AC_curtain: { velvet: true, project: true },
  AC_ceiling: { project: true },
  AC_beam: { project: true },
  AC_seat_velvet: { velvet: true },
  AC_seat_frame: { reflect: true, glossScale: 0.3 },
  AC_arm: { velvet: true },
  AC_door: { reflect: true, glossScale: 0.3 },
  AC_projector: { reflect: true, glossScale: 0.6, metal: true },
}
const GLOWS: Record<string, { intensity: number; houseDim: boolean }> = {
  AC_glow_cove: { intensity: 1.5, houseDim: true },
  AC_glow_down: { intensity: 2.2, houseDim: true },
  AC_glow_sconce: { intensity: 2.0, houseDim: true },
  AC_glow_booth: { intensity: 1.6, houseDim: true },
  AC_glow_step: { intensity: 1.3, houseDim: false },
  AC_glow_exit: { intensity: 1.2, houseDim: false },
  AC_glow_exit_white: { intensity: 1.3, houseDim: false },
}

interface Parts {
  room: THREE.Mesh[]
  seat: THREE.Mesh[]
  arm: THREE.Mesh[]
  endPanel: THREE.Mesh[]
  projector: THREE.Mesh[]
  lens: THREE.Mesh | null
}

function collect(root: THREE.Object3D): Parts {
  const parts: Parts = { room: [], seat: [], arm: [], endPanel: [], projector: [], lens: null }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (mesh.name === 'Projector_Lens') parts.lens = mesh
    else if (mesh.name.startsWith('Room_')) parts.room.push(mesh)
    else if (mesh.name.startsWith('SeatProto_')) parts.seat.push(mesh)
    else if (mesh.name.startsWith('ArmProto_')) parts.arm.push(mesh)
    else if (mesh.name.startsWith('EndPanelProto_')) parts.endPanel.push(mesh)
    else if (mesh.name.startsWith('Projector_')) parts.projector.push(mesh)
  })
  return parts
}

type MaterialFor = (source: THREE.Material | THREE.Material[], keep?: boolean) => THREE.Material

/**
 * One ambient material per Blender material name, built on first use. `keep` gives a copy that
 * never dissolves (the projector: it is the light switch, so it must stay findable mid-show).
 */
function useMaterialMap(): MaterialFor {
  const { engine } = useAmbient()
  const cache = useMemo(() => new Map<string, THREE.Material>(), [engine])
  useEffect(() => () => {
    cache.forEach((m) => m.dispose())
    cache.clear()
  }, [cache])
  return (source, keep = false) => {
    const src = (Array.isArray(source) ? source[0] : source) as THREE.MeshStandardMaterial
    const name = src.name
    const key = keep ? `${name}#keep` : name
    const hit = cache.get(key)
    if (hit) return hit
    const color = src.color?.clone() ?? new THREE.Color(0.2, 0.2, 0.2)
    const glow = GLOWS[name]
    const made = glow
      ? createGlowMaterial(engine.uniforms, color, glow.intensity, glow.houseDim)
      : createRoomMaterial(engine.uniforms, { color, dissolve: !keep && !SURFACES[name]?.base, ...(SURFACES[name] ?? {}) })
    cache.set(key, made)
    return made
  }
}

export function Room() {
  const { baseUrl } = useXRift()
  const gltf = useGLTF(`${baseUrl}${MODEL}`)
  const parts = useMemo(() => collect(gltf.scene), [gltf])
  const material = useMaterialMap()

  return (
    <>
      <Colliders />
      {parts.room.map((m) => (
        <mesh key={m.name} geometry={m.geometry} material={material(m.material)} />
      ))}
      <Instances meshes={parts.seat} spots={SEAT_SPOTS.map((s) => ({ pos: s.floor, yaw: 0 }))} material={material} />
      <Instances meshes={parts.arm} spots={ARM_SPOTS.map((pos) => ({ pos, yaw: 0 }))} material={material} />
      <Instances meshes={parts.endPanel} spots={END_PANEL_SPOTS} material={material} />
      <SeatTargets />
      <Projector meshes={parts.projector} lens={parts.lens} material={material} />
    </>
  )
}

/** Floor, rake, back platform and walls. Seats, curtains and pilasters can be walked through. */
function Colliders() {
  const depth = ROOM.back - ROOM.front
  const midZ = (ROOM.front + ROOM.back) / 2
  const frontLen = RAKE_START - ROOM.front
  const rakeRun = RAKE_END - RAKE_START
  const rakeLen = Math.hypot(rakeRun, RAKE_RISE)
  const normal = new THREE.Vector3(0, Math.cos(RAKE_ANGLE), -Math.sin(RAKE_ANGLE))
  const rakeCenter = new THREE.Vector3(0, RAKE_RISE / 2, (RAKE_START + RAKE_END) / 2).addScaledVector(normal, -SLAB / 2)
  const backLen = ROOM.back - RAKE_END + 0.1
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[ROOM.halfWidth, SLAB / 2, frontLen / 2]} position={[0, -SLAB / 2, ROOM.front + frontLen / 2]} />
      <CuboidCollider args={[ROOM.halfWidth, SLAB / 2, rakeLen / 2]} position={rakeCenter.toArray()} rotation={[-RAKE_ANGLE, 0, 0]} />
      <CuboidCollider args={[ROOM.halfWidth, SLAB / 2, backLen / 2]} position={[0, RAKE_RISE - SLAB / 2, ROOM.back - backLen / 2]} />
      <CuboidCollider args={[0.25, ROOM.height / 2, depth / 2]} position={[-ROOM.halfWidth - 0.25, ROOM.height / 2, midZ]} />
      <CuboidCollider args={[0.25, ROOM.height / 2, depth / 2]} position={[ROOM.halfWidth + 0.25, ROOM.height / 2, midZ]} />
      <CuboidCollider args={[ROOM.halfWidth, ROOM.height / 2, 0.25]} position={[0, ROOM.height / 2, ROOM.front - 0.25]} />
      <CuboidCollider args={[ROOM.halfWidth, ROOM.height / 2, 0.25]} position={[0, ROOM.height / 2, ROOM.back + 0.25]} />
      <CuboidCollider args={[ROOM.halfWidth, 0.25, depth / 2]} position={[0, ROOM.height + 0.25, midZ]} />
      {/* Projector pedestal */}
      <CuboidCollider args={[0.35, 1, 0.35]} position={[PROJECTOR_BASE[0], PROJECTOR_BASE[1] + 1, PROJECTOR_BASE[2]]} />
    </RigidBody>
  )
}

interface InstancesProps {
  meshes: THREE.Mesh[]
  spots: { pos: [number, number, number]; yaw: number }[]
  material: MaterialFor
}

/** One draw call per material for all copies of a prototype (seat, armrest, end panel). */
function Instances({ meshes, spots, material }: InstancesProps) {
  return (
    <>
      {meshes.map((m) => (
        <InstancedPart key={m.name} geometry={m.geometry} material={material(m.material)} spots={spots} />
      ))}
    </>
  )
}

function InstancedPart({ geometry, material, spots }: { geometry: THREE.BufferGeometry; material: THREE.Material; spots: InstancesProps['spots'] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const one = new THREE.Vector3(1, 1, 1)
    const p = new THREE.Vector3()
    spots.forEach((s, i) => {
      q.setFromAxisAngle(up, s.yaw)
      mesh.setMatrixAt(i, m.compose(p.set(...s.pos), q, one))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [spots])
  return <instancedMesh ref={ref} args={[geometry, material, spots.length]} />
}

/**
 * Every seat can be sat in. The click target is an invisible box over the cushion
 * (one shared geometry/material; invisible material means no draw call).
 */
function SeatTargets() {
  const geometry = useMemo(() => new THREE.BoxGeometry(0.5, 0.5, 0.55), [])
  const hidden = useMemo(() => new THREE.MeshBasicMaterial({ visible: false }), [])
  useEffect(() => () => {
    geometry.dispose()
    hidden.dispose()
  }, [geometry, hidden])
  return (
    <>
      {SEAT_SPOTS.map((s) => (
        <Seat key={s.id} id={`ac-seat-${s.id}`} position={s.sit} interactionText="座る">
          <mesh geometry={geometry} material={hidden} position={[0, 0.12, 0.08]} />
        </Seat>
      ))}
    </>
  )
}

interface ProjectorProps {
  meshes: THREE.Mesh[]
  lens: THREE.Mesh | null
  material: InstancesProps['material']
}

/**
 * The film projector (from Blender). Touching it cycles this viewer's ambient strength
 * (標準 → 強 → 弱 → 切). The lens glows with the picture's average colour. It never dissolves:
 * it sits behind the audience and is the switch people look for during a show.
 */
function Projector({ meshes, lens, material }: ProjectorProps) {
  const { engine, levelIndex, cycleLevel } = useAmbient()
  const lensMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#111', toneMapped: false }), [])
  useEffect(() => () => lensMat.dispose(), [lensMat])
  useFrame(() => {
    const k = engine.uniforms.uActive.value * engine.uniforms.uLevel.value
    lensMat.color.copy(engine.colors.whole).multiplyScalar(3 * k).addScalar(0.04)
  })
  return (
    <Interactable
      id="ambient-cinema-projector"
      onInteract={cycleLevel}
      interactionText={`光の演出：${LEVELS[levelIndex].label}（自分の見え方だけ切り替え）`}
    >
      <group>
        {meshes.map((m) => (
          <mesh key={m.name} geometry={m.geometry} material={material(m.material, true)} />
        ))}
        {lens && <mesh geometry={lens.geometry} material={lensMat} />}
      </group>
    </Interactable>
  )
}

