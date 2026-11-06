import { useFrame, useThree } from '@react-three/fiber'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AmbientEngine, DEFAULT_SETTINGS, type AmbientSettings } from './engine'

/** Per-viewer strength, switched at the projector. Never synced: comfort is personal. */
export const LEVELS = [
  { label: '標準', value: 1 },
  { label: '強', value: 1.6 },
  { label: '弱', value: 0.45 },
  { label: '切', value: 0 },
] as const

interface AmbientApi {
  engine: AmbientEngine
  levelIndex: number
  cycleLevel: () => void
}

const AmbientContext = createContext<AmbientApi | null>(null)

export function useAmbient(): AmbientApi {
  const api = useContext(AmbientContext)
  if (!api) throw new Error('useAmbient must be used inside <AmbientProvider>')
  return api
}

interface Props {
  settings?: Partial<AmbientSettings>
  children: ReactNode
}

export function AmbientProvider({ settings, children }: Props) {
  const gl = useThree((s) => s.gl)
  const [engine] = useState(() => new AmbientEngine())
  const [levelIndex, setLevelIndex] = useState(0)

  // Render targets are created lazily on the first tick, so a StrictMode remount just rebuilds them.
  useEffect(() => () => engine.dispose(), [engine])
  useEffect(() => {
    engine.settings = { ...DEFAULT_SETTINGS, ...settings }
  }, [engine, settings])
  useEffect(() => {
    engine.uniforms.uLevel.value = LEVELS[levelIndex].value
  }, [engine, levelIndex])

  // Negative priority: runs before everything else and does not take over rendering.
  useFrame((state, dt) => engine.tick(gl, Math.min(dt, 0.1), state.clock.elapsedTime), -10)

  const cycleLevel = useCallback(() => setLevelIndex((i) => (i + 1) % LEVELS.length), [])
  const api = useMemo(() => ({ engine, levelIndex, cycleLevel }), [engine, levelIndex, cycleLevel])
  return <AmbientContext.Provider value={api}>{children}</AmbientContext.Provider>
}
