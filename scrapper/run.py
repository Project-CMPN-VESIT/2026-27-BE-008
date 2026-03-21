"""
CLI entry point for manually running the sanctions scraper system.

Usage:
    python run.py scrape                    # Scrape all active sources
    python run.py scrape --source rbi       # Scrape RBI only
    python run.py scrape --source un        # Scrape UN only
    python run.py scrape --source rbi --max 5   # Scrape only 5 RBI circulars
    python run.py extract                   # Run AI extraction on unprocessed records
    python run.py extract --max 10          # Extract up to 10 records
    python run.py serve                     # Start the FastAPI screening API
    python run.py stats                     # Show database stats
"""

import os
import sys
import json
import argparse
import logging
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add project root to path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)

# Setup logging
LOG_DIR = os.path.join(PROJECT_ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            os.path.join(LOG_DIR, f"scraper_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
            encoding="utf-8",
        ),
    ],
)
logger = logging.getLogger("run")


def init_sources(db):
    """Initialize source registry from config file."""
    config_path = os.path.join(PROJECT_ROOT, "config", "sources.json")
    with open(config_path, "r") as f:
        config = json.load(f)

    for source in config["sources"]:
        db.upsert_source(
            source_id=source["source_id"],
            name=source["name"],
            url=source["url"],
            format_type=source["format_type"],
            publishing_body=source["publishing_body"],
            active=source.get("active", True),
        )
    logger.info(f"Initialized {len(config['sources'])} sources from config")


def cmd_scrape(args):
    """Run scrapers."""
    from db.database import Database
    db = Database()
    init_sources(db)

    source = args.source
    max_circulars = args.max

    if source in (None, "all", "rbi"):
        logger.info("=" * 60)
        logger.info("SCRAPING: RBI Standalone Circulars")
        logger.info("=" * 60)
        from scrapers.rbi_scraper import scrape_all as scrape_rbi
        result = scrape_rbi(db, max_circulars=max_circulars)
        logger.info(f"RBI Result: {json.dumps(result, indent=2, default=str)}")

    if source in (None, "all", "un"):
        logger.info("=" * 60)
        logger.info("SCRAPING: UN Sanctions Consolidated List")
        logger.info("=" * 60)
        from scrapers.un_scraper import scrape_all as scrape_un
        result = scrape_un(db)
        logger.info(f"UN Result: {json.dumps(result, indent=2, default=str)}")

    logger.info("Scraping complete!")


def cmd_extract(args):
    """Run AI extraction on unprocessed RBI records."""
    from db.database import Database
    from extraction.mistral_extractor import process_unprocessed_records

    db = Database()
    max_records = args.max

    logger.info("=" * 60)
    logger.info("AI EXTRACTION: Processing unprocessed RBI records")
    logger.info("=" * 60)

    result = process_unprocessed_records(db, max_records=max_records)
    logger.info(f"Extraction Result: {json.dumps(result, indent=2, default=str)}")


def cmd_serve(args):
    """Start the FastAPI screening server."""
    import uvicorn

    host = args.host or "0.0.0.0"
    port = args.port or 8000

    logger.info(f"Starting screening API on {host}:{port}")
    logger.info(f"Docs available at http://localhost:{port}/docs")

    uvicorn.run(
        "api.main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


def cmd_stats(args):
    """Show database statistics."""
    from db.database import Database
    db = Database()

    entity_count = db.get_entity_count()
    source_stats = db.get_source_stats()

    print("\n" + "=" * 60)
    print("  SANCTIONS DATABASE STATISTICS")
    print("=" * 60)
    print(f"\n  Total Entities: {entity_count}")
    print(f"\n  Sources:")
    for s in source_stats:
        print(f"    - {s['name']}: {s['entity_count']} entities")
        print(f"      Last scraped: {s.get('last_scraped_at', 'Never')}")
    print("\n" + "=" * 60)


def cmd_pipeline(args):
    """Run full pipeline: scrape → extract → show stats."""
    cmd_scrape(args)
    cmd_extract(args)
    cmd_stats(args)


def main():
    parser = argparse.ArgumentParser(
        description="Regulatory Sanctions Scraper System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run.py scrape                    Scrape all sources
  python run.py scrape --source rbi       Scrape RBI circulars only
  python run.py scrape --source un        Scrape UN sanctions list only
  python run.py scrape --source rbi --max 5  Scrape only first 5 RBI circulars
  python run.py extract                   Run AI extraction on new records
  python run.py extract --max 10          Extract up to 10 records
  python run.py serve                     Start the screening API server
  python run.py stats                     Show database statistics
  python run.py pipeline --source rbi --max 5  Full pipeline: scrape + extract + stats
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # scrape command
    scrape_parser = subparsers.add_parser("scrape", help="Run scrapers")
    scrape_parser.add_argument("--source", choices=["rbi", "un", "all"], default="all",
                                help="Which source to scrape")
    scrape_parser.add_argument("--max", type=int, default=None,
                                help="Max number of circulars to scrape (RBI only)")

    # extract command
    extract_parser = subparsers.add_parser("extract", help="Run AI extraction")
    extract_parser.add_argument("--max", type=int, default=None,
                                 help="Max records to process")

    # serve command
    serve_parser = subparsers.add_parser("serve", help="Start API server")
    serve_parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    serve_parser.add_argument("--port", type=int, default=8000, help="Port to listen on")

    # stats command
    subparsers.add_parser("stats", help="Show database stats")

    # pipeline command (scrape + extract + stats)
    pipeline_parser = subparsers.add_parser("pipeline", help="Full pipeline: scrape + extract + stats")
    pipeline_parser.add_argument("--source", choices=["rbi", "un", "all"], default="all")
    pipeline_parser.add_argument("--max", type=int, default=None)

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        return

    commands = {
        "scrape": cmd_scrape,
        "extract": cmd_extract,
        "serve": cmd_serve,
        "stats": cmd_stats,
        "pipeline": cmd_pipeline,
    }

    try:
        commands[args.command](args)
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.exception(f"Command failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
