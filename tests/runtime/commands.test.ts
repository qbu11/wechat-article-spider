import { describe, expect, it } from "vitest";
import { resolveFeedUrlInput, selectArticleContent } from "../../packages/runtime/commands.js";

describe("read content selection", () => {
  const input = {
    article: {
      id: "one",
      title: "Article",
      contentHtml: "<style>.x{}</style><p>Hello&nbsp;<strong>WeChat</strong> &amp; agents</p>",
    },
    sources: [],
  };

  it("derives excerpts from direct WeChat HTML without returning the full body", () => {
    expect(selectArticleContent(input, "excerpt")).toEqual({
      article: { id: "one", title: "Article", excerpt: "Hello WeChat & agents" },
      sources: [],
    });
  });

  it("returns metadata without body fields", () => {
    expect(selectArticleContent(input, "metadata")).toEqual({
      article: { id: "one", title: "Article" },
      sources: [],
    });
  });
});

describe("subscription secret input", () => {
  const commandInput = (options: { argument?: string; stdin?: boolean }) => ({
    positionals: [],
    values: new Map(options.argument ? [["--feed-url", options.argument]] : []),
    flags: new Set(options.stdin ? ["--feed-url-stdin"] : []),
  });

  it("reads a private feed URL from stdin without requiring it in argv", async () => {
    const input = commandInput({ stdin: true });
    await expect(resolveFeedUrlInput(input, async () => "https://example.com/feed?token=secret\n"))
      .resolves.toBe("https://example.com/feed?token=secret");
  });

  it("rejects ambiguous or empty feed URL input", async () => {
    await expect(resolveFeedUrlInput(
      { ...commandInput({ argument: "https://example.com/feed" }), flags: new Set(["--feed-url-stdin"]) },
      async () => "https://example.com/other",
    )).rejects.toThrow("exactly one");
    await expect(resolveFeedUrlInput(commandInput({ stdin: true }), async () => "\n"))
      .rejects.toThrow("empty feed URL");
  });
});
