/**
 * Room and screen numbers in meters. -Z is the screen side, +Z the back.
 * The numbers live in design/layout.json, shared with the Blender build and the blueprints.
 *
 * Floor: flat front from the screen wall to RAKE_START, a straight rake up to RAKE_END,
 * then a flat back platform at RAKE_RISE. Seat bodies have no colliders so nobody gets
 * wedged between rows; each seat is a <Seat> you can sit in.
 */
import spec from '../design/layout.json'

export const ROOM = {
  halfWidth: spec.room.halfWidth,
  front: spec.room.front,
  back: spec.room.back,
  height: spec.room.height,
} as const

export const RAKE_START = spec.rake.start
export const RAKE_END = spec.rake.end
export const RAKE_RISE = spec.rake.rise
export const RAKE_SLOPE = RAKE_RISE / (RAKE_END - RAKE_START)
export const RAKE_ANGLE = Math.atan(RAKE_SLOPE)

/** Floor height at z (top surface). */
export function floorY(z: number): number {
  if (z <= RAKE_START) return 0
  if (z >= RAKE_END) return RAKE_RISE
  return (z - RAKE_START) * RAKE_SLOPE
}

/** Screen frame: the maximum area the picture can use (contain-fit inside). */
export const SCREEN = {
  center: spec.screen.center as [number, number, number],
  width: spec.screen.width,
  height: spec.screen.height,
} as const

/**
 * Film projector on a pedestal at the back platform. The lens sits above standing eye height,
 * close enough to reach (interaction range is about 3.5 m).
 */
export const PROJECTOR_BASE = spec.projector.base as [number, number, number]
export const LENS_HEIGHT = spec.projector.lensHeight
export const PROJECTOR: [number, number, number] = [
  PROJECTOR_BASE[0],
  PROJECTOR_BASE[1] + LENS_HEIGHT,
  PROJECTOR_BASE[2] - spec.projector.lensForward,
]

export const SPAWN = spec.spawn as [number, number, number]

/** Seat rows on the rake (z of the seat front edge). */
export const SEAT_ROWS = spec.seats.rows
export const SEATS_PER_SIDE = spec.seats.perSide
export const SEAT_PITCH = spec.seats.pitch
export const AISLE_HALF = spec.seats.aisleHalf

export interface SeatSpot {
  id: string
  /** Floor point under the seat centre (the seat model's origin). */
  floor: [number, number, number]
  /** Sitting point (top of the cushion), for <Seat>. */
  sit: [number, number, number]
}

/** Every seat, row by row from the front, left to right. */
export const SEAT_SPOTS: SeatSpot[] = SEAT_ROWS.flatMap((rowZ, row) => {
  const z = rowZ + spec.seats.rowDepthOffset
  const y = floorY(z)
  const out: SeatSpot[] = []
  for (const side of [-1, 1]) {
    for (let k = 0; k < SEATS_PER_SIDE; k++) {
      const x = side * (AISLE_HALF + spec.seats.firstOffset + k * SEAT_PITCH)
      out.push({
        id: `r${row + 1}-${side < 0 ? 'L' : 'R'}${k + 1}`,
        floor: [x, y, z],
        sit: [x, y + spec.seats.cushionTop, z - 0.02],
      })
    }
  }
  return out.sort((a, b) => a.floor[2] - b.floor[2] || a.floor[0] - b.floor[0])
})

/** Wood side panels on both ends of every half-row; yaw 0 faces +X, π faces -X. */
export const END_PANEL_SPOTS: { pos: [number, number, number]; yaw: number }[] = SEAT_ROWS.flatMap((rowZ) => {
  const z = rowZ + spec.seats.rowDepthOffset
  const y = floorY(z)
  const inner = AISLE_HALF + spec.seats.firstOffset - SEAT_PITCH / 2
  const outer = inner + SEATS_PER_SIDE * SEAT_PITCH
  return [
    { pos: [-outer, y, z] as [number, number, number], yaw: Math.PI },
    { pos: [-inner, y, z] as [number, number, number], yaw: 0 },
    { pos: [inner, y, z] as [number, number, number], yaw: Math.PI },
    { pos: [outer, y, z] as [number, number, number], yaw: 0 },
  ]
})

/** Shared armrests sit halfway between neighbouring seats, plus one at each row end. */
export const ARM_SPOTS: [number, number, number][] = SEAT_ROWS.flatMap((rowZ) => {
  const z = rowZ + spec.seats.rowDepthOffset
  const y = floorY(z)
  const out: [number, number, number][] = []
  for (const side of [-1, 1]) {
    for (let k = 0; k <= SEATS_PER_SIDE; k++) {
      out.push([side * (AISLE_HALF + spec.seats.firstOffset - SEAT_PITCH / 2 + k * SEAT_PITCH), y, z])
    }
  }
  return out
})
