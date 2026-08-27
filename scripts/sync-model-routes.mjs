import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCatalogRoutable, buildCatalog } from './model-routing.mjs'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const outputPath = join(packageRoot, 'generated/model-routes.json')
const apiBase = (process.env.TOKENLAB_API_BASE ?? 'https://api.tokenlab.sh').replace(/\/+$/, '')
const checkOnly = process.argv.includes('--check')

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`)
  return response.json()
}

async function fetchDetails(ids) {
  const details = []
  for (let offset = 0; offset < ids.length; offset += 12) {
    const batch = ids.slice(offset, offset + 12)
    details.push(...await Promise.all(batch.map(id => getJson(`${apiBase}/v1/models/${encodeURIComponent(id)}`))))
  }
  return details
}

async function currentCatalog() {
  const listing = await getJson(`${apiBase}/v1/models?category=chat`)
  if (!Array.isArray(listing?.data)) throw new Error('TokenLab model listing is missing data[]')
  const ids = listing.data.map(model => model?.id)
  if (ids.some(id => typeof id !== 'string' || id.length === 0)) throw new Error('TokenLab model listing contains an invalid id')
  return buildCatalog(await fetchDetails(ids))
}

function withoutTimestamp(value) {
  return {
    ...value,
    source: { ...value.source, checkedAt: '<ignored>' },
  }
}

const next = await currentCatalog()
assertCatalogRoutable(next)
if (checkOnly) {
  const current = JSON.parse(await readFile(outputPath, 'utf8'))
  if (JSON.stringify(withoutTimestamp(current)) !== JSON.stringify(withoutTimestamp(next))) {
    throw new Error('generated/model-routes.json is stale; run npm run routes:sync')
  }
  console.log(`TokenLab model source is current (${next.counts.routed} routed, ${next.counts.excluded} excluded).`)
} else {
  const tempPath = `${outputPath}.tmp-${process.pid}`
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(tempPath, outputPath)
  console.log(`Wrote ${outputPath} (${next.counts.routed} routed, ${next.counts.excluded} excluded).`)
}
