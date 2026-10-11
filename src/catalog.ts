// Live TokenLab public catalog (GET /v1/models, no key). Every tool reads models, categories, context windows,
// capabilities and platform prices from here. The server keeps one copy in memory for at most
// CATALOG_MAX_AGE_MS (10 minutes); after that it must refetch. If the refetch fails and the copy is older than
// that, the tools return an explicit error: they never fall back silently to an old snapshot.

export const CATALOG_MAX_AGE_MS = 10 * 60 * 1000;

export type CatalogPrice = {
  input_per_1m: string | null;
  output_per_1m: string | null;
  per_request: string | null;
  is_lock_price: boolean;
  currency: string | null;
};

export type CatalogModel = {
  id: string;
  category: string;
  provider: string | null;
  pricing_unit: string | null;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  capabilities: string[];
  pricing: CatalogPrice;
  // Flat copies of the platform price, kept for the widget and older clients.
  input_per_1m: string | null;
  output_per_1m: string | null;
  per_request: string | null;
  currency: string | null;
  // When this server read the price from the live catalog (ISO 8601, UTC).
  price_fetched_at: string;
};

export type Catalog = {
  source: string;
  fetched_at: string;
  models: CatalogModel[];
};

type RawModel = {
  id?: unknown;
  owned_by?: unknown;
  tokenlab?: {
    category?: unknown;
    pricing_unit?: unknown;
    max_input_tokens?: unknown;
    max_output_tokens?: unknown;
    capabilities?: unknown;
    providers?: unknown;
    pricing?: Record<string, unknown> | null;
  };
};

export class CatalogUnavailableError extends Error {
  constructor(detail: string) {
    super(`TokenLab live model catalog is unavailable right now (${detail}); no prices or models were returned. Try again shortly.`);
    this.name = 'CatalogUnavailableError';
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function normalizeModel(raw: RawModel, fetchedAt: string): CatalogModel | null {
  const id = text(raw.id);
  if (!id) return null;
  const meta = raw.tokenlab || {};
  const price = meta.pricing || {};
  const providers = Array.isArray(meta.providers) ? meta.providers.filter((p): p is string => typeof p === 'string') : [];
  const pricing: CatalogPrice = {
    input_per_1m: text(price.input_per_1m),
    output_per_1m: text(price.output_per_1m),
    per_request: text(price.per_request),
    is_lock_price: price.is_lock_price === true,
    currency: text(price.currency),
  };
  return {
    id,
    category: text(meta.category) ?? 'unknown',
    provider: providers[0] ?? text(raw.owned_by),
    pricing_unit: text(meta.pricing_unit),
    max_input_tokens: count(meta.max_input_tokens),
    max_output_tokens: count(meta.max_output_tokens),
    capabilities: Array.isArray(meta.capabilities) ? meta.capabilities.filter((c): c is string => typeof c === 'string') : [],
    pricing,
    input_per_1m: pricing.input_per_1m,
    output_per_1m: pricing.output_per_1m,
    per_request: pricing.per_request,
    currency: pricing.currency,
    price_fetched_at: fetchedAt,
  };
}

export function createCatalogReader(options: {
  apiBase: string;
  maxAgeMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}) {
  const maxAgeMs = Math.min(options.maxAgeMs ?? 5 * 60 * 1000, CATALOG_MAX_AGE_MS);
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const source = `${options.apiBase}/v1/models`;
  let cached: { at: number; catalog: Catalog } | null = null;
  let inflight: Promise<Catalog> | null = null;

  async function load(): Promise<Catalog> {
    let response: Response;
    try {
      response = await fetchImpl(source, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
    } catch (error) {
      throw new CatalogUnavailableError(error instanceof Error ? error.message : 'request failed');
    }
    if (!response.ok) throw new CatalogUnavailableError(`HTTP ${response.status}`);
    let body: { data?: RawModel[] };
    try {
      body = await response.json() as { data?: RawModel[] };
    } catch {
      throw new CatalogUnavailableError('invalid JSON');
    }
    if (!Array.isArray(body?.data) || body.data.length === 0) throw new CatalogUnavailableError('empty model list');
    const at = now();
    const fetchedAt = new Date(at).toISOString();
    const models = body.data.map((m) => normalizeModel(m, fetchedAt)).filter((m): m is CatalogModel => m !== null);
    const catalog = { source, fetched_at: fetchedAt, models };
    cached = { at, catalog };
    return catalog;
  }

  return async function getCatalog(): Promise<Catalog> {
    if (cached && now() - cached.at < maxAgeMs) return cached.catalog;
    if (!inflight) inflight = load().finally(() => { inflight = null; });
    try {
      return await inflight;
    } catch (error) {
      // A copy still inside the 10-minute limit may be served; anything older is an error, never a silent snapshot.
      if (cached && now() - cached.at < CATALOG_MAX_AGE_MS) return cached.catalog;
      throw error;
    }
  };
}

export function selectModels(catalog: Catalog, category: string | undefined, query: string | undefined): CatalogModel[] {
  const wanted = category?.trim().toLowerCase();
  const selected = wanted === 'text' ? 'chat' : wanted;
  const q = query?.trim().toLowerCase();
  return catalog.models
    .filter((m) => !selected || m.category === selected)
    .filter((m) => !q || m.id.toLowerCase().includes(q));
}

export function categoryCounts(catalog: Catalog): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of catalog.models) counts[m.category] = (counts[m.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
