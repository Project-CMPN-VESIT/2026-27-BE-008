import { NextRequest, NextResponse } from "next/server";
import { getDocScrapperStockData } from "@/lib/doc-scrapper-s3";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
  const includeRaw = (request.nextUrl.searchParams.get("includeRaw") ?? "").toLowerCase() === "true";

  if (!symbol) {
    return NextResponse.json(
      {
        ok: false,
        error: "symbol is required",
      },
      {
        status: 400,
        headers: noStoreHeaders,
      }
    );
  }

  try {
    const docsData = await getDocScrapperStockData(symbol, { includeRaw });

    if (!docsData) {
      return NextResponse.json(
        {
          ok: true,
          data: {
            symbol,
            available: false,
            message: "No doc_scrapper payload found in S3 for this symbol yet.",
          },
        },
        {
          status: 200,
          headers: noStoreHeaders,
        }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        data: docsData,
      },
      {
        status: 200,
        headers: noStoreHeaders,
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to fetch stock doc data from S3",
      },
      {
        status: 500,
        headers: noStoreHeaders,
      }
    );
  }
}
