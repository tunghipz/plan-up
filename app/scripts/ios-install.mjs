// Install the built iOS app on the iPhone plugged into this Mac, then launch it.
// Run `npm run ios:build` first (or use `npm run ios:device` for both).
// See design-docs/ios-app.md.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const IPA = new URL('../src-tauri/gen/apple/build/arm64/plan-up.ipa', import.meta.url).pathname
const BUNDLE_ID = 'com.planup.mobile'

if (!existsSync(IPA)) {
  console.error(`No build at ${IPA}. Run: npm run ios:build`)
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'plan-up-ios-'))
try {
  const listJson = join(work, 'devices.json')
  execFileSync('xcrun', ['devicectl', 'list', 'devices', '--json-output', listJson], { stdio: 'ignore' })
  const devices = JSON.parse(readFileSync(listJson, 'utf8')).result.devices
  const phone = devices.find(
    (d) =>
      d.hardwareProperties?.reality === 'physical' &&
      d.hardwareProperties?.platform === 'iOS' &&
      d.connectionProperties?.tunnelState !== 'unavailable'
  )
  if (!phone) {
    console.error('No iPhone connected. Plug it in, unlock it, tap "Trust" if asked, then retry.')
    process.exit(1)
  }
  const name = phone.deviceProperties?.name ?? phone.identifier
  console.log(`Installing on ${name}…`)
  execFileSync('unzip', ['-q', IPA, '-d', work])
  const app = join(work, 'Payload', 'plan-up.app')
  execFileSync('xcrun', ['devicectl', 'device', 'install', 'app', '--device', phone.identifier, app], {
    stdio: 'inherit',
  })
  console.log('Launching…')
  execFileSync(
    'xcrun',
    ['devicectl', 'device', 'process', 'launch', '--device', phone.identifier, BUNDLE_ID],
    { stdio: 'inherit' }
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
