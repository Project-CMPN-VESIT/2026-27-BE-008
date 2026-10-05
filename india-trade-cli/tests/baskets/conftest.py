"""
Point the baskets engine at a throwaway SQLite file BEFORE any baskets module is imported
(baskets.db reads its URL at import time), so tests never touch real data.
"""

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="baskets_test_")
os.environ["BASKETS_DATA_DIR"] = _tmp
os.environ["BASKETS_DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "test.db").replace("\\", "/")
os.environ["BASKETS_AUTO_REFRESH"] = "0"
