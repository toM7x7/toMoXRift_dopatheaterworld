// Timeline check of the share-driven dissolve with GPU Chrome (dev server on 5290).
// share on → dissolves after ~2 s → freeze (stall) 8 s → drop 1.5 s → stop → room comes back.
// Usage: node scripts/check-show.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:5290/'
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots')
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const CAM = 'cam=6.4,2.6,1.5,-1.5,3.0,-9'

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(`${BASE}?nopanel&clean&nofakes&scene=3&${CAM}`)
await page.waitForFunction(() => !!window.__ambient, null, { timeout: 60000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: join(OUT, 'show-0-idle.png') })

const state = () => page.evaluate(() => {
  const s = window.__ambient.engine.show
  const u = window.__ambient.engine.uniforms
  return {
    present: s.present, lit: s.lit, immersed: s.immersed, holding: window.__ambient.engine.holding,
    onAir: +s.onAir.toFixed(1), gap: +s.gap.toFixed(1), progress: +s.progress.toFixed(2),
    active: +u.uActive.value.toFixed(2),
  }
})
const t0 = Date.now()
const log = async (label) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5), label.padEnd(14), JSON.stringify(await state()))
const wait = (s) => page.waitForTimeout(s * 1000)
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) })

await page.evaluate(() => window.__ambient.share.start())
await log('start')
await wait(1.5); await log('delay')
await wait(2.5); await log('dissolving'); await shot('show-1-dissolving')
await wait(4); await log('dissolved'); await shot('show-2-dissolved')

await page.evaluate(() => window.__ambient.share.freeze(true))
for (let i = 0; i < 4; i++) { await wait(2); await log('frozen') }
await shot('show-3-frozen')
await page.evaluate(() => window.__ambient.share.freeze(false))

await page.evaluate(() => window.__ambient.share.drop(1.5))
await wait(0.7); await log('drop'); await shot('show-4-drop')
await wait(1.6); await log('back')
await wait(1); await log('back+1')

await page.evaluate(() => window.__ambient.share.stop())
await wait(1.5); await log('stopped')
await wait(2.0); await log('grace over')
await wait(1.0); await log('returning'); await shot('show-5-returning')
await wait(3.0); await log('returned'); await shot('show-6-returned')

// Level 切 keeps the room; back to 標準 dissolves again.
await page.evaluate(() => window.__ambient.share.start())
await wait(9); await log('restart')
// 標準 → 強 → 弱 → 切 (the level reaches the uniform on the next render).
for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__ambient.cycleLevel()); await wait(0.2) }
console.log('level', await page.evaluate(() => window.__ambient.engine.uniforms.uLevel.value))
await wait(3.5); await log('level off')

// The projector stays solid with everything else gone.
await page.goto(`${BASE}?nopanel&clean&nofakes&play=1&immerse=1&scene=1&cam=2.2,3.1,7.6,0,3.2,10.4`)
await page.waitForFunction(() => window.__ambient?.engine?.show.progress >= 1, null, { timeout: 60000 })
await wait(0.5)
await shot('show-7-projector')
console.log('errors:', errors.filter((e) => !/Pointer Lock|pointer lock/i.test(e)).slice(0, 8))
await browser.close()
