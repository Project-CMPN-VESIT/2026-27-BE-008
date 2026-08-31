import { IndexRecord, IndexConstituent } from "./indexMaster";
import indexMasterJson from "../data/heatmap/indexMaster.json";
import indexConstituentsJson from "../data/heatmap/indexConstituents.json";

export class StaticIndexProvider {
  public async getIndices(): Promise<IndexRecord[]> {
    return indexMasterJson as IndexRecord[];
  }

  public async getConstituents(index_id: string): Promise<IndexConstituent[]> {
    return (indexConstituentsJson as IndexConstituent[]).filter(c => c.index_id === index_id);
  }
}
