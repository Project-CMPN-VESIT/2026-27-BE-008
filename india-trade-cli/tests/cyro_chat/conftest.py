"""Isolate the chat store in a temp SQLite file before any cyro_chat module is imported."""

import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="cyro_chat_test_")
os.environ["CYRO_CHAT_DATA_DIR"] = _tmp
os.environ["CYRO_CHAT_DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "chat.db").replace("\\", "/")
os.environ["BASKETS_DATA_DIR"] = _tmp
os.environ["BASKETS_DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp, "baskets.db").replace("\\", "/")
os.environ["BASKETS_AUTO_REFRESH"] = "0"

import pytest  # noqa: E402

from cyro_chat import store  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_store():
    store.Base.metadata.drop_all(store.engine)
    store.init_db()
    yield
    store.Base.metadata.drop_all(store.engine)
