const DEFAULT_SCREENER_API_BASE_URL = "http://localhost:8003";

export const SCREENER_API_BASE_URL =
  process.env.NEXT_PUBLIC_SCREENER_API_URL ?? DEFAULT_SCREENER_API_BASE_URL;

export function screenerApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SCREENER_API_BASE_URL}${normalizedPath}`;
}
