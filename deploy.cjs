const { Client } = require('ssh2')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Read printer IP from .env
let host = ''
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  const match = envFile.match(/^VITE_PRINTER_HOST=(.+)$/m)
  if (match && match[1]) host = match[1].trim().replace(/^['"]|['"]$/g, '')
} catch {}

if (!host) {
  console.error('Error: VITE_PRINTER_HOST not set in .env')
  process.exit(1)
}

const dist = path.join(__dirname, 'dist')
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('Error: dist/index.html not found. Run the build first.')
  process.exit(1)
}

// Creality K2 Plus printers use universal credentials:
//   root / creality_2024
const PASSWORD = 'creality_2024'
const USER = 'root'
const TARGET = '/mnt/UDISK/k2dash'
const STAGING = `${TARGET}.deploying`
const BACKUP = `${TARGET}.previous`
const deploymentId = `${Date.now()}-${process.pid}`
const localArchive = path.join(os.tmpdir(), `k2dash-${deploymentId}.tar.gz`)
// Reuse one remote upload path so a failed transfer cannot litter the
// printer's storage with timestamped archives. Remote `cat` truncates it.
const remoteArchive = `${TARGET}.deploying.tar.gz`
let conn = new Client()

function createArchive() {
  return new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-czf', localArchive, '-C', dist, '.'], { stdio: 'inherit' })
    tar.on('error', reject)
    tar.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Local tar exited with code ${code}`))
    })
  })
}

function connect() {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      conn.off('ready', onReady)
      reject(error)
    }
    const onReady = () => {
      resolve()
    }
    conn.once('error', onError)
    conn.once('ready', onReady)
    conn.connect({
      host,
      username: USER,
      password: PASSWORD,
      readyTimeout: 15000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 3,
    })
  })
}

function disconnect() {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      conn.destroy()
      finish()
    }, 3000)
    conn.once('close', finish)
    conn.end()
  })
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)),
      timeoutMs,
    )
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

function uploadArchive() {
  return new Promise((resolve, reject) => {
    conn.exec(`cat > '${remoteArchive}'`, (execError, stream) => {
      if (execError) return reject(execError)

      let stderr = ''
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve()
      }

      stream.on('error', finish)
      stream.stderr.on('data', (data) => { stderr += data })
      stream.on('close', (code) => {
        if (code !== 0) finish(new Error(stderr.trim() || `Remote upload exited with code ${code}`))
      })
      fs.readFile(localArchive, (readError, archive) => {
        if (readError) return finish(readError)
        // K2 firmware has no SFTP subsystem. Ending the exec channel's
        // explicit stdin is the reliable way to make its BusyBox `cat`
        // observe EOF and close the remote file.
        // `finish` only means ssh2 accepted the bytes locally. The K2's
        // unusually slow SSH server needs a drain window before disconnect,
        // otherwise the tail of the archive is lost. Verification on the
        // next connection still prevents a truncated upload from activating.
        stream.stdin.once('finish', () => setTimeout(() => finish(), 5000))
        stream.stdin.end(archive)
      })
    })
  })
}

function execRemote(command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (execError, stream) => {
      if (execError) return reject(execError)
      let stdout = ''
      let stderr = ''
      stream.on('data', (data) => { stdout += data })
      stream.stderr.on('data', (data) => { stderr += data })
      stream.on('close', (code) => {
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(stderr.trim() || stdout.trim() || `Remote command exited with code ${code}`))
      })
    })
  })
}

async function deploy() {
  let connected = false
  try {
    console.log('Creating deployment archive...')
    await createArchive()

    await withTimeout(connect(), 20000, 'SSH connection')
    connected = true
    console.log(`Connected to ${host}, uploading archive...`)
    await withTimeout(uploadArchive(), 60000, 'Archive upload')

    // BusyBox's SSH server does not close the remote `cat` channel after
    // stdin EOF. Closing this upload-only session finalizes the file; a
    // fresh connection then performs verification and activation.
    await disconnect()
    connected = false
    conn = new Client()
    await withTimeout(connect(), 20000, 'SSH reconnection')
    connected = true

    console.log('Upload complete, verifying and activating...')
    const result = await withTimeout(execRemote(`
set -eu
TARGET='${TARGET}'
STAGING='${STAGING}'
BACKUP='${BACKUP}'
ARCHIVE='${remoteArchive}'
trap 'rm -f "$ARCHIVE"' EXIT

rm -rf "$STAGING"
mkdir -p "$STAGING"
tar -xzf "$ARCHIVE" -C "$STAGING"
test -s "$STAGING/index.html"

rm -rf "$BACKUP"
if [ -d "$TARGET" ]; then
  mv "$TARGET" "$BACKUP"
fi

if mv "$STAGING" "$TARGET"; then
  rm -rf "$BACKUP"
else
  if [ -d "$BACKUP" ]; then mv "$BACKUP" "$TARGET"; fi
  exit 1
fi

test -s "$TARGET/index.html"
echo DEPLOY_OK
`), 45000, 'Remote activation')

    if (result !== 'DEPLOY_OK') throw new Error(`Unexpected deployment response: ${result || '(empty)'}`)
    console.log(`Deployed and verified at ${host}${TARGET}`)
  } finally {
    if (connected) conn.end()
    try { fs.rmSync(localArchive, { force: true }) } catch {}
  }
}

deploy().catch((error) => {
  conn.destroy()
  console.error('Deploy failed:', error.message)
  process.exitCode = 1
})
