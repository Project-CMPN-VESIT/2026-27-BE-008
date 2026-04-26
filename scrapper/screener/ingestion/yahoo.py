import yfinance as yf
from typing import Dict, Any, Optional
from .base import DataProvider
import logging

logger = logging.getLogger(__name__)

class YahooDataProvider(DataProvider):
    def fetch_metrics(self, symbol: str) -> Optional[Dict[str, Any]]:
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            
            # Map yfinance keys to our schema
            # Some keys like returnOnEquity come as decimal (e.g. 0.15), some might come as percentage depending on the field.
            roe = info.get("returnOnEquity")
            div_yield = info.get("dividendYield")
            
            # Data Quarantine: Ensure we have the absolute minimum core data
            market_cap = info.get("marketCap")
            current_price = info.get("currentPrice")
            pe_ttm = info.get("trailingPE")
            
            if not market_cap or not current_price:
                logger.warning(f"QUARANTINED {symbol}: Missing critical core metrics (Price or Market Cap). Payload dropped.")
                return None

            return {
                "market_cap": market_cap,
                "pe_ttm": pe_ttm,
                "pb": info.get("priceToBook"),
                "roe": roe * 100 if roe and roe < 10 else roe, # safety check if it's already a percentage
                "roce": None, # yfinance usually lacks ROCE directly
                "debt_equity": info.get("debtToEquity") / 100 if info.get("debtToEquity") else None,
                "dividend_yield": div_yield,
                "sales_growth_5y": None,
                "profit_growth_5y": None,
                "current_price": current_price,
                "high_52w": info.get("fiftyTwoWeekHigh"),
                "low_52w": info.get("fiftyTwoWeekLow")
            }
        except Exception as e:
            logger.error(f"YahooFinance fetch failed for {symbol}: {e}")
            return None
            
    def fetch_financial_statement(self, symbol: str, period_type: str) -> Optional[Dict[str, Any]]:
        try:
            ticker = yf.Ticker(symbol)
            if period_type == 'ANNUAL':
                df = ticker.financials
            else:
                df = ticker.quarterly_financials
                
            if df is None or df.empty:
                return None
            
            # Return raw JSON dump of the dataframe
            # It has dates as columns. We will take the most recent column for now
            latest_date = df.columns[0]
            latest_data = df[latest_date].to_dict()
            return {"date": latest_date.isoformat(), "data": latest_data}
        except Exception as e:
            logger.error(f"YahooFinance statement fetch failed for {symbol}: {e}")
            return None
