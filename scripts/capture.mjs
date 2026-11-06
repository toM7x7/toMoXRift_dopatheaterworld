// Capture local-preview screenshots with GPU Chrome (the hidden in-app pane throttles rendering).
// Usage: node scripts/capture.mjs [shotName ...]   (dev server must be running on 5290)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:5290/'
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots')
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')

// scene: 0 夕焼け / 1 海 / 2 左右で色違い / 3 ネオン / 4 森
const SHOTS = {
  'seat-sunset': { q: 'scene=0&cam=-0.7,2.0,3.2,0,3.3,-11' },
  'seat-ocean': { q: 'scene=1&cam=-0.7,2.0,3.2,0,3.3,-11' },
  'seat-split': { q: 'scene=2&cam=-0.7,2.0,3.2,0,3.3,-11' },
  'seat-neon': { q: 'scene=3&cam=-0.7,2.0,3.2,0,3.3,-11' },
  'back-ocean': { q: 'scene=1&cam=3.2,3.5,9.4,-0.5,2.6,-11' },
  'back-neon': { q: 'scene=3&cam=3.2,3.5,9.4,-0.5,2.6,-11' },
  'side-neon': { q: 'scene=3&cam=6.4,2.6,1.5,-1.5,3.0,-9' },
  'side-sunset': { q: 'scene=0&cam=6.4,2.6,1.5,-1.5,3.0,-9' },
  'close-seats': { q: 'scene=0&nofakes&cam=3.6,1.6,-0.6,1.2,0.9,3.5' },
  'projector': { q: 'scene=1&nofakes&cam=2.2,3.1,7.6,0,3.2,10.4' },
  'front-curtain': { q: 'scene=3&nofakes&cam=4.5,2.4,-6.5,7.4,2.6,-10.8' },
  'peak-mid': { q: 'scene=0&cam=-0.7,2.0,3.2,0,3.3,-11', hold: 0.45 },
  'peak-mid-side': { q: 'scene=3&nofakes&cam=6.4,2.6,1.5,-1.5,3.0,-9', hold: 0.5 },
  'peak-full': { q: 'scene=0&immerse=1&cam=-0.7,2.0,3.2,0,3.3,-11', wait: 11000 },
  'peak-side': { q: 'scene=3&immerse=1&nofakes&cam=6.4,2.6,1.5,-1.5,3.0,-9', wait: 11000 },
  'peak-back': { q: 'scene=1&immerse=1&cam=3.2,3.5,9.4,-0.5,2.6,-11', wait: 11000 },
  'idle-dust': { q: 'cam=-0.7,2.0,3.2,0,3.3,-11', idle: true },
  'thumb-neon': { q: 'scene=3&nofakes&cam=6.4,2.6,1.5,-1.5,3.0,-9' },
  'thumb-sunset': { q: 'scene=0&nofakes&cam=-0.7,2.0,3.2,0,3.3,-11' },
  // v6 thumbnail: one camera, the cinema with the picture on vs. dissolved during the show.
  'thumb-before': { q: 'scene=3&nofakes&immerse=-1&cam=6.4,2.6,1.5,-1.5,3.0,-9', wait: 4000 },
  'thumb-mid': { q: 'scene=3&nofakes&cam=6.4,2.6,1.5,-1.5,3.0,-9', hold: 0.5, wait: 4000 },
  'thumb-after': { q: 'scene=3&nofakes&immerse=1&cam=6.4,2.6,1.5,-1.5,3.0,-9', wait: 9000 },
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS)
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
for (const name of names) {
  const shot = SHOTS[name]
  if (!shot) { console.log('unknown shot', name); continue }
  await page.goto(`${BASE}?nopanel&clean${shot.idle ? '' : '&play=1'}&${shot.q}`)
  if (shot.idle) {
    await page.waitForFunction(() => !!window.__ambient, null, { timeout: 60000 })
    await page.waitForTimeout(2500)
  } else {
    await page.waitForFunction(() => window.__ambient?.engine?.frames > 30, null, { timeout: 60000 })
    if (shot.hold !== undefined) await page.evaluate((h) => { window.__ambient.engine.holdImmerse = h }, shot.hold)
    await page.waitForTimeout(shot.wait ?? 2500)
  }
  // DevEnvironment's own hints (pointer-lock banner, controls help, crosshair) are DOM overlays.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body div')) {
      if (el.querySelector('canvas') || el.closest('canvas')) continue
      if (/マウスロック|ロック開始|移動|ジャンプ/.test(el.textContent ?? '')) el.style.display = 'none'
      const r = el.getBoundingClientRect()
      if (!el.textContent && r.width > 0 && r.width <= 40 && r.height <= 40) el.style.display = 'none'
    }
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(name, JSON.stringify(await page.evaluate(() => ({ show: window.__ambient.engine.show, immerse: +window.__ambient.engine.uniforms.uImmerse.value.toFixed(2) }))))
}
console.log('errors:', errors.filter((e) => !/Pointer Lock|pointer lock/i.test(e)).slice(0, 8))
await browser.close()
