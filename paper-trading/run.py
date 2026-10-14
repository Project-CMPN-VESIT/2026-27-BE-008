import uvicorn
import logging
import os

logging.basicConfig(level=logging.INFO)

if __name__ == "__main__":
    # Only the Next.js server should reach this service; keep it off public interfaces by default.
    uvicorn.run("main:app", host=os.getenv("PAPER_TRADING_HOST", "127.0.0.1"), port=8001, reload=True)
