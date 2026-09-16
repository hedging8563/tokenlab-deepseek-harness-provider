import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { waitForTask } from './client.ts'

export const name = 'tokenlab-dsh-provider'
export const inject = ['tools']

const DEFAULT_API_BASE = 'https://api.tokenlab.sh'
const DEFAULT_API_KEY_ENV = 'TOKENLAB_API_KEY'
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_WAIT_MS = 15 * 60_000
const MAX_WAIT_MS = 60 * 60_000
const MAX_TRANSIENT_ERRORS = 3

export interface Config {
  apiBase?: string
  apiKeyEnv?: string
  defaultPollIntervalMs?: number
  defaultWaitMs?: number
  mcpToolProfile?: 'catalog' | 'core' | 'full'
  mcpSchemaMode?: 'portable' | 'exact' | 'strict'
  mcpToolCallTimeoutMs?: number
  mcpFailOnStartupError?: boolean
}

export const Config: z<Config> = z.object({
  apiBase: z.string().default(DEFAULT_API_BASE),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV),
  defaultPollIntervalMs: z.number().step(1).min(250).max(60_000).default(DEFAULT_POLL_INTERVAL_MS),
  defaultWaitMs: z.number().step(1).min(1_000).max(MAX_WAIT_MS).default(DEFAULT_WAIT_MS),
  mcpToolProfile: z.union(['catalog', 'core', 'full']).default('core'),
  mcpSchemaMode: z.union(['portable', 'exact', 'strict']).default('portable'),
  mcpToolCallTimeoutMs: z.number().step(1).min(1_000).max(MAX_WAIT_MS).default(180_000),
  mcpFailOnStartupError: z.boolean().default(true),
})

function renderedResponse(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2)
  const maxBytes = 24_000
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized
  return `${Buffer.from(serialized).subarray(0, maxBytes).toString('utf8')}\n… response truncated in model view; the canonical tool value remains complete`
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function mcpServerEntrypoint(): string {
  const packageJson = import.meta.resolve('@tokenlabai/mcp-server/package.json')
  return fileURLToPath(new URL('./src/index.js', packageJson))
}

function optionalEnvironment(name: string): Record<string, string> {
  const value = process.env[name]
  return value === undefined ? {} : { [name]: value }
}

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const apiBase = config.apiBase ?? DEFAULT_API_BASE
  const apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
  const defaultPollIntervalMs = config.defaultPollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const defaultWaitMs = config.defaultWaitMs ?? DEFAULT_WAIT_MS

  ctx.tools.register(defineTool({
    name: 'tokenlab_wait_task',
    description:
      'Wait for a TokenLab asynchronous image, video, music, or 3D task to become terminal. '
      + 'Use the task id returned by a TokenLab create tool. This read-only poller retries bounded transient failures, '
      + 'honors cancellation, and returns completed result URLs without changing task state.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Task id returned as id, task_id, or delivery.task_id by a TokenLab tool.',
      },
      poll_interval_ms: {
        type: 'integer',
        description: `Polling interval in milliseconds from 250 through 60000. Defaults to ${defaultPollIntervalMs}.`,
      },
      timeout_ms: {
        type: 'integer',
        description: `Maximum wait in milliseconds from 1000 through ${MAX_WAIT_MS}. Defaults to ${defaultWaitMs}; a timeout returns the latest status for resumable polling.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          terminal: { type: 'boolean', required: true },
          timed_out: { type: 'boolean', required: true },
          attempts: { type: 'integer', required: true },
          elapsed_ms: { type: 'integer', required: true },
          transient_errors: { type: 'integer', required: true },
          result_urls: { type: 'array', required: true, items: { type: 'string' } },
          response: { type: 'json', required: true },
          last_request_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          value.timed_out
            ? `TokenLab task ${value.id} is still ${value.status}; the wait window expired and polling can be resumed.`
            : `TokenLab task ${value.id} reached terminal status ${value.status}.`,
          value.result_urls.length === 0 ? '' : `Result URLs:\n${value.result_urls.join('\n')}`,
          `Task response:\n${renderedResponse(value.response)}`,
        ].filter(Boolean).join('\n\n'),
      }],
    },
    timeoutMs: MAX_WAIT_MS + 10_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const apiKey = process.env[apiKeyEnv] ?? ''
      const result = await waitForTask({
        apiBase,
        apiKey,
        id: args.id,
        pollIntervalMs: boundedInteger(
          args.poll_interval_ms ?? defaultPollIntervalMs,
          'poll_interval_ms',
          250,
          60_000,
        ),
        timeoutMs: boundedInteger(args.timeout_ms ?? defaultWaitMs, 'timeout_ms', 1_000, MAX_WAIT_MS),
        maxTransientErrors: MAX_TRANSIENT_ERRORS,
        signal: exec.signal,
      })
      return {
        id: result.id,
        status: result.status,
        terminal: result.terminal,
        timed_out: result.timedOut,
        attempts: result.attempts,
        elapsed_ms: result.elapsedMs,
        transient_errors: result.transientErrors,
        result_urls: result.resultUrls,
        response: result.response,
        ...(result.lastRequestId === undefined ? {} : { last_request_id: result.lastRequestId }),
      }
    },
  }))

  await ctx.plugin(McpClient, {
    serverName: 'tokenlab',
    transport: 'stdio',
    command: process.execPath,
    args: [mcpServerEntrypoint()],
    env: {
      TOKENLAB_API_BASE: apiBase,
      TOKENLAB_API_KEY: process.env[apiKeyEnv] ?? '',
      TOKENLAB_MCP_TOOL_PROFILE: config.mcpToolProfile ?? 'core',
      TOKENLAB_MCP_SCHEMA_MODE: config.mcpSchemaMode ?? 'portable',
      ...optionalEnvironment('TOKENLAB_REQUEST_TIMEOUT_MS'),
      ...optionalEnvironment('TOKENLAB_MCP_MAX_FILE_BYTES'),
      ...optionalEnvironment('TOKENLAB_MCP_INLINE_BYTES'),
      ...optionalEnvironment('TOKENLAB_ARTIFACT_DIR'),
    },
    cwd: '',
    toolCallTimeoutMs: config.mcpToolCallTimeoutMs ?? 180_000,
    failOnStartupError: config.mcpFailOnStartupError ?? true,
    reconnect: {
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 30_000,
      maxAttempts: 10,
    },
  })
}
