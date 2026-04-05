/**
 * Auto-create a baseline Shuru checkpoint for ClashCode.
 *
 * The first time we boot a Shuru sandbox, we want common tooling
 * (python3, git, curl, build-essential) preinstalled so agents don't
 * burn tokens apt-installing things every run. We create a checkpoint
 * once and all subsequent runs start from it — cold boots drop from
 * ~30s (full apt install) to ~1s.
 *
 * @module sandbox/backends/shuru-bootstrap
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Default checkpoint name ClashCode uses. */
export const DEFAULT_CHECKPOINT = 'clashcode-env'

/** Packages preinstalled into the checkpoint. Keep this lean. */
const BOOTSTRAP_PACKAGES = [
  'python3',
  'python3-pip',
  'git',
  'curl',
  'ca-certificates',
  'build-essential',
  'jq',
]

/** Check whether a named checkpoint already exists. */
export async function checkpointExists(name: string, shuruBin = 'shuru'): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(shuruBin, ['checkpoint', 'list'], { timeout: 5000 })
    // Output format is typically one checkpoint per line; we just scan for the name.
    return stdout.split('\n').some((line) => line.trim().split(/\s+/)[0] === name)
  } catch {
    return false
  }
}

/**
 * Create the baseline checkpoint if it doesn't already exist.
 * Returns `true` if a new checkpoint was created, `false` if one
 * already existed, or throws on failure.
 */
export async function ensureBootstrapCheckpoint(
  opts: {
    name?: string
    shuruBin?: string
    onProgress?: (msg: string) => void
  } = {},
): Promise<boolean> {
  const name = opts.name ?? DEFAULT_CHECKPOINT
  const shuruBin = opts.shuruBin ?? 'shuru'

  if (await checkpointExists(name, shuruBin)) {
    opts.onProgress?.(`checkpoint "${name}" already exists`)
    return false
  }

  opts.onProgress?.(`creating checkpoint "${name}" (first-time setup, ~30-60s)…`)

  const installCmd =
    'apt-get update -y && ' +
    `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${BOOTSTRAP_PACKAGES.join(' ')} && ` +
    'apt-get clean && rm -rf /var/lib/apt/lists/*'

  try {
    await execFileAsync(
      shuruBin,
      ['checkpoint', 'create', name, '--allow-net', '--', 'sh', '-c', installCmd],
      { timeout: 180_000, maxBuffer: 20 * 1024 * 1024 },
    )
    opts.onProgress?.(`checkpoint "${name}" ready`)
    return true
  } catch (err) {
    throw new Error(
      `Failed to create Shuru checkpoint "${name}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
