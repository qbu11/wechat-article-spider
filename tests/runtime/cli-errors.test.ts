import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = join(process.cwd(), "packages", "cli", "cli.ts");
const temporaryDirectories: string[] = [];

async function runCli(...args: string[]): Promise<{ exitCode: number; stderr: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "wechat-cli-error-"));
  temporaryDirectories.push(dataDir);
  try {
    await execFileAsync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      env: { ...process.env, WECHAT_AGENT_DATA_DIR: dataDir },
    });
    return { exitCode: 0, stderr: "" };
  } catch (error) {
    const failure = error as { code?: number; stderr?: string };
    return { exitCode: failure.code ?? -1, stderr: failure.stderr ?? "" };
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("CLI error JSON", () => {
  it("exposes ConnectorError classification fields", async () => {
    const result = await runCli("read", "--url", "http://mp.weixin.qq.com/s/example", "--json");
    expect(result.exitCode).toBe(1);
    const jsonLine = result.stderr.trim().split("\n").at(-1)!;
    expect(JSON.parse(jsonLine)).toEqual({
      success: false,
      error: "Direct WeChat connector accepts only https://mp.weixin.qq.com article URLs",
      code: "INVALID_INPUT",
      retryable: false,
      needsUserAction: false,
    });
  });

  it("keeps the legacy shape for ordinary errors", async () => {
    const result = await runCli("unknown-command");
    expect(result.exitCode).toBe(1);
    const jsonLine = result.stderr.trim().split("\n").at(-1)!;
    expect(JSON.parse(jsonLine)).toEqual({
      success: false,
      error: "Unknown command: unknown-command",
    });
  });

  it("rejects unsupported read content levels before fetching", async () => {
    const result = await runCli(
      "read",
      "--url",
      "https://mp.weixin.qq.com/s/example",
      "--content",
      "summary",
      "--json",
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr.trim().split("\n").at(-1)!)).toEqual({
      success: false,
      error: "Unsupported content level: summary",
    });
  });
});
