from pathlib import Path

from wechat_article_spider import cli


def test_legacy_skill_installer_uses_cli_only_skill(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

    assert cli.cmd_install_skill(None) == 0
    installed = tmp_path / ".claude" / "skills" / "wechat-article-spider" / "SKILL.md"
    source = installed.read_text(encoding="utf-8")
    assert "name: wechat-article-spider" in source
    assert "wechat-spider scrape" in source
    assert "Chrome DevTools" not in source
