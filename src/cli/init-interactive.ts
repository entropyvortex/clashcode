/**
 * Interactive first-run wizard for `clashcode init --interactive`.
 *
 * Walks the user through:
 *  1. Picking a provider (grok / openai / anthropic / gemini / copilot)
 *  2. Picking a model
 *  3. Providing an API key (stored in keychain if available, else env
 *     hint, else settings.json fallback)
 *  4. Choosing a sandbox backend (auto / docker / shuru / local)
 *  5. Team mode on/off
 *
 * Writes the result to `.clashcode/settings.json` + keychain, then
 * runs `/doctor`-style verification so the user sees a ready/not-ready
 * status before the first run.
 *
 * @module cli/init-interactive
 */

import { createInterface } from 'node:readline'
import { c, success, error, dim } from './ui.js'
import { DEFAULT_SETTINGS, saveSettings, type Settings } from '../config/index.js'
import { keychain } from '../config/keychain.js'
import { runDoctor, formatDoctorReport } from './doctor.js'

type Provider = Settings['provider']

const PROVIDER_CHOICES: Array<{
  id: Provider
  label: string
  envVar: string
  defaultModel: string
}> = [
  { id: 'grok', label: 'xAI Grok', envVar: 'XAI_API_KEY', defaultModel: 'grok-4' },
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', defaultModel: 'gpt-4o' },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    envVar: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-4-6',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-pro',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    envVar: 'COPILOT_API_KEY',
    defaultModel: 'claude-sonnet-4.5',
  },
]

type SandboxBackend = 'auto' | 'docker' | 'shuru' | 'local'

const BACKEND_CHOICES: Array<{ id: SandboxBackend; label: string; note: string }> = [
  { id: 'auto', label: 'auto', note: 'Pick the best backend for this host (recommended)' },
  { id: 'shuru', label: 'shuru', note: 'microVM isolation (macOS/Apple Silicon only)' },
  { id: 'docker', label: 'docker', note: 'Linux container (requires Docker)' },
  { id: 'local', label: 'local', note: 'No isolation — dev only' },
]

function ask(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve))
}

async function askChoice<T>(
  rl: ReturnType<typeof createInterface>,
  title: string,
  choices: ReadonlyArray<{ label: string; note?: string; value: T }>,
  defaultIndex = 0,
): Promise<T> {
  process.stdout.write(`\n${c.bold}${title}${c.reset}\n`)
  choices.forEach((ch, i) => {
    const marker = i === defaultIndex ? `${c.cyan}▸${c.reset}` : ' '
    const note = ch.note ? ` ${dim(ch.note)}` : ''
    process.stdout.write(`  ${marker} ${i + 1}. ${c.bold}${ch.label}${c.reset}${note}\n`)
  })
  const raw = await ask(
    rl,
    `\n${c.cyan}Choose [1-${choices.length}, default ${defaultIndex + 1}]: ${c.reset}`,
  )
  const n = Number.parseInt(raw.trim(), 10)
  const idx = Number.isFinite(n) && n >= 1 && n <= choices.length ? n - 1 : defaultIndex
  return choices[idx]!.value
}

async function askYesNo(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultYes = true,
): Promise<boolean> {
  const suffix = defaultYes ? 'Y/n' : 'y/N'
  const raw = (await ask(rl, `${c.cyan}${prompt} [${suffix}]: ${c.reset}`)).trim().toLowerCase()
  if (!raw) return defaultYes
  return raw === 'y' || raw === 'yes'
}

async function askHidden(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
  // Node's readline doesn't hide input natively. We mute stdout by
  // overriding the mutable output stream's write temporarily.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mutableRl = rl as any
  const orig = mutableRl._writeToOutput
  mutableRl._writeToOutput = (s: string) => {
    // Echo only the prompt itself; mask everything the user types
    if (s.includes(prompt)) mutableRl.output.write(s)
    else if (s === '\n' || s === '\r\n') mutableRl.output.write(s)
    else mutableRl.output.write('*')
  }
  const value = await ask(rl, `${c.cyan}${prompt}${c.reset}`)
  mutableRl._writeToOutput = orig
  process.stdout.write('\n')
  return value.trim()
}

/** Run the interactive wizard. Returns the settings written. */
export async function runInteractiveInit(projectRoot: string): Promise<Settings> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })

  process.stdout.write(`${c.bold}${c.cyan}ClashCode${c.reset} — interactive setup\n\n`)
  process.stdout.write(dim('Press Ctrl+C at any time to abort.\n'))

  try {
    // ── 1. Provider ──
    const provider = await askChoice(
      rl,
      'Which LLM provider?',
      PROVIDER_CHOICES.map((p) => ({ label: p.label, value: p })),
      0,
    )

    // ── 2. Model (free-form, default from provider) ──
    const modelRaw = await ask(
      rl,
      `\n${c.cyan}Model name [${c.bold}${provider.defaultModel}${c.reset}${c.cyan}]: ${c.reset}`,
    )
    const model = modelRaw.trim() || provider.defaultModel

    // ── 3. API key ──
    process.stdout.write(
      `\n${dim(`An API key is needed for ${provider.label}.`)}\n` +
        `${dim(`You can also set the ${c.cyan}${provider.envVar}${c.reset}${dim} env var and skip this.`)}\n\n`,
    )
    const apiKey = await askHidden(rl, `API key (or blank to skip): `)

    // ── 4. Where to store the key ──
    let storedInKeychain = false
    if (apiKey) {
      if (await keychain.isAvailable()) {
        const useChain = await askYesNo(rl, 'Store in OS keychain?', true)
        if (useChain) {
          storedInKeychain = await keychain.set(provider.id, apiKey)
          if (storedInKeychain) {
            process.stdout.write(
              success(`Stored in keychain as ${c.cyan}${provider.id}${c.reset}.\n`),
            )
          } else {
            process.stdout.write(error('Keychain write failed — falling back to settings.json.\n'))
          }
        }
      } else {
        process.stdout.write(
          dim(
            '  (keychain unavailable — install `keytar` for native storage. Falling back to settings.json.)\n',
          ),
        )
      }
    }

    // ── 5. Sandbox backend ──
    const backend = await askChoice(
      rl,
      'Sandbox backend?',
      BACKEND_CHOICES.map((b) => ({ label: b.label, note: b.note, value: b.id })),
      0,
    )

    // ── 6. Team mode ──
    const teamMode = await askYesNo(
      rl,
      '\nEnable multi-agent team mode? (coder+reviewer+consensus)',
      true,
    )

    // ── Assemble + save ──
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      provider: provider.id,
      model,
      teamMode,
      sandbox: {
        ...DEFAULT_SETTINGS.sandbox,
        backend,
        shuru: { ...DEFAULT_SETTINGS.sandbox.shuru },
      },
      apiKeys: storedInKeychain || !apiKey ? {} : { [provider.id]: apiKey },
    }
    saveSettings(projectRoot, settings)

    process.stdout.write(`\n${success('Settings written to .clashcode/settings.json.')}\n\n`)

    // ── 7. Doctor ──
    process.stdout.write(`${c.bold}Running diagnostic check...${c.reset}\n`)
    const checks = await runDoctor(settings)
    process.stdout.write('\n' + formatDoctorReport(checks) + '\n\n')

    process.stdout.write(
      `${dim('Next:')} run ${c.cyan}clashcode${c.reset} to start your first session.\n`,
    )
    process.stdout.write(
      `${dim('Docs:')} ${c.cyan}docs/sandbox.md${c.reset}, ${c.cyan}README.md${c.reset}\n\n`,
    )

    return settings
  } finally {
    rl.close()
  }
}
