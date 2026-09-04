// fork_change - new file
//
// Model discovery against the locked provider's OpenAI-compatible `/models`
// endpoint.
//
// The Genix gateway has no models.dev catalog entry, so a provider with no
// models in config ends up with zero models and is dropped from the provider
// map (see provider.ts) — i.e. it never appears connected. `genixcode providers login`
// fetches the list once and persists it to config; the managed key file path
// has no login step, so it discovers the list at provider state init instead.
//
// Successful, non-empty results are memoised for the process lifetime so a
// repeated state init (config change, instance dispose) does not re-hit the
// gateway. Failures are not cached, so a transient outage self-heals.
//
// See FORK.md.

import { InstallationVersion } from "../installation/version"

const cache = new Map<string, Record<string, { name: string }>>()

const FETCH_TIMEOUT_MS = 15_000

function cacheKey(baseURL: string, apiKey: string) {
  return baseURL + " " + apiKey
}

/**
 * Fetch `<baseURL>/models` and shape it as a config-style model map.
 * Rejects on a network error or a non-2xx response.
 */
export async function fetchGatewayModels(baseURL: string, apiKey: string): Promise<Record<string, { name: string }>> {
  const url = baseURL.replace(/\/+$/, "") + "/models"
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // Bare fetch() falls back to the runtime default ("node" under Node, "Bun/x" under
      // Bun), so the gateway sees a useless client string. Set it explicitly.
      "User-Agent": `genixcode/${InstallationVersion}`, // fork_change - renamed binary
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`)
  }
  const json: unknown = await res.json()
  const data = json && typeof json === "object" ? (json as { data?: unknown }).data : undefined
  const items: unknown[] = Array.isArray(data) ? data : []
  const models: Record<string, { name: string }> = {}
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const entry = item as { id?: unknown; name?: unknown }
    const id = typeof entry.id === "string" ? entry.id.trim() : ""
    if (!id) continue
    const name = typeof entry.name === "string" ? entry.name.trim() : ""
    models[id] = { name: name || id }
  }
  return models
}

/**
 * Memoised {@link fetchGatewayModels} that never rejects — an unreachable or
 * unauthorised gateway yields an empty map plus the underlying error, leaving
 * whatever models config already supplies. Used from provider state init,
 * where a rejection would take the whole instance down; the caller logs
 * `error` through the normal logging channel.
 */
export async function cachedGatewayModels(
  baseURL: string,
  apiKey: string,
): Promise<{ models: Record<string, { name: string }>; error?: unknown }> {
  const key = cacheKey(baseURL, apiKey)
  const hit = cache.get(key)
  if (hit) return { models: hit }
  try {
    const models = await fetchGatewayModels(baseURL, apiKey)
    if (Object.keys(models).length === 0) return { models: {} }
    cache.set(key, models)
    return { models }
  } catch (error) {
    return { models: {}, error }
  }
}

/** Test seam — drops the memoised model lists. */
export function clearGatewayModelCache() {
  cache.clear()
}
