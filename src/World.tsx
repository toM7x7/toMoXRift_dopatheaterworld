import { SpawnPoint } from '@xrift/world-components'
import { Suspense, type ReactNode } from 'react'
import { AmbientProvider } from './ambient/context'
import type { AmbientSettings } from './ambient/engine'
import { CinemaScreen } from './CinemaScreen'
import { AudienceLights, BeamDust, Halo, ProjectorBeam } from './Effects'
import { SPAWN } from './layout'
import { Room } from './Room'

interface Props {
  /** Overrides for tuning (dev panel); production uses the defaults. */
  settings?: Partial<AmbientSettings>
  /** Dev: skip the SpawnPoint so a pinned camera / dev spawn is not overridden. */
  spawn?: boolean
  children?: ReactNode
}

export function World({ settings, spawn = true, children }: Props) {
  return (
    <AmbientProvider settings={settings}>
      {spawn && <SpawnPoint position={SPAWN} yaw={0} />}
      <color attach="background" args={['#000000']} />
      <Suspense fallback={null}>
        <Room />
      </Suspense>
      <CinemaScreen />
      <Halo />
      <ProjectorBeam />
      <BeamDust />
      <AudienceLights />
      {children}
    </AmbientProvider>
  )
}
