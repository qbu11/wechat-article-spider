import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = join(process.cwd(), "packages", "cli", "cli.ts");
const temporaryDirectories: string[] = [];

async function runQuery(...args: string[]) {
  const dataDir = await mkdtemp(join(tmpdir(), "wechat-cli-query-"));
  temporaryDirectories.push(dataDir);
  return execFileAsync(process.execPath, ["--import", "tsx", cliPath, "query", ...args, "--json"], {
    env: { ...process.env, WECHAT_AGENT_DATA_DIR: dataDir },
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("query CLI intent contract", () => {
  it("returns a keyword-search envelope without a network request in local scope", async () => {
    const { stdout } = await runQuery("--keywords", "AI agent", "--scope", "local", "--limit", "3");
    const value = JSON.parse(stdout) as { success: boolean; data: Record<string, unknown> };
    expect(value).toMatchObject({
      success: true,
      data: {
        intent: { kind: "keyword-search", keywords: "AI agent", account: null },
        mode: "fast-links",
        scope: "local",
        count: 0,
        articles: [],
      },
    });
  });

  it("returns an account-window with inclusive normalized dates", async () => {
    const { stdout } = await runQuery(
      "--account",
      "示例号",
      "--after",
      "2026-08-01",
      "--before",
      "2026-08-15",
      "--scope",
      "local",
    );
    expect(JSON.parse(stdout)).toMatchObject({
      success: true,
      data: {
        intent: {
          kind: "account-window",
          account: "示例号",
          after: "2026-08-01T00:00:00.000Z",
          before: "2026-08-15T23:59:59.999Z",
        },
      },
    });
  });

  it("rejects an inverted time window before querying", async () => {
    const outcome = await runQuery(
      "--account",
      "示例号",
      "--after",
      "2026-08-16",
      "--before",
      "2026-08-15",
      "--scope",
      "local",
    ).then(
      () => ({ ok: true as const }),
      (cause: unknown) => ({ ok: false as const, error: cause as { code: number; stderr: string } }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Expected query to fail");
    expect(outcome.error.code).toBe(1);
    expect(JSON.parse(outcome.error.stderr.trim().split("\n").at(-1)!)).toEqual({
      success: false,
      error: "--after must not be later than --before",
    });
  });
});
