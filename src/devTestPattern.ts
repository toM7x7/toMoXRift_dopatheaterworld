/**
 * Dev only: a colourful animated test picture delivered as a MediaStream, the same kind of
 * source a real screen share gives (<video srcObject=stream>). No camera/screen permission.
 */

type Draw = (ctx: CanvasRenderingContext2D, t: number, w: number, h: number) => void

const scenes: { name: string; draw: Draw }[] = [
  {
    name: '夕焼け',
    draw(ctx, t, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#2a0f4a')
      g.addColorStop(0.45, '#d4462c')
      g.addColorStop(0.62, '#ffb347')
      g.addColorStop(0.63, '#3a1630')
      g.addColorStop(1, '#120612')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      const x = w * (0.2 + 0.6 * ((t * 0.05) % 1))
      const sun = ctx.createRadialGradient(x, h * 0.58, 4, x, h * 0.58, 90)
      sun.addColorStop(0, '#fff6c8')
      sun.addColorStop(0.3, '#ffd36b')
      sun.addColorStop(1, 'rgba(255,140,60,0)')
      ctx.fillStyle = sun
      ctx.fillRect(0, 0, w, h * 0.63)
    },
  },
  {
    name: '海',
    draw(ctx, t, w, h) {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#7fd6ff')
      g.addColorStop(0.4, '#1d8fd0')
      g.addColorStop(1, '#03294d')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 9; i++) {
        const y = h * (0.42 + i * 0.065)
        ctx.strokeStyle = `rgba(200,250,255,${0.35 - i * 0.03})`
        ctx.lineWidth = 3
        ctx.beginPath()
        for (let x = 0; x <= w; x += 16) {
          const yy = y + Math.sin(x * 0.03 + t * 1.6 + i) * 5
          if (x === 0) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.stroke()
      }
    },
  },
  {
    name: '左右で色違い',
    draw(ctx, t, w, h) {
      ctx.fillStyle = '#c4122e'
      ctx.fillRect(0, 0, w / 2, h)
      ctx.fillStyle = '#0fae6a'
      ctx.fillRect(w / 2, 0, w / 2, h)
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2)
      ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.6 * pulse})`
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, 40 + 30 * pulse, 0, Math.PI * 2)
      ctx.fill()
    },
  },
  {
    name: 'ネオン',
    draw(ctx, t, w, h) {
      ctx.fillStyle = '#07040f'
      ctx.fillRect(0, 0, w, h)
      const blobs = [
        { c: '255,40,200', x: 0.25 + 0.15 * Math.sin(t * 0.7), y: 0.4 + 0.2 * Math.cos(t * 0.5) },
        { c: '40,220,255', x: 0.72 + 0.12 * Math.cos(t * 0.6), y: 0.55 + 0.2 * Math.sin(t * 0.8) },
        { c: '255,200,40', x: 0.5 + 0.3 * Math.sin(t * 0.3), y: 0.85 },
      ]
      for (const b of blobs) {
        const g = ctx.createRadialGradient(b.x * w, b.y * h, 4, b.x * w, b.y * h, 170)
        g.addColorStop(0, `rgba(${b.c},1)`)
        g.addColorStop(1, `rgba(${b.c},0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
    },
  },
  {
    name: '森',
    draw(ctx, t, w, h) {
      const g = ctx.createLinearGradient(0, 0, w, h)
      g.addColorStop(0, '#0d3b1e')
      g.addColorStop(0.5, '#2e7d32')
      g.addColorStop(1, '#0a2612')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      for (let i = 0; i < 5; i++) {
        const x = w * (0.15 + i * 0.18) + Math.sin(t * 0.4 + i) * 12
        ctx.fillStyle = 'rgba(255,240,150,0.18)'
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x + 40, 0)
        ctx.lineTo(x + 120, h)
        ctx.lineTo(x + 40, h)
        ctx.fill()
      }
    },
  },
]

export const TEST_SCENE_NAMES = scenes.map((s) => s.name)

export interface TestPattern {
  video: HTMLVideoElement
  stop: () => void
  /** Stall the stream (no new frames, track stays live), like a stuck live stream. */
  freeze?: (on: boolean) => void
}

/** @param hold scene index to hold, or -1 to cycle every `period` seconds. */
export function startTestPattern(hold = -1, period = 5, label = true): TestPattern {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')!
  const t0 = performance.now()
  let raf = 0
  let frozen = false
  const frame = () => {
    if (frozen) {
      raf = requestAnimationFrame(frame)
      return
    }
    const t = (performance.now() - t0) / 1000
    const w = canvas.width
    const h = canvas.height
    if (hold >= 0) {
      scenes[hold % scenes.length].draw(ctx, t, w, h)
    } else {
      const n = Math.floor(t / period)
      const local = t - n * period
      scenes[n % scenes.length].draw(ctx, t, w, h)
      const blend = Math.max(0, (local - (period - 0.8)) / 0.8)
      if (blend > 0) {
        ctx.save()
        ctx.globalAlpha = blend
        scenes[(n + 1) % scenes.length].draw(ctx, t, w, h)
        ctx.restore()
      }
    }
    if (label) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = '600 16px sans-serif'
      ctx.fillText('AMBIENT TEST', 14, h - 14)
    }
    raf = requestAnimationFrame(frame)
  }
  frame()
  const stream = canvas.captureStream(30)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  video.play().catch(() => undefined)
  return {
    video,
    stop: () => {
      cancelAnimationFrame(raf)
      stream.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    },
    freeze: (on) => {
      frozen = on
    },
  }
}

/** A local video file (loops, with sound). */
export function startFileVideo(src: string): TestPattern {
  const video = document.createElement('video')
  video.src = src
  video.loop = true
  video.playsInline = true
  video.crossOrigin = 'anonymous'
  video.play().catch(() => {
    video.muted = true
    video.play().catch(() => undefined)
  })
  return {
    video,
    stop: () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    },
  }
}
