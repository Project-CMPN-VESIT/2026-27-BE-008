import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type DocScrapperArtifact = {
  name: string;
  key: string;
  url: string | null;
  size: number;
  lastModified: string | null;
};

export type DocScrapperStockData = {
  symbol: string;
  available: boolean;
  source: string;
  pipelineRunAt: string | null;
  summaryText: string | null;
  industry: string | null;
  sector: string | null;
  website: string | null;
  headquarters: string | null;
  employees: string | null;
  strengths: string[];
  concerns: string[];
  annualReportLinks: Array<{ year?: string; label?: string; url?: string }>;
  metrics: {
    currentPrice: number | null;
    marketCapCr: number | null;
    peRatio: number | null;
    pbRatio: number | null;
    roePct: number | null;
    revenueGrowthPct: number | null;
    debtToEquity: number | null;
  };
  counts: {
    announcements: number;
    corporateActions: number;
    insiderTrades: number;
    quarterlyRows: number;
    shareholdingRows: number;
    historicalPriceRows: number;
  };
  artifacts: DocScrapperArtifact[];
  raw: Record<string, unknown> | null;
};

type JsonLike = Record<string, unknown>;

const normalizeSymbol = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/^NSE[_:]/, "")
    .replace(/^BSE[_:]/, "")
    .replace(/[^A-Z0-9-]/g, "");

const normalizePrefix = (prefix: string) => prefix.replace(/^\/+|\/+$/g, "");

const asRecord = (value: unknown): JsonLike => {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonLike) : {};
};

const asArray = <T = unknown>(value: unknown): T[] => {
  return Array.isArray(value) ? (value as T[]) : [];
};

const asNumber = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const createS3Client = () => {
  const region = process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? "ap-southeast-2";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  const hasStaticCreds = !!(accessKeyId && secretAccessKey);

  return new S3Client({
    region,
    credentials: hasStaticCreds ? { accessKeyId, secretAccessKey } : undefined,
  });
};

const bodyToString = async (body: unknown): Promise<string> => {
  if (!body) {
    return "";
  }

  const streamBody = body as { transformToString?: (encoding?: string) => Promise<string> };
  if (typeof streamBody.transformToString === "function") {
    return streamBody.transformToString("utf-8");
  }

  return "";
};

const listArtifacts = async (
  client: S3Client,
  bucket: string,
  basePrefix: string
): Promise<DocScrapperArtifact[]> => {
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${basePrefix}/`,
      MaxKeys: 100,
    })
  );

  const objects = response.Contents ?? [];
  const artifacts: DocScrapperArtifact[] = [];

  for (const item of objects) {
    if (!item.Key) continue;
    
    const key = item.Key;
    const name = key.split("/").pop() ?? key;

    let url: string | null = null;
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      // Generate a signed URL that's valid for 1 hour (3600 seconds)
      url = await getSignedUrl(client, command, { expiresIn: 3600 });
    } catch (err) {
      console.error(`Failed to generate signed URL for ${key}:`, err);
    }

    artifacts.push({
      name,
      key,
      url,
      size: item.Size ?? 0,
      lastModified: item.LastModified ? item.LastModified.toISOString() : null,
    });
  }

  return artifacts.sort((a, b) => a.name.localeCompare(b.name));
};

export async function getDocScrapperStockData(
  inputSymbol: string,
  options?: { includeRaw?: boolean }
): Promise<DocScrapperStockData | null> {
  const symbol = normalizeSymbol(inputSymbol);
  if (!symbol) {
    return null;
  }

  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error("S3_BUCKET is not configured in FinPilot environment");
  }

  const s3Prefix = normalizePrefix(process.env.S3_PREFIX ?? "doc-scrapper");
  const basePrefix = `${s3Prefix}/latest/${symbol}`;
  const jsonKey = `${basePrefix}/${symbol}_complete_data.json`;

  const client = createS3Client();

  try {
    const objectResponse = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: jsonKey,
      })
    );

    const jsonText = await bodyToString(objectResponse.Body);
    if (!jsonText) {
      return null;
    }

    // Sanitize JSON text to handle NaN values which are invalid in standard JSON
    const sanitizedJsonText = jsonText.replace(/:\s*NaN\b/g, ": null");
    const raw = JSON.parse(sanitizedJsonText) as JsonLike;
    const yfinance = asRecord(raw.yfinance);
    const profile = asRecord(yfinance.profile);
    const quote = asRecord(yfinance.quote);
    const keyMetrics = asRecord(yfinance.key_metrics);

    const screener = asRecord(raw.screener);
    const screenerAnalysis = asRecord(screener.screener_analysis);

    const nse = asRecord(raw.nse);
    const bse = asRecord(raw.bse);

    const screenerArLinks = asArray<{ year?: string; label?: string; url?: string }>(screener.annual_report_links);
    const bseArLinks = asArray<{ year?: string; label?: string; url?: string }>(bse.bse_annual_reports);

    const announcementsCount =
      asArray(nse.nse_announcements).length + asArray(bse.bse_announcements).length;

    const artifacts = await listArtifacts(client, bucket, basePrefix);

    return {
      symbol,
      available: true,
      source: `s3://${bucket}/${jsonKey}`,
      pipelineRunAt: typeof raw.pipeline_run_at === "string" ? raw.pipeline_run_at : null,
      summaryText: typeof profile.description === "string" ? profile.description : null,
      industry: typeof profile.industry === "string" ? profile.industry : null,
      sector: typeof profile.sector === "string" ? profile.sector : null,
      website: typeof profile.website === "string" ? profile.website : null,
      headquarters: profile.city 
        ? `${profile.city}${profile.state ? `, ${profile.state}` : ""}${profile.country ? `, ${profile.country}` : ""}`
        : (typeof profile.address === 'string' ? profile.address : null),
      employees: profile.employees ? String(profile.employees) : null,
      strengths: asArray<string>(screenerAnalysis.strengths),
      concerns: asArray<string>(screenerAnalysis.concerns),
      annualReportLinks: [...screenerArLinks, ...bseArLinks],
      metrics: {
        currentPrice: asNumber(quote.current_price),
        marketCapCr: asNumber(quote.market_cap_cr),
        peRatio: asNumber(keyMetrics.pe_ratio),
        pbRatio: asNumber(keyMetrics.pb_ratio),
        roePct: asNumber(keyMetrics.roe_pct),
        revenueGrowthPct: asNumber(keyMetrics.revenue_growth_pct),
        debtToEquity: asNumber(keyMetrics.debt_to_equity),
      },
      counts: {
        announcements: announcementsCount,
        corporateActions: asArray(nse.corporate_actions).length,
        insiderTrades: asArray(nse.insider_trading).length,
        quarterlyRows: asArray(screener.quarterly_results).length,
        shareholdingRows: asArray(screener.shareholding_pattern).length,
        historicalPriceRows: Object.keys(asRecord(yfinance.historical_prices)).length,
      },
      artifacts,
      raw: options?.includeRaw ? raw : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("NoSuchKey") || message.includes("NotFound") || message.includes("404")) {
      return null;
    }
    throw error;
  }
}
