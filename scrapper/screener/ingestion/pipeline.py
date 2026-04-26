import logging
from typing import List
from .base import BaseIngestionPipeline, DataProvider
from ..db.session import SessionLocal
from ..db.models import Company, DerivedMetrics, FinancialStatement

logger = logging.getLogger(__name__)

class ScreenerPipeline(BaseIngestionPipeline):
    def run_daily_ingestion(self, symbols: List[str]):
        """Run daily ingestion for given symbols."""
        db = SessionLocal()
        try:
            for symbol in symbols:
                logger.info(f"Ingesting {symbol}...")
                
                # 1. Fetch Metrics
                metrics_data = self.get_metrics(symbol)
                if not metrics_data:
                    logger.warning(f"No metrics found for {symbol}. Skipping.")
                    continue
                
                # 2. Data Quality / Quarantine Checks
                quality_score = 100
                if metrics_data.get('pe_ttm') is None:
                    quality_score -= 10
                if metrics_data.get('market_cap') is None:
                    quality_score -= 20
                    
                # 3. Upsert Company
                company = db.query(Company).filter(Company.symbol == symbol).first()
                if not company:
                    company = Company(symbol=symbol, name=symbol, data_quality_score=quality_score)
                    db.add(company)
                else:
                    company.data_quality_score = quality_score
                    
                # 4. Upsert Derived Metrics
                derived = db.query(DerivedMetrics).filter(DerivedMetrics.symbol == symbol).first()
                if not derived:
                    derived = DerivedMetrics(symbol=symbol, **metrics_data)
                    db.add(derived)
                else:
                    for k, v in metrics_data.items():
                        setattr(derived, k, v)
                
                # Commit per symbol to avoid bulk failures
                db.commit()
                
        except Exception as e:
            logger.error(f"Ingestion failed: {e}")
            db.rollback()
        finally:
            db.close()
