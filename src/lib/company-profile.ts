export type CompanyProfile = {
  companyName: string;
  summary: string | null;
  founded: string | null;
  founder: string | null;
  ceoMd: string | null;
  headquarters: string | null;
  industry: string | null;
  website: string | null;
  wikipediaUrl: string | null;
  source: string;
  updatedAt: string;
};

type CacheEntry = {
  data: CompanyProfile;
  fetchedAt: number;
};

type WikiSearchResponse = {
  query?: {
    search?: Array<{ title?: string }>;
  };
};

type WikiPageResponse = {
  query?: {
    pages?: Record<string, {
      title?: string;
      extract?: string;
      fullurl?: string;
      pageprops?: {
        wikibase_item?: string;
      };
    }>;
  };
};

type WikidataEntityResponse = {
  entities?: Record<string, {
    claims?: Record<string, Array<{
      mainsnak?: {
        datavalue?: {
          value?:
            | { id?: string }
            | { time?: string }
            | string;
        };
      };
    }>>;
  }>;
};

type WikidataLabelsResponse = {
  entities?: Record<string, {
    labels?: {
      en?: {
        value?: string;
      };
    };
  }>;
};

const PROFILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const profileCache = new Map<string, CacheEntry>();

const withTimeout = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "FinPilot/1.0 (+https://localhost:3000)",
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
};

const getClaimList = (
  claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> | undefined,
  property: string
) => {
  return claims?.[property] ?? [];
};

const getWikibaseIds = (
  claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> | undefined,
  property: string,
  maxItems = 3
) => {
  const rows = getClaimList(claims, property);
  const ids: string[] = [];

  for (const row of rows) {
    const value = row?.mainsnak?.datavalue?.value as { id?: string } | undefined;
    if (value?.id) {
      ids.push(value.id);
    }
    if (ids.length >= maxItems) {
      break;
    }
  }

  return ids;
};

const getStringClaim = (
  claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> | undefined,
  property: string
) => {
  const row = getClaimList(claims, property)[0];
  const value = row?.mainsnak?.datavalue?.value;
  return typeof value === "string" ? value : null;
};

const formatWikidataDate = (
  claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> | undefined,
  property: string
) => {
  const row = getClaimList(claims, property)[0];
  const value = row?.mainsnak?.datavalue?.value as { time?: string } | undefined;
  const raw = value?.time;

  if (!raw) {
    return null;
  }

  const match = raw.match(/^\+?(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }

  const year = match[1];
  const month = match[2];
  const day = match[3];

  if (month === "00" || day === "00") {
    return year;
  }

  return `${year}-${month}-${day}`;
};

const resolveWikidataLabels = async (ids: string[]) => {
  if (!ids.length) {
    return new Map<string, string>();
  }

  const unique = Array.from(new Set(ids));
  const endpoint = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&languages=en&props=labels&ids=${encodeURIComponent(unique.join("|"))}`;
  const response = await withTimeout<WikidataLabelsResponse>(endpoint, 6000);

  const map = new Map<string, string>();
  for (const id of unique) {
    const label = response.entities?.[id]?.labels?.en?.value;
    if (label) {
      map.set(id, label);
    }
  }

  return map;
};

const toSummary = (text: string | undefined) => {
  if (!text) {
    return null;
  }

  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  if (cleaned.length <= 420) {
    return cleaned;
  }

  return `${cleaned.slice(0, 417)}...`;
};

export async function getCompanyProfile(companyName: string, symbol: string) {
  const normalizedCompany = companyName.trim();
  const normalizedSymbol = symbol.trim().toUpperCase();
  const cacheKey = `${normalizedCompany}|${normalizedSymbol}`;

  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL_MS) {
    return cached.data;
  }

  const fallback: CompanyProfile = {
    companyName: normalizedCompany || normalizedSymbol,
    summary: null,
    founded: null,
    founder: null,
    ceoMd: null,
    headquarters: null,
    industry: null,
    website: null,
    wikipediaUrl: null,
    source: "wikipedia-wikidata",
    updatedAt: new Date().toISOString(),
  };

  try {
    const searchQuery = encodeURIComponent(`${normalizedCompany || normalizedSymbol} India company`);
    const searchEndpoint = `https://en.wikipedia.org/w/api.php?action=query&list=search&utf8=1&format=json&srlimit=1&srsearch=${searchQuery}`;
    const searchResult = await withTimeout<WikiSearchResponse>(searchEndpoint, 6000);

    const firstTitle = searchResult.query?.search?.[0]?.title;
    if (!firstTitle) {
      profileCache.set(cacheKey, { data: fallback, fetchedAt: Date.now() });
      return fallback;
    }

    const pageEndpoint = `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=extracts|pageprops|info&inprop=url&exintro=1&explaintext=1&titles=${encodeURIComponent(firstTitle)}`;
    const pageResult = await withTimeout<WikiPageResponse>(pageEndpoint, 6000);
    const firstPage = Object.values(pageResult.query?.pages ?? {})[0];

    const summary = toSummary(firstPage?.extract);
    const wikipediaUrl = firstPage?.fullurl ?? null;
    const wikibaseId = firstPage?.pageprops?.wikibase_item;

    if (!wikibaseId) {
      const profile = {
        ...fallback,
        companyName: firstPage?.title || fallback.companyName,
        summary,
        wikipediaUrl,
        updatedAt: new Date().toISOString(),
      };
      profileCache.set(cacheKey, { data: profile, fetchedAt: Date.now() });
      return profile;
    }

    const entityEndpoint = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(wikibaseId)}.json`;
    const entityResult = await withTimeout<WikidataEntityResponse>(entityEndpoint, 7000);
    const claims = entityResult.entities?.[wikibaseId]?.claims;

    const founderIds = getWikibaseIds(claims, "P112", 3);
    const ceoIds = getWikibaseIds(claims, "P169", 2);
    const hqIds = getWikibaseIds(claims, "P159", 2);
    const industryIds = getWikibaseIds(claims, "P452", 2);

    const labelIds = [...founderIds, ...ceoIds, ...hqIds, ...industryIds];
    const labels = await resolveWikidataLabels(labelIds);

    const founded = formatWikidataDate(claims, "P571");
    const founder = founderIds.map((id) => labels.get(id)).filter(Boolean).join(", ") || null;
    const ceoMd = ceoIds.map((id) => labels.get(id)).filter(Boolean).join(", ") || null;
    const headquarters = hqIds.map((id) => labels.get(id)).filter(Boolean).join(", ") || null;
    const industry = industryIds.map((id) => labels.get(id)).filter(Boolean).join(", ") || null;
    const website = getStringClaim(claims, "P856");

    const profile: CompanyProfile = {
      companyName: firstPage?.title || fallback.companyName,
      summary,
      founded,
      founder,
      ceoMd,
      headquarters,
      industry,
      website,
      wikipediaUrl,
      source: "wikipedia-wikidata",
      updatedAt: new Date().toISOString(),
    };

    profileCache.set(cacheKey, { data: profile, fetchedAt: Date.now() });
    return profile;
  } catch {
    profileCache.set(cacheKey, { data: fallback, fetchedAt: Date.now() });
    return fallback;
  }
}