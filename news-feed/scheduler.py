from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler  # type: ignore[reportMissingImports]

from database import insert_announcement
from scrapers.bse import fetch_bse_announcements
from scrapers.nse import fetch_nse_announcements

_scheduler = None


def _poll_announcements():
    nse_items = fetch_nse_announcements()
    bse_items = fetch_bse_announcements()

    new_count = 0
    for item in nse_items + bse_items:
        try:
            if insert_announcement(item):
                new_count += 1
        except Exception as exc:
            print(f"[news-feed] Insert error: {exc}")

    print(f"[news-feed] NSE: {len(nse_items)} BSE: {len(bse_items)} New: {new_count}")


def start_scheduler():
    global _scheduler

    if _scheduler and _scheduler.running:
        return

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        _poll_announcements,
        "interval",
        seconds=60,
        id="news-feed-poll",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(),
    )
    _scheduler.start()
