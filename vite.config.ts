import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Build id: commit + build time, so a running page can tell whether a newer deploy exists. */
const buildId = (() => {
  let sha = 'dev'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    // not a git checkout
  }
  return `${sha}.${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
})()

/** Writes dist/version.json; the app polls it (served no-cache) and offers a reload when it changes. */
const versionFile = (): Plugin => ({
  name: 'version-file',
  apply: 'build',
  closeBundle() {
    mkdirSync('dist', { recursive: true })
    writeFileSync('dist/version.json', JSON.stringify({ build: buildId, at: new Date().toISOString() }))
  },
})

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
})
