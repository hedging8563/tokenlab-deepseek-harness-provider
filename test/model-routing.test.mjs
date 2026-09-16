import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCatalogRoutable, buildCatalog, chooseRoute } from '../scripts/model-routing.mjs'

function model(id, ownedBy, formats, capabilities = []) {
  return {
    id,
    owned_by: ownedBy,
    tokenlab: {
      accepted_request_formats: formats,
      capabilities,
      max_input_tokens: 100_000,
      max_output_tokens: 10_000,
    },
  }
}

test('prefers exact owner-native protocols and falls back without model-name guesses', () => {
  assert.deepEqual(
    chooseRoute(model('opaque-a', 'anthropic', ['openai_chat_completions', 'anthropic_messages'])),
    { route: 'messages', selectedFormat: 'anthropic_messages', reason: 'owner_native' },
  )
  assert.deepEqual(
    chooseRoute(model('opaque-b', 'openai', ['openai_chat_completions', 'openai_responses'])),
    { route: 'responses', selectedFormat: 'openai_responses', reason: 'owner_native' },
  )
  assert.deepEqual(
    chooseRoute(model('opaque-c', 'google', ['gemini_generate_content', 'openai_chat_completions'])),
    { route: 'chat', selectedFormat: 'openai_chat_completions', reason: 'harness_fallback' },
  )
  assert.deepEqual(
    chooseRoute(model('opaque-d', 'other', ['openai_responses', 'anthropic_messages'])),
    { route: 'responses', selectedFormat: 'openai_responses', reason: 'harness_fallback' },
  )
})

test('builds one exclusive route per model and records unsupported models', () => {
  const catalog = buildCatalog([
    model('m1', 'openai', ['openai_chat_completions', 'openai_responses'], ['vision']),
    model('m2', 'anthropic', ['anthropic_messages', 'openai_chat_completions']),
    model('m3', 'google', ['gemini_generate_content']),
  ], '2026-08-27T00:00:00.000Z')
  assert.deepEqual(catalog.counts, {
    source: 3,
    routed: 2,
    excluded: 1,
    byRoute: { responses: 1, messages: 1, chat: 0 },
  })
  assert.deepEqual(catalog.routes.responses[0].input, ['text', 'image'])
  assert.equal(catalog.excluded[0].reason, 'gemini_native_not_supported_by_harness')
  const routedIds = Object.values(catalog.routes).flat().map(entry => entry.id)
  assert.equal(new Set(routedIds).size, routedIds.length)
})

test('refuses duplicate public model ids', () => {
  const duplicate = model('same', 'other', ['openai_chat_completions'])
  assert.throws(() => buildCatalog([duplicate, duplicate]), /Duplicate model id/)
})

test('fails closed when an active model has no Harness-supported protocol', () => {
  const catalog = buildCatalog([
    model('chat-ok', 'other', ['openai_chat_completions']),
    model('gemini-only', 'google', ['gemini_generate_content']),
  ])
  assert.throws(
    () => assertCatalogRoutable(catalog),
    /gemini-only \(gemini_native_not_supported_by_harness\)/,
  )
})

// A generic public capability is not an enum of model-specific wire values.
test('does not invent reasoning efforts from a name or generic reasoning capability', () => {
  const catalog = buildCatalog([
    model('gpt-6-astra', 'openai', ['openai_responses'], ['reasoning']),
    model('opaque-reasoner', 'other', ['openai_chat_completions'], ['reasoning']),
  ])
  for (const routeModel of Object.values(catalog.routes).flat()) {
    assert.equal(Object.hasOwn(routeModel, 'reasoningEfforts'), false)
  }
})
