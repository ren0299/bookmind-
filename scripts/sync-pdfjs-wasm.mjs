import { cpSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'node_modules', 'pdfjs-dist', 'wasm')
const target = path.join(root, 'public', 'wasm')

if (!existsSync(source)) {
  console.warn('[sync-pdfjs-wasm] pdfjs-dist wasm folder not found, skipping')
  process.exit(0)
}

mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
console.log('[sync-pdfjs-wasm] copied wasm assets to public/wasm')
