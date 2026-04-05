/**
 * Lightweight telemetry — counters, histograms, event hooks.
 *
 * ClashCode records runtime metrics (tokens consumed, sandbox commands
 * executed, debate convergence scores, cache hit rates) through this
 * module. By default, metrics accumulate in-process and can be read
 * via {@link getMetrics}.
 *
 * For production, opt in to OpenTelemetry export by calling
 * {@link enableOtelExport} at startup. The `@opentelemetry/*` packages
 * are treated as optional peer dependencies — loaded via dynamic
 * import so users who don't need OTel pay zero install cost.
 *
 * Opt-in Sentry (crash + error reporting) works the same way — call
 * {@link enableSentry} at startup with a DSN.
 *
 * @module telemetry
 */

import { logger } from './logger.js'

// ── Counter / histogram primitives ────────────────────────────

export type MetricName =
  | 'tokens.input'
  | 'tokens.output'
  | 'llm.requests'
  | 'llm.retries'
  | 'llm.failures'
  | 'sandbox.exec'
  | 'sandbox.writeFile'
  | 'sandbox.readFile'
  | 'sandbox.start'
  | 'sandbox.destroy'
  | 'cache.hits'
  | 'cache.misses'
  | 'debate.runs'
  | 'debate.rounds'

interface MetricSnapshot {
  counters: Record<string, number>
  histograms: Record<string, { count: number; sum: number; min: number; max: number }>
}

const counters: Record<string, number> = {}
const histograms: Record<string, { count: number; sum: number; min: number; max: number }> = {}

/** Increment a named counter. Attributes are best-effort for the exporter. */
export function increment(name: MetricName, value = 1, _attrs: Record<string, string> = {}): void {
  counters[name] = (counters[name] ?? 0) + value
  otelCounter?.(name, value, _attrs)
}

/** Record a numeric observation in a histogram. */
export function observe(name: string, value: number, _attrs: Record<string, string> = {}): void {
  const h = histograms[name]
  if (!h) {
    histograms[name] = { count: 1, sum: value, min: value, max: value }
  } else {
    h.count++
    h.sum += value
    if (value < h.min) h.min = value
    if (value > h.max) h.max = value
  }
  otelHistogram?.(name, value, _attrs)
}

/** Snapshot of all accumulated metrics. */
export function getMetrics(): MetricSnapshot {
  return {
    counters: { ...counters },
    histograms: JSON.parse(JSON.stringify(histograms)) as MetricSnapshot['histograms'],
  }
}

/** Reset all counters and histograms. */
export function resetMetrics(): void {
  for (const k of Object.keys(counters)) delete counters[k]
  for (const k of Object.keys(histograms)) delete histograms[k]
}

/**
 * Format the current metrics as a human-readable text block. Used by
 * `/doctor` and `/diagnostics` to give users a quick overview.
 */
export function formatMetrics(): string {
  const lines: string[] = ['Counters:']
  const cEntries = Object.entries(counters).sort(([a], [b]) => a.localeCompare(b))
  for (const [k, v] of cEntries) lines.push(`  ${k.padEnd(24)} ${v}`)
  if (cEntries.length === 0) lines.push('  (none)')

  lines.push('Histograms:')
  const hEntries = Object.entries(histograms).sort(([a], [b]) => a.localeCompare(b))
  for (const [k, h] of hEntries) {
    const avg = h.count > 0 ? (h.sum / h.count).toFixed(2) : '0'
    lines.push(`  ${k.padEnd(24)} n=${h.count} avg=${avg} min=${h.min} max=${h.max}`)
  }
  if (hEntries.length === 0) lines.push('  (none)')

  return lines.join('\n')
}

// ── OpenTelemetry export (optional) ───────────────────────────

type OtelCounterFn = (name: string, value: number, attrs: Record<string, string>) => void
type OtelHistogramFn = (name: string, value: number, attrs: Record<string, string>) => void

let otelCounter: OtelCounterFn | null = null
let otelHistogram: OtelHistogramFn | null = null
let otelEnabled = false

export interface OtelOptions {
  /** OTLP exporter endpoint. Required. Example: `http://localhost:4317`. */
  endpoint: string
  /** Service name reported to the collector. Default: `clashcode`. */
  serviceName?: string
  /** Extra resource attributes. */
  attributes?: Record<string, string>
}

/**
 * Enable OTLP metrics export. The `@opentelemetry/*` packages are
 * loaded lazily — install them yourself if you want export:
 *   `pnpm add @opentelemetry/api @opentelemetry/sdk-metrics
 *            @opentelemetry/exporter-metrics-otlp-http`
 *
 * Returns true on successful wire-up, false otherwise. Safe to call
 * multiple times (subsequent calls are no-ops).
 */
export async function enableOtelExport(opts: OtelOptions): Promise<boolean> {
  if (otelEnabled) return true
  try {
    const apiPkg = '@opentelemetry/api'
    const sdkPkg = '@opentelemetry/sdk-metrics'
    const expPkg = '@opentelemetry/exporter-metrics-otlp-http'
    const [api, sdk, exp] = await Promise.all([
      import(/* @vite-ignore */ apiPkg),
      import(/* @vite-ignore */ sdkPkg),
      import(/* @vite-ignore */ expPkg),
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exporter = new (exp as any).OTLPMetricExporter({ url: opts.endpoint })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reader = new (sdk as any).PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 15_000,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new (sdk as any).MeterProvider({
      readers: [reader],
      resource: {
        attributes: {
          'service.name': opts.serviceName ?? 'clashcode',
          ...opts.attributes,
        },
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(api as any).metrics.setGlobalMeterProvider(provider)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meter = (api as any).metrics.getMeter('clashcode')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const counterInstruments: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const histogramInstruments: Record<string, any> = {}

    otelCounter = (name, value, attrs) => {
      let inst = counterInstruments[name]
      if (!inst) {
        inst = meter.createCounter(name)
        counterInstruments[name] = inst
      }
      inst.add(value, attrs)
    }
    otelHistogram = (name, value, attrs) => {
      let inst = histogramInstruments[name]
      if (!inst) {
        inst = meter.createHistogram(name)
        histogramInstruments[name] = inst
      }
      inst.record(value, attrs)
    }
    otelEnabled = true
    logger.info(`telemetry: OTel export enabled → ${opts.endpoint}`)
    return true
  } catch (err) {
    logger.warn(
      `telemetry: could not enable OTel export (install @opentelemetry/api, sdk-metrics, exporter-metrics-otlp-http): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return false
  }
}

// ── Sentry (optional) ─────────────────────────────────────────

let sentryEnabled = false

export interface SentryOptions {
  dsn: string
  environment?: string
  release?: string
  /** Send rate (0-1) for crashes + errors. Default 1.0 (everything). */
  sampleRate?: number
}

/**
 * Enable Sentry crash + error reporting. `@sentry/node` is loaded
 * lazily — install it yourself:
 *   `pnpm add @sentry/node`
 *
 * Safe to call multiple times. Returns true on wire-up success.
 */
export async function enableSentry(opts: SentryOptions): Promise<boolean> {
  if (sentryEnabled) return true
  try {
    const pkg = '@sentry/node'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry = (await import(/* @vite-ignore */ pkg)) as any
    Sentry.init({
      dsn: opts.dsn,
      environment: opts.environment ?? 'production',
      release: opts.release,
      sampleRate: opts.sampleRate ?? 1.0,
      tracesSampleRate: 0, // metrics only, no APM
    })
    sentryEnabled = true
    logger.info('telemetry: Sentry error reporting enabled')
    return true
  } catch (err) {
    logger.warn(
      `telemetry: could not enable Sentry (install @sentry/node): ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return false
  }
}

/** True if either OTel or Sentry is wired up. */
export function telemetryActive(): { otel: boolean; sentry: boolean } {
  return { otel: otelEnabled, sentry: sentryEnabled }
}
