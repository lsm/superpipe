// Shared environment stamp: node version, CPU model, commit SHA. Every
// benchmark prints it so saved results stay attributable to a machine,
// runtime, and commit.
import { execSync } from 'node:child_process'
import os from 'node:os'
import process from 'node:process'

export function env() {
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    sha = 'unknown'
  }
  return { node: process.version, cpu: os.cpus()[0]?.model ?? 'unknown', sha }
}

export function envLine() {
  const e = env()
  return `env: ${e.node} · ${e.cpu} · ${e.sha}`
}
