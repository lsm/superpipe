// Shared environment stamp: node version, CPU model, commit SHA. Every
// benchmark prints it so saved results stay attributable to a machine,
// runtime, and commit.
import { execSync } from 'node:child_process'
import os from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// The stamp must describe the checkout this benchmark lives in, not whatever
// directory it was launched from.
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function env() {
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse --short HEAD', {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
    // The before/after workflow usually benches uncommitted executor changes;
    // a dirty marker keeps the second stamp from reusing the first's SHA.
    // status refreshes stat info first, so touched-but-unchanged files do
    // not flag a false dirty, and untracked files do not count (saved
    // baseline JSON lives here too).
    try {
      const status = execSync('git status --porcelain --untracked-files=no', {
        cwd: repoDir,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString()
      if (status.length > 0) sha = `${sha}-dirty`
    } catch {
      // dirty state unknowable; keep the plain SHA
    }
  } catch {
    sha = 'unknown'
  }
  return { node: process.version, cpu: os.cpus()[0]?.model ?? 'unknown', sha }
}

export function envLine() {
  const e = env()
  return `env: ${e.node} · ${e.cpu} · ${e.sha}`
}
