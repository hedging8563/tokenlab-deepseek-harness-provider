import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchTask, TokenLabHttpError, waitForTask } from '../src/client.ts'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

test('waitForTask returns terminal results and recursively extracts URLs', async () => {
  const seen: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push(String(input))
    assert.equal(init?.method, 'GET')
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret-test-key')
    return jsonResponse({
      id: 'ldtask_abc',
      status: 'completed',
      video: { url: 'https://cdn.example/video.mp4' },
      data: [{ url: 'https://cdn.example/poster.png' }],
    }, 200, { 'x-request-id': 'req-1' })
  }
  const result = await waitForTask({
    apiBase: 'https://api.tokenlab.sh',
    apiKey: 'secret-test-key',
    id: 'ldtask_abc',
    pollIntervalMs: 250,
    timeoutMs: 1_000,
    maxTransientErrors: 2,
    fetchImpl,
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.terminal, true)
  assert.equal(result.timedOut, false)
  assert.equal(result.attempts, 1)
  assert.deepEqual(result.resultUrls, [
    'https://cdn.example/video.mp4',
    'https://cdn.example/poster.png',
  ])
  assert.equal(result.lastRequestId, 'req-1')
  assert.deepEqual(seen, ['https://api.tokenlab.sh/v1/tasks/ldtask_abc'])
})

test('waitForTask retries bounded transient HTTP failures', async () => {
  let calls = 0
  const fetchImpl: typeof fetch = async () => {
    calls++
    if (calls === 1) return jsonResponse({ error: { code: 'busy', message: 'try again' } }, 503)
    return jsonResponse({ id: 'ldtask_retry', status: 'failed', error: 'provider rejected task' })
  }
  const result = await waitForTask({
    apiBase: 'https://api.tokenlab.sh/v1',
    apiKey: 'key',
    id: 'ldtask_retry',
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    maxTransientErrors: 2,
    fetchImpl,
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.transientErrors, 1)
  assert.equal(result.attempts, 2)
})

test('waitForTask timeout returns the latest nonterminal state for resumable polling', async () => {
  const result = await waitForTask({
    apiBase: 'https://api.tokenlab.sh',
    apiKey: 'key',
    id: 'ldtask_pending',
    pollIntervalMs: 500,
    timeoutMs: 50,
    maxTransientErrors: 0,
    fetchImpl: async () => jsonResponse({ id: 'ldtask_pending', status: 'processing', progress: 25 }),
  })
  assert.equal(result.status, 'processing')
  assert.equal(result.terminal, false)
  assert.equal(result.timedOut, true)
  assert.equal(result.attempts, 1)
  assert.deepEqual(result.response, { id: 'ldtask_pending', status: 'processing', progress: 25 })
})

test('caller cancellation reaches an in-flight fetch', async () => {
  const controller = new AbortController()
  const fetchImpl: typeof fetch = async (_input, init) => {
    assert.ok(init?.signal)
    controller.abort(new Error('caller stopped'))
    init.signal.throwIfAborted()
    return jsonResponse({ status: 'completed' })
  }
  await assert.rejects(
    waitForTask({
      apiBase: 'https://api.tokenlab.sh',
      apiKey: 'key',
      id: 'ldtask_cancel',
      pollIntervalMs: 250,
      timeoutMs: 1_000,
      maxTransientErrors: 0,
      signal: controller.signal,
      fetchImpl,
    }),
    /caller stopped/,
  )
})

test('fetchTask preserves structured HTTP diagnostics without credential leakage', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse(
    { error: { code: 'task_not_found', message: 'No task' } },
    404,
    { 'x-request-id': 'req-missing' },
  )
  await assert.rejects(
    fetchTask({
      apiBase: 'https://api.tokenlab.sh',
      apiKey: 'never-show-this',
      id: 'ldtask_missing',
      fetchImpl,
    }),
    (error: unknown) => {
      assert.ok(error instanceof TokenLabHttpError)
      assert.equal(error.status, 404)
      assert.equal(error.code, 'task_not_found')
      assert.equal(error.requestId, 'req-missing')
      assert.doesNotMatch(error.message, /never-show-this/)
      return true
    },
  )
})

test('fetchTask rejects unsafe task ids before network I/O', async () => {
  let called = false
  const fetchImpl: typeof fetch = async () => {
    called = true
    return jsonResponse({ status: 'completed' })
  }
  await assert.rejects(
    fetchTask({ apiBase: 'https://api.tokenlab.sh', apiKey: 'key', id: '../secret', fetchImpl }),
    /Task id must be/,
  )
  assert.equal(called, false)
})
