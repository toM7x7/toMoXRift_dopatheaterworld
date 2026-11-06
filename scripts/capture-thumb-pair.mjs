// Thumbnail source pair from one fixed camera in one page:
//   before = the cinema before the show (no share, house lights on)
//   after  = during the show (share on, room dissolved, dissolve pinned at 1)
// Usage: node scripts/capture-thumb-pair.mjs [label] [cam x,y,z,tx,ty,tz] [scene 0..4]
//   (dev server on 5290; writes docs/screenshots/thumbnail-source-{before,after}-<label>-DATE.png)
import { chromium } from 'playwright'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:5290/'
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots')
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const now = new Date()
const DATE = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const [label = 'back', cam = '2.4,3.6,9.8,-0.4,2.0,-11', scene = '3'] = process.argv.slice(2)

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(`${BASE}?nopanel&clean&nofakes&scene=${scene}&cam=${cam}`)
await page.waitForFunction(() => !!window.__ambient, null, { timeout: 60000 })
await page.waitForTimeout(3000)
const hideOverlays = () => page.evaluate(() => {
  for (const el of document.querySelectorAll('body div')) {
    if (el.querySelector('canvas') || el.closest('canvas')) continue
    if (/マウスロック|ロック開始|移動|ジャンプ/.test(el.textContent ?? '')) el.style.display = 'none'
    const r = el.getBoundingClientRect()
    if (!el.textContent && r.width > 0 && r.width <= 40 && r.height <= 40) el.style.display = 'none'
  }
})
await hideOverlays()
const shot = async (name) => {
  const path = join(OUT, `thumbnail-source-${name}-${label}-${DATE}.png`)
  await page.screenshot({ path })
  console.log(path)
}
await shot('before')
await page.evaluate(() => {
  window.__ambient.engine.holdImmerse = 1
  window.__ambient.share.start()
})
await page.waitForFunction(() => window.__ambient.engine.uniforms.uActive.value > 0.98, null, { timeout: 30000 })
await page.waitForTimeout(800)
await hideOverlays()
await shot('after')
await browser.close()
