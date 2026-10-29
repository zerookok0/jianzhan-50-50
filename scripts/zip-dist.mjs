/**
 * Packs dist/ into site.zip without any external dependency.
 * The WebContainer shell has no `zip` binary, so we write the ZIP
 * container directly with Node's zlib.
 *
 * Usage: node scripts/zip-dist.mjs
 * Output: ./site.zip  (dist contents at the archive root)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'site.zip')

if (!existsSync(DIST)) {
  console.error('dist/ does not exist — run `npm run build` first.')
  process.exit(1)
}

/* ---------------- CRC-32 ---------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

/* ---------------- Walk dist ---------------- */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

const files = walk(DIST).sort()

/* ---------------- Guards ----------------
 * An "empty shell" archive (0–1 byte site.zip) is worse than no archive at
 * all: it looks produced but unpacks to nothing. Refuse to write one.
 */
if (files.length === 0) {
  console.error('dist/ is empty — nothing to package. Run `npm run build` first.')
  process.exit(1)
}

const hasIndex = files.some((f) => relative(DIST, f).split(sep).join('/') === 'index.html')
if (!hasIndex) {
  console.error('dist/index.html is missing — the build did not complete. Run `npm run build`.')
  process.exit(1)
}

const locals = []
const centrals = []
let offset = 0

for (const file of files) {
  const name = relative(DIST, file).split(sep).join('/')
  const data = readFileSync(file)
  const deflated = deflateRawSync(data, { level: 9 })
  // Only keep deflate when it actually saves space.
  const useDeflate = deflated.length < data.length
  const payload = useDeflate ? deflated : data
  const method = useDeflate ? 8 : 0
  const crc = crc32(data)
  const { time, day } = dosDateTime(statSync(file).mtime)

  const nameBuf = Buffer.from(name, 'utf8')

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0) // signature
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0x0800, 6) // UTF-8 filename flag
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(time, 10)
  local.writeUInt16LE(day, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)

  locals.push(local, nameBuf, payload)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0) // signature
  central.writeUInt16LE(20, 4) // version made by
  central.writeUInt16LE(20, 6) // version needed
  central.writeUInt16LE(0x0800, 8) // UTF-8 flag
  central.writeUInt16LE(method, 10)
  central.writeUInt16LE(time, 12)
  central.writeUInt16LE(day, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt16LE(0, 30) // extra
  central.writeUInt16LE(0, 32) // comment
  central.writeUInt16LE(0, 34) // disk start
  central.writeUInt16LE(0, 36) // internal attrs
  central.writeUInt32LE(0o644 << 16, 38) // external attrs (unix perms)
  central.writeUInt32LE(offset, 42)

  centrals.push(central, nameBuf)
  offset += local.length + nameBuf.length + payload.length
}

const centralBuf = Buffer.concat(centrals)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(files.length, 8)
eocd.writeUInt16LE(files.length, 10)
eocd.writeUInt32LE(centralBuf.length, 12)
eocd.writeUInt32LE(offset, 16)
eocd.writeUInt16LE(0, 20)

const zip = Buffer.concat([...locals, centralBuf, eocd])

if (zip.length < 1024) {
  console.error(`Refusing to write site.zip: archive is only ${zip.length} bytes.`)
  process.exit(1)
}

writeFileSync(OUT, zip)

console.log(`Created ${relative(ROOT, OUT)}`)
console.log(`  ${files.length} files, ${(zip.length / 1024).toFixed(1)} kB`)
files.forEach((f) => console.log(`  + ${relative(DIST, f).split(sep).join('/')}`))
