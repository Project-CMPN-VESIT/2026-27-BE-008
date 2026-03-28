import logging
import uvicorn

from database import init_db
from scheduler import start_scheduler

logging.basicConfig(level=logging.INFO)

if __name__ == "__main__":
    init_db()
    start_scheduler()
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=False)
