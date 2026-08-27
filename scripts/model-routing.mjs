export const ROUTE_ORDER = ['responses', 'messages', 'chat']

export const ROUTES = Object.freeze({
  responses: Object.freeze({
    provider: 'tokenlab-responses',
    displayName: 'TokenLab · Responses',
    api: 'openai-responses',
    baseURL: "!!js process.env.TOKENLAB_OPENAI_BASE_URL ?? 'https://api.tokenlab.sh/v1'",
    requestFormat: 'openai_responses',
  }),
  messages: Object.freeze({
    provider: 'tokenlab-messages',
    displayName: 'TokenLab · Messages',
    api: 'anthropic-messages',
    baseURL: "!!js process.env.TOKENLAB_ANTHROPIC_BASE_URL ?? 'https://api.tokenlab.sh'",
    requestFormat: 'anthropic_messages',
  }),
  chat: Object.freeze({
    provider: 'tokenlab-chat',
    displayName: 'TokenLab · Chat',
    api: 'openai-completions',
    baseURL: "!!js process.env.TOKENLAB_OPENAI_BASE_URL ?? 'https://api.tokenlab.sh/v1'",
    requestFormat: 'openai_chat_completions',
  }),
})

const OWNER_NATIVE_FORMAT = new Map([
  ['anthropic', 'anthropic_messages'],
  ['openai', 'openai_responses'],
])

const HARNESS_FORMAT_ROUTE = new Map([
  ['anthropic_messages', 'messages'],
  ['openai_responses', 'responses'],
  ['openai_chat_completions', 'chat'],
])

export function chooseRoute(model) {
  const formats = Array.isArray(model?.tokenlab?.accepted_request_formats)
    ? model.tokenlab.accepted_request_formats.filter(value => typeof value === 'string')
    : []
  const owner = typeof model?.owned_by === 'string' ? model.owned_by.toLowerCase() : ''
  const ownerNative = OWNER_NATIVE_FORMAT.get(owner)
  if (ownerNative !== undefined && formats.includes(ownerNative)) {
    return {
      route: HARNESS_FORMAT_ROUTE.get(ownerNative),
      selectedFormat: ownerNative,
      reason: 'owner_native',
    }
  }
  for (const format of ['openai_chat_completions', 'openai_responses', 'anthropic_messages']) {
    if (formats.includes(format)) {
      return {
        route: HARNESS_FORMAT_ROUTE.get(format),
        selectedFormat: format,
        reason: 'harness_fallback',
      }
    }
  }
  return {
    route: undefined,
    selectedFormat: undefined,
    reason: formats.includes('gemini_generate_content')
      ? 'gemini_native_not_supported_by_harness'
      : 'no_harness_supported_format',
  }
}

export function toRouteModel(model) {
  if (typeof model?.id !== 'string' || model.id.length === 0) throw new Error('Model detail is missing id')
  const decision = chooseRoute(model)
  if (decision.route === undefined) return { excluded: true, id: model.id, ...decision }
  const tokenlab = model.tokenlab ?? {}
  const capabilities = Array.isArray(tokenlab.capabilities)
    ? tokenlab.capabilities.filter(value => typeof value === 'string')
    : []
  const acceptedRequestFormats = Array.isArray(tokenlab.accepted_request_formats)
    ? tokenlab.accepted_request_formats.filter(value => typeof value === 'string')
    : []
  return {
    excluded: false,
    id: model.id,
    name: typeof model.name === 'string' && model.name.length > 0 ? model.name : model.id,
    ownedBy: typeof model.owned_by === 'string' ? model.owned_by : 'unknown',
    route: decision.route,
    selectedFormat: decision.selectedFormat,
    selectionReason: decision.reason,
    acceptedRequestFormats,
    contextWindow: Number.isSafeInteger(tokenlab.max_input_tokens) && tokenlab.max_input_tokens > 0
      ? tokenlab.max_input_tokens
      : null,
    maxTokens: Number.isSafeInteger(tokenlab.max_output_tokens) && tokenlab.max_output_tokens > 0
      ? tokenlab.max_output_tokens
      : null,
    input: capabilities.includes('vision') ? ['text', 'image'] : ['text'],
  }
}

export function buildCatalog(details, checkedAt = new Date().toISOString()) {
  const ids = new Set()
  const routes = Object.fromEntries(ROUTE_ORDER.map(route => [route, []]))
  const excluded = []
  for (const detail of details) {
    const model = toRouteModel(detail)
    if (ids.has(model.id)) throw new Error(`Duplicate model id: ${model.id}`)
    ids.add(model.id)
    if (model.excluded) excluded.push(model)
    else routes[model.route].push(model)
  }
  for (const route of ROUTE_ORDER) routes[route].sort((left, right) => left.id.localeCompare(right.id))
  excluded.sort((left, right) => left.id.localeCompare(right.id))
  return {
    schemaVersion: 1,
    source: {
      list: 'https://api.tokenlab.sh/v1/models?category=chat',
      detailTemplate: 'https://api.tokenlab.sh/v1/models/{id}',
      checkedAt,
    },
    routingPolicy: {
      description: 'Prefer the exact owner-native format when DSH supports it; otherwise use the first supported compatibility format without guessing from model ids.',
      ownerNativeFormats: Object.fromEntries(OWNER_NATIVE_FORMAT),
      harnessSupportedFormats: Object.fromEntries(HARNESS_FORMAT_ROUTE),
      geminiNative: 'unsupported-by-dsh-fallback-to-chat-when-declared',
    },
    counts: {
      source: details.length,
      routed: Object.values(routes).reduce((sum, models) => sum + models.length, 0),
      excluded: excluded.length,
      byRoute: Object.fromEntries(ROUTE_ORDER.map(route => [route, routes[route].length])),
    },
    routes,
    excluded,
  }
}

export function assertCatalogRoutable(catalog) {
  if (!Array.isArray(catalog?.excluded)) throw new Error('Model catalog is missing excluded[]')
  if (catalog.excluded.length === 0) return
  const sample = catalog.excluded
    .slice(0, 10)
    .map(model => `${model.id} (${model.reason})`)
    .join(', ')
  const suffix = catalog.excluded.length > 10 ? `, and ${catalog.excluded.length - 10} more` : ''
  throw new Error(
    `TokenLab has ${catalog.excluded.length} active chat model(s) without a DeepSeek Harness-supported protocol: ${sample}${suffix}`,
  )
}
