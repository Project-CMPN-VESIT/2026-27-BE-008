import os
import sys
from dotenv import load_dotenv

# Add scrapper to sys.path
sys.path.insert(0, os.path.abspath("scrapper"))

load_dotenv()

from screener.ingestion.yahoo import YahooDataProvider
from screener.ingestion.pipeline import ScreenerPipeline

nifty50_symbols = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "BHARTIARTL.NS",
    "INFY.NS", "SBIN.NS", "LICI.NS", "ITC.NS", "HINDUNILVR.NS",
    "LT.NS", "BAJFINANCE.NS", "HCLTECH.NS", "MARUTI.NS", "SUNPHARMA.NS",
    "ADANIENT.NS", "KOTAKBANK.NS", "TATAMOTORS.NS", "ONGC.NS", "NTPC.NS",
    "AXISBANK.NS", "POWERGRID.NS", "TITAN.NS", "WIPRO.NS", "COALINDIA.NS",
    "BAJAJFINSV.NS", "ULTRACEMCO.NS", "ADANIPORTS.NS", "M&M.NS", "ASIANPAINT.NS",
    "JSWSTEEL.NS", "TATASTEEL.NS", "GRASIM.NS", "TECHM.NS", "HINDALCO.NS",
    "NESTLEIND.NS", "BPCL.NS", "CIPLA.NS", "EICHERMOT.NS", "HEROMOTOCO.NS",
    "BRITANNIA.NS", "TATACONSUM.NS", "SBILIFE.NS", "HDFCLIFE.NS", "APOLLOHOSP.NS",
    "SHRIRAMFIN.NS", "DRREDDY.NS", "DIVISLAB.NS", "BEL.NS", "TRENT.NS"
]

print(f"Starting ingestion of {len(nifty50_symbols)} Nifty 50 symbols...")
provider = YahooDataProvider()
pipeline = ScreenerPipeline(provider)
pipeline.run_daily_ingestion(nifty50_symbols)

# Sync to SQLite local as well for offline backup
from screener.db.session import SessionLocal
from screener.db.models import Company, DerivedMetrics
db = SessionLocal()
print(f"Total companies in DB: {db.query(Company).count()}")
print(f"Total derived metrics in DB: {db.query(DerivedMetrics).count()}")
db.close()
