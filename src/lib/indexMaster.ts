export type IndexCategory = "Broad Market" | "Sectoral" | "Thematic" | "Strategy";

export interface IndexRecord {
  index_id: string;
  index_symbol: string;
  index_name: string;
  category: IndexCategory;
  description: string;
  source: string;
  source_updated_at: number;
}

export interface IndexConstituent {
  index_id: string;
  index_symbol: string;
  stock_symbol: string;
  company_name: string;
  isin?: string; // ISIN/security_id
  index_weight?: number;
  market_cap?: number;
  free_float_market_cap?: number;
  sector?: string;
  industry?: string;
  effective_from?: number;
  effective_to?: number;
  source: string;
  source_updated_at: number;
}

export interface IndexDataProvider {
  getIndices(): Promise<IndexRecord[]>;
  getConstituents(index_id: string): Promise<IndexConstituent[]>;
}

export class IndexMaster {
  private indices: Map<string, IndexRecord> = new Map();
  private constituents: Map<string, IndexConstituent[]> = new Map();
  private provider: IndexDataProvider;
  private lastUpdate: number = 0;

  constructor(provider: IndexDataProvider) {
    this.provider = provider;
  }

  public async initialize() {
    const indicesList = await this.provider.getIndices();
    this.indices.clear();
    indicesList.forEach(idx => this.indices.set(idx.index_id, idx));

    // Try to load constituents for all indices
    this.constituents.clear();
    for (const idx of indicesList) {
      try {
        const idxConstituents = await this.provider.getConstituents(idx.index_id);
        this.constituents.set(idx.index_id, idxConstituents);
      } catch (e) {
        console.warn(`Failed to fetch constituents for ${idx.index_symbol}`);
        this.constituents.set(idx.index_id, []);
      }
    }
    this.lastUpdate = Date.now();
  }

  public getIndex(index_id: string): IndexRecord | undefined {
    return this.indices.get(index_id);
  }

  public getAllIndices(): IndexRecord[] {
    return Array.from(this.indices.values());
  }

  public getConstituents(index_id: string): IndexConstituent[] {
    return this.constituents.get(index_id) || [];
  }

  public getIndicesForStock(stock_symbol: string): IndexRecord[] {
    const result: IndexRecord[] = [];
    for (const [index_id, constituentList] of this.constituents.entries()) {
      if (constituentList.some(c => c.stock_symbol === stock_symbol)) {
        const idx = this.indices.get(index_id);
        if (idx) result.push(idx);
      }
    }
    return result;
  }

  public getUniqueStocks(): string[] {
    const unique = new Set<string>();
    for (const constituentList of this.constituents.values()) {
      for (const c of constituentList) {
        unique.add(c.stock_symbol);
      }
    }
    return Array.from(unique);
  }
}
