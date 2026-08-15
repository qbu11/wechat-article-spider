import os
import stat

import pytest

from wechat_article_spider.spider.wechat.paths import secure_json_write


@pytest.mark.skipif(os.name == "nt", reason="POSIX mode bits do not model Windows ACLs")
def test_custom_existing_parent_permissions_are_not_changed(tmp_path):
    custom_parent = tmp_path / "shared-project"
    custom_parent.mkdir(mode=0o755)
    custom_parent.chmod(0o755)

    secure_json_write(str(custom_parent / "cache.json"), {"secret": "redacted"})

    assert stat.S_IMODE(custom_parent.stat().st_mode) == 0o755
    assert stat.S_IMODE((custom_parent / "cache.json").stat().st_mode) == 0o600
