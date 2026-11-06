// Render design/blueprints/*.svg to PNG (for review and the design board).
import { chromium } from 'playwright'
import { readdirSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = join(import.meta.dirname, '..', 'design', 'blueprints')
const out = join(dir, 'png')
mkdirSync(out, { recursive: true })
const exe = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
for (const f of readdirSync(dir).filter((n) => n.endsWith('.svg'))) {
  const svg = readFileSync(join(dir, f), 'utf8')
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
  await page.setViewportSize({ width: Number(m[1]), height: Number(m[2]) })
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`)
  await page.screenshot({ path: join(out, f.replace('.svg', '.png')) })
  console.log(f)
}
await browser.close()
