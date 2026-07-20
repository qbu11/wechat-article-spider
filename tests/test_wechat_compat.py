from wechat_article_spider.spider.wechat import utils
from wechat_article_spider.spider.wechat.login import (
    WeChatSpiderLogin,
    authenticated_home_url,
    cookies_to_dict,
)


def test_cookies_to_dict_accepts_current_drissionpage_shape():
    cookies = [
        {"name": "session", "value": "secret", "domain": ".example.com"},
        {"name": "lang", "value": "zh_CN", "domain": ".example.com"},
    ]
    assert cookies_to_dict(cookies) == {"session": "secret", "lang": "zh_CN"}


def test_cookies_to_dict_keeps_legacy_dict_shape():
    cookies = {"session": "secret"}
    assert cookies_to_dict(cookies) == cookies


def test_authenticated_home_url_requires_exact_wechat_host_and_token():
    assert authenticated_home_url("https://mp.weixin.qq.com/wxamp/home/guide?token=123")
    assert not authenticated_home_url("https://mp.weixin.qq.com/cgi-bin/loginpage?token=123")
    assert not authenticated_home_url("https://mp.weixin.qq.com.evil.example/home?token=123")
    assert not authenticated_home_url("http://mp.weixin.qq.com/wxamp/home/guide?token=123")
    assert not authenticated_home_url("https://mp.weixin.qq.com/wxamp/home/guide")


def test_get_fakid_returns_empty_list_when_search_api_has_no_list(monkeypatch):
    class Response:
        @staticmethod
        def json():
            return {"base_resp": {"ret": 200002, "err_msg": "invalid args"}}

    monkeypatch.setattr(utils.requests, "get", lambda *_args, **_kwargs: Response())
    assert utils.get_fakid({}, "token", "量子位") == []


def test_validate_cache_accepts_authenticated_home_when_search_probe_is_unavailable(
    monkeypatch, tmp_path
):
    class Response:
        status_code = 200

        def __init__(self, payload=None, url=""):
            self.payload = payload
            self.url = url

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    responses = iter(
        [
            Response({"base_resp": {"ret": 200002}}),
            Response(url="https://mp.weixin.qq.com/wxamp/home/guide?token=123"),
        ]
    )
    monkeypatch.setattr(
        "wechat_article_spider.spider.wechat.login.requests.get",
        lambda *_args, **_kwargs: next(responses),
    )
    login = WeChatSpiderLogin(cache_file=tmp_path / "cache.json")
    login.token = "123"
    login.cookies = {"session": "secret"}

    assert login.validate_cache() is True
