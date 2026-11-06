// Sit in a seat through the SDK, report the camera position, draw calls and frame time.
import { chromium } from 'playwright'
import { join } from 'node:path'
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:5290/?nopanel&clean&play=1&scene=0&nofakes')
await page.waitForFunction(() => window.__ambient?.engine?.frames > 30, null, { timeout: 60000 })
await page.waitForTimeout(1500)
const before = await page.evaluate(() => window.__ambient.pos())
await page.evaluate(() => window.__ambient.sit('ac-seat-r3-L3'))
await page.waitForTimeout(1500)
const r = await page.evaluate(async () => {
  const a = window.__ambient
  a.look(0, -4)
  const t = []
  let last = performance.now()
  await new Promise((res) => { let n = 0; const f = (now) => { t.push(now - last); last = now; if (++n < 120) requestAnimationFrame(f); else res() }; requestAnimationFrame(f) })
  t.sort((x, y) => x - y)
  return { pos: a.pos(), occupant: a.occupant('ac-seat-r3-L3'), info: a.info(), medianFrameMs: t[60].toFixed(2), p90: t[108].toFixed(2) }
})
await page.waitForTimeout(500)
await page.evaluate(() => {
  for (const el of document.querySelectorAll('body div')) {
    if (el.querySelector('canvas') || el.closest('canvas')) continue
    if (/マウスロック|ロック開始|移動|ジャンプ/.test(el.textContent ?? '')) el.style.display = 'none'
  }
})
await page.screenshot({ path: join(import.meta.dirname, '..', 'docs', 'screenshots', 'seated-view.png') })
console.log(JSON.stringify({ before, ...r }, null, 1))
console.log('errors:', errors.filter((e) => !/Pointer Lock|pointer lock/i.test(e)).slice(0, 6))
await browser.close()
