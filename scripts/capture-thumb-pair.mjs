// Thumbnail source pair: the same camera and (almost) the same video frame, captured with the
// dissolve pinned at 0 (the cinema) and 1 (during the show), a few frames apart.
// Usage: node scripts/capture-thumb-pair.mjs   (dev server on 5290)
import { chromium } from 'playwright'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:5290/'
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots')
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const now = new Date()
const DATE = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const Q = 'scene=3&nofakes&immerse=-1&cam=6.4,2.6,1.5,-1.5,3.0,-9'

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`${BASE}?nopanel&clean&play=1&${Q}`)
await page.waitForFunction(() => window.__ambient?.engine?.frames > 30, null, { timeout: 60000 })
await page.waitForTimeout(4000)
await page.evaluate(() => {
  for (const el of document.querySelectorAll('body div')) {
    if (el.querySelector('canvas') || el.closest('canvas')) continue
    if (/マウスロック|ロック開始|移動|ジャンプ/.test(el.textContent ?? '')) el.style.display = 'none'
    const r = el.getBoundingClientRect()
    if (!el.textContent && r.width > 0 && r.width <= 40 && r.height <= 40) el.style.display = 'none'
  }
})
for (const [name, hold] of [['before', 0], ['after', 1]]) {
  await page.evaluate((h) => { window.__ambient.engine.holdImmerse = h }, hold)
  await page.waitForTimeout(120)
  const path = join(OUT, `thumbnail-source-${name}-${DATE}.png`)
  await page.screenshot({ path })
  console.log(path)
}
await browser.close()
