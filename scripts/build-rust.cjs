const childProcess = require('child_process')
const path = require('path')

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    shell: false,
  })

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status)
  }

  if (result.error) {
    // Common when `bash` isn't installed / on PATH.
    console.error('[build:rust] Failed to run command:', result.error.message)
    process.exit(1)
  }
}

const platform = process.platform

if (platform === 'win32') {
  console.log('[build:rust] Building native binaries for Windows...')
  run('bash', ['./build-binaries.sh', '--windows'])
} else if (platform === 'darwin') {
  console.log('[build:rust] Building native binaries for macOS...')
  run('bash', ['./build-binaries.sh', '--mac'])
} else {
  console.error(
    `[build:rust] Unsupported platform: ${platform}. Use \`bun run build:rust:mac\` or \`bun run build:rust:win\` explicitly.`,
  )
  process.exit(1)
}

