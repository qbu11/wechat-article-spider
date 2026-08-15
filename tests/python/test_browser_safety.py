from wechat_article_spider.spider.wechat import login as login_module


class FakeOptions:
    def __init__(self):
        self.arguments = []
        self.port = None
        self.user_data_path = None

    def set_user_data_path(self, value):
        self.user_data_path = value

    def set_local_port(self, value):
        self.port = value

    def set_argument(self, value):
        self.arguments.append(value)

    def no_imgs(self, _value):
        return None

    def set_user_agent(self, _value):
        return None


def test_chrome_options_are_loopback_and_keep_sandbox(monkeypatch):
    monkeypatch.setattr(login_module, "ChromiumOptions", FakeOptions)
    login = login_module.WeChatSpiderLogin(cache_file="unused", debug_port=19444)

    options = login._setup_chrome_options()

    assert options.port == 19444
    assert "--remote-debugging-address=127.0.0.1" in options.arguments
    assert "--remote-allow-origins=*" not in options.arguments
    assert "--no-sandbox" not in options.arguments
    assert "--disable-blink-features=AutomationControlled" not in options.arguments


def test_legacy_process_cleanup_hook_never_runs_system_killers(monkeypatch):
    login = login_module.WeChatSpiderLogin(cache_file="unused")
    login._created_browser = True

    # The compatibility hook is deliberately a no-op and must not need a
    # subprocess module or inspect unrelated operating-system processes.
    assert not hasattr(login_module, "subprocess")
    assert login._cleanup_chrome_processes() is None
