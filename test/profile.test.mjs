import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import YAML from 'yaml'

const root = new URL('../', import.meta.url)

function parsePatch(text) {
  const withoutJsTags = text.replace(/!!js ([^\n]+)/g, (_match, expression) => JSON.stringify(`js:${expression}`))
  return YAML.parse(withoutJsTags)
}

test('bundle patch exposes exclusive native routes, full MCP, and async wait', async () => {
  const [patchText, catalogText] = await Promise.all([
    readFile(new URL('cordis.patch.yml', root), 'utf8'),
    readFile(new URL('generated/model-routes.json', root), 'utf8'),
  ])
  const patch = parsePatch(patchText)
  const catalog = JSON.parse(catalogText)
  const llm = patch.find(entry => entry.id === 'llm-pi-ai')
  assert.ok(llm)
  const providers = llm.config.providers
  assert.deepEqual(Object.keys(providers), ['tokenlab-responses', 'tokenlab-messages', 'tokenlab-chat'])
  assert.equal(providers['tokenlab-responses'].api, 'openai-responses')
  assert.equal(providers['tokenlab-messages'].api, 'anthropic-messages')
  assert.equal(providers['tokenlab-chat'].api, 'openai-completions')

  const allModels = Object.values(providers).flatMap(provider => provider.models.map(model => model.id))
  assert.equal(allModels.length, catalog.counts.routed)
  assert.equal(new Set(allModels).size, allModels.length)
  assert.equal(providers['tokenlab-responses'].models.length, catalog.counts.byRoute.responses)
  assert.equal(providers['tokenlab-messages'].models.length, catalog.counts.byRoute.messages)
  assert.equal(providers['tokenlab-chat'].models.length, catalog.counts.byRoute.chat)

  const inserted = patch.find(entry => Array.isArray(entry.insert)).insert
  const waiter = inserted.find(entry => entry.id === 'tokenlab-async-tools')
  assert.equal(waiter.name, '@tokenlabai/dsh-provider')
  assert.match(waiter.config.mcpToolProfile, /TOKENLAB_MCP_TOOL_PROFILE/)
  assert.match(waiter.config.mcpSchemaMode, /TOKENLAB_MCP_SCHEMA_MODE/)
  assert.equal(waiter.config.mcpFailOnStartupError, true)
})
