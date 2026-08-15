import json
import os
import stat

import pytest

from wechat_article_spider.spider.wechat.cache_codec import (
    EncodeError,
    decode_to_cache_file,
    encode_cache_data,
    encode_cache_file,
)
from wechat_article_spider.spider.wechat.login import WeChatSpiderLogin


def _credential():
    return {
        "token": "redacted-token",
        "cookies": {
            "slave_sid": "redacted-sid",
            "slave_user": "redacted-user",
            "data_ticket": "redacted-ticket",
        },
        "timestamp": 1700000000.0,
    }


@pytest.mark.skipif(os.name == "nt", reason="POSIX mode bits do not model Windows ACLs")
def test_login_cache_is_owner_only(tmp_path):
    cache_file = tmp_path / "private" / "cache.json"
    login = WeChatSpiderLogin(cache_file=cache_file)
    login.token = _credential()["token"]
    login.cookies = _credential()["cookies"]

    assert login.save_cache() is True
    assert stat.S_IMODE(cache_file.stat().st_mode) == 0o600
    assert stat.S_IMODE(cache_file.parent.stat().st_mode) == 0o700


def test_legacy_export_is_disabled_by_default(tmp_path):
    cache_file = tmp_path / "cache.json"
    cache_file.write_text(json.dumps(_credential()), encoding="utf-8")

    with pytest.raises(EncodeError, match="默认关闭"):
        encode_cache_file(str(cache_file))

    with pytest.raises(EncodeError, match="默认关闭"):
        encode_cache_data(_credential())

    encoded = encode_cache_file(str(cache_file), allow_insecure=True)
    assert encoded.startswith("WC01")


@pytest.mark.skipif(os.name == "nt", reason="POSIX mode bits do not model Windows ACLs")
def test_legacy_import_restricts_cache_and_backup_permissions(tmp_path):
    cache_file = tmp_path / "cache.json"
    cache_file.write_text(json.dumps(_credential()), encoding="utf-8")
    encoded = encode_cache_data(_credential(), allow_insecure=True)

    decode_to_cache_file(encoded, str(cache_file))

    assert stat.S_IMODE(cache_file.stat().st_mode) == 0o600
    assert stat.S_IMODE((tmp_path / "cache.json.backup").stat().st_mode) == 0o600
