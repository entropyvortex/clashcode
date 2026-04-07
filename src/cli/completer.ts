/**
 * Tab-completion for slash commands and their subcommands.
 *
 * v1.3: Synced with the full command registry in commands.ts.
 * If you add a command there, add it here too.
 *
 * @module cli/completer
 */

/** Top-level slash commands — must stay in sync with COMMAND_REGISTRY in commands.ts. */
const COMMANDS = [
  '/help',
  '/config',
  '/config set',
  '/model',
  '/session',
  '/session new',
  '/session delete',
  '/team',
  '/team on',
  '/team off',
  '/agent',
  '/agent add',
  '/agent remove',
  '/consensus',
  '/convergence',
  '/coherence',
  '/debate',
  '/debates',
  '/perspectives',
  '/diagnostics',
  '/diagnostics on',
  '/diagnostics off',
  '/sandbox',
  '/sandbox auto',
  '/sandbox docker',
  '/sandbox shuru',
  '/sandbox local',
  '/keychain',
  '/keychain set',
  '/keychain delete',
  '/doctor',
  '/clear',
  '/exit',
  '/quit',
]

/** Known agent names for /agent add|remove. */
const AGENT_NAMES = ['coder', 'reviewer', 'consensus']

/** Known config keys for /config set. */
const CONFIG_KEYS = [
  'model',
  'provider',
  'baseUrl',
  'teamMode',
  'maxConcurrency',
  'diagnostics',
  'coordinatorModel',
  'cacheWorkerOutputs',
  'sandbox.enabled',
  'sandbox.backend',
  'sandbox.persistent',
  'sandbox.image',
]

/**
 * Readline completer function.
 *
 * @param line - Current input line
 * @returns [completions, partial] tuple
 */
export function completer(line: string): [string[], string] {
  const trimmed = line.trimStart()

  // Not a slash command — no completions
  if (!trimmed.startsWith('/')) {
    return [[], line]
  }

  const parts = trimmed.split(/\s+/)

  // Completing the command itself: /he → /help
  if (parts.length === 1) {
    const partial = parts[0]!
    const hits = COMMANDS.filter((c) => c.startsWith(partial) && !c.includes(' '))
    return [hits.length > 0 ? hits : [], partial]
  }

  const cmd = parts[0]!.toLowerCase()
  const sub = parts[1] ?? ''

  // /config set <key>
  if (cmd === '/config' && parts.length === 2) {
    const hits = ['set'].filter((s) => s.startsWith(sub))
    return [hits.map((h) => `/config ${h}`), trimmed]
  }
  if (cmd === '/config' && parts[1] === 'set' && parts.length === 3) {
    const partial = parts[2] ?? ''
    const hits = CONFIG_KEYS.filter((k) => k.startsWith(partial))
    return [hits.map((h) => `/config set ${h}`), trimmed]
  }

  // /team on|off
  if (cmd === '/team' && parts.length === 2) {
    const hits = ['on', 'off'].filter((s) => s.startsWith(sub))
    return [hits.map((h) => `/team ${h}`), trimmed]
  }

  // /agent add|remove <name>
  if (cmd === '/agent' && parts.length === 2) {
    const hits = ['add', 'remove'].filter((s) => s.startsWith(sub))
    return [hits.map((h) => `/agent ${h}`), trimmed]
  }
  if (cmd === '/agent' && (parts[1] === 'add' || parts[1] === 'remove') && parts.length === 3) {
    const partial = parts[2] ?? ''
    const hits = AGENT_NAMES.filter((n) => n.startsWith(partial))
    return [hits.map((h) => `/agent ${parts[1]} ${h}`), trimmed]
  }

  // /session new|delete
  if (cmd === '/session' && parts.length === 2) {
    const hits = ['new', 'delete'].filter((s) => s.startsWith(sub))
    return [hits.map((h) => `/session ${h}`), trimmed]
  }

  // /diagnostics on|off
  if (cmd === '/diagnostics' && parts.length === 2) {
    const hits = ['on', 'off'].filter((s) => s.startsWith(sub))
    return [hits.map((h) => `/diagnostics ${h}`), trimmed]
  }

  // /sandbox backend
  if (cmd === '/sandbox' && parts.length === 2) {
    const hits = ['auto', 'docker', 'shuru', 'local'].filter((s) => s.startsWith(sub))
    return [hits.map((h) => `/sandbox ${h}`), trimmed]
  }

  // /keychain set|delete
  if (cmd === '/keychain' && parts.length === 2) {
    const hits = ['set', 'delete'].filter((s) => s.startsWith(sub))
    return [hits.map((h) => `/keychain ${h}`), trimmed]
  }

  // /model — completed by model discovery at runtime, not here
  return [[], line]
}
