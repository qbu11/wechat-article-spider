import json
from pathlib import Path

import pytest

from wechat_article_spider.spider.wechat import utils


FIXTURE_DIR = Path(__file__).parents[1] / "fixtures"


def _expectations():
    return json.loads((FIXTURE_DIR / "article_expectations.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("fixture_name, expected", _expectations().items())
def test_parse_article_html_matches_golden_contract(fixture_name, expected):
    html = (FIXTURE_DIR / fixture_name).read_text(encoding="utf-8")
    result = utils.parse_article_html(html)

    assert result.status == expected["status"]
    assert result.article_type == expected["article_type"]
    assert result.error == expected.get("error")
    for fragment in expected.get("contains", []):
        assert fragment in result.content


@pytest.mark.parametrize(
    "fixture_name, expected_error",
    [
        ("article_blocked.html", "获取文章内容失败: 页面访问受限"),
        ("article_expired.html", "获取文章内容失败: 文章已删除、屏蔽或过期"),
    ],
)
def test_legacy_get_article_content_does_not_index_error_page(
    monkeypatch, fixture_name, expected_error
):
    class Response:
        status_code = 200
        text = (FIXTURE_DIR / fixture_name).read_text(encoding="utf-8")

    monkeypatch.setattr(utils.requests, "get", lambda *_args, **_kwargs: Response())
    assert utils.get_article_content("https://mp.weixin.qq.com/s/redacted", {}) == expected_error


def test_access_control_words_inside_a_real_article_do_not_create_false_block():
    result = utils.parse_article_html(
        '<div id="js_content">本文讨论“访问过于频繁”错误的排查流程和解决办法。</div>'
    )
    assert result.status == "ok"
    assert result.article_type == "normal"
