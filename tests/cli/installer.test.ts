import { mkdtemp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { install, planInstall, uninstall, type InstallOptions } from "../../packages/cli/installer.js";

async function fixturePackage(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wechat-agent-package-"));
  await mkdir(join(root, "skills", "wechat-search"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}\n");
  await writeFile(join(root, "skills", "wechat-search", "SKILL.md"), "---\nname: wechat-search\ndescription: Search.\n---\n");
  return root;
}

describe("installer", () => {
  it("plans exact writes without mutating the target", async () => {
    const packageRoot = await fixturePackage();
    const home = await mkdtemp(join(tmpdir(), "wechat-agent-home-"));
    const operations = await planInstall({
      agents: ["claude-code", "codex"],
      scope: "user",
      dryRun: true,
      yes: false,
      packageRoot,
      userHome: home,
    });
    expect(operations).toHaveLength(2);
    await expect(readFile(join(home, ".claude", "skills", "wechat-search", "SKILL.md"))).rejects.toThrow();
  });

  it("installs atomically and preserves user modifications on uninstall", async () => {
    const packageRoot = await fixturePackage();
    const home = await mkdtemp(join(tmpdir(), "wechat-agent-home-"));
    const dataDir = await mkdtemp(join(tmpdir(), "wechat-agent-data-"));
    const options: InstallOptions = {
      agents: ["generic"],
      scope: "user" as const,
      dryRun: false,
      yes: true,
      packageRoot,
      userHome: home,
      dataDir,
    };
    await install(options);
    const target = join(home, ".agents", "skills", "wechat-search", "SKILL.md");
    expect(await readFile(target, "utf8")).toContain("name: wechat-search");
    await writeFile(target, "user change\n");
    const result = await uninstall(options);
    expect(result[0]?.action).toBe("skip");
    expect(await readFile(target, "utf8")).toBe("user change\n");
    const manifest = JSON.parse(await readFile(join(dataDir, "ownership.json"), "utf8")) as {
      files: Array<{ path: string }>;
    };
    expect(manifest.files.map((file) => file.path)).toEqual([
      join(home, ".agents", "skills", "wechat-search"),
    ]);
  });

  it("uninstalls only the requested agent and scope", async () => {
    const packageRoot = await fixturePackage();
    const project = await mkdtemp(join(tmpdir(), "wechat-agent-project-"));
    const dataDir = await mkdtemp(join(tmpdir(), "wechat-agent-data-"));
    const options: InstallOptions = {
      agents: ["claude-code", "codex", "generic"],
      scope: "project",
      dryRun: false,
      yes: true,
      packageRoot,
      cwd: project,
      dataDir,
    };
    await install(options);

    const genericTarget = join(project, ".agents", "skills", "wechat-search", "SKILL.md");
    const claudeTarget = join(project, ".claude", "skills", "wechat-search", "SKILL.md");
    const codexTarget = join(project, ".codex", "skills", "wechat-search", "SKILL.md");
    await uninstall({ ...options, agents: ["generic"] });

    await expect(readFile(genericTarget, "utf8")).rejects.toThrow();
    expect(await readFile(claudeTarget, "utf8")).toContain("name: wechat-search");
    expect(await readFile(codexTarget, "utf8")).toContain("name: wechat-search");
    const manifest = JSON.parse(await readFile(join(dataDir, "ownership.json"), "utf8")) as {
      files: Array<{ agent: string }>;
    };
    expect(manifest.files.map((file) => file.agent).sort()).toEqual(["claude-code", "codex"]);
  });

  it("merges ownership across separate agent and scope installs", async () => {
    const packageRoot = await fixturePackage();
    const home = await mkdtemp(join(tmpdir(), "wechat-agent-home-"));
    const project = await mkdtemp(join(tmpdir(), "wechat-agent-project-"));
    const dataDir = await mkdtemp(join(tmpdir(), "wechat-agent-data-"));

    await install({
      agents: ["codex"],
      scope: "user",
      dryRun: false,
      yes: true,
      packageRoot,
      userHome: home,
      dataDir,
    });
    await install({
      agents: ["generic"],
      scope: "project",
      dryRun: false,
      yes: true,
      packageRoot,
      cwd: project,
      dataDir,
    });

    const manifest = JSON.parse(await readFile(join(dataDir, "ownership.json"), "utf8")) as {
      files: Array<{ agent: string; scope: string }>;
    };
    expect(manifest.files.map((file) => `${file.agent}:${file.scope}`).sort()).toEqual([
      "codex:user",
      "generic:project",
    ]);

    await uninstall({ agents: ["codex"], scope: "user", dryRun: false, yes: true, userHome: home, dataDir });
    await uninstall({ agents: ["generic"], scope: "project", dryRun: false, yes: true, cwd: project, dataDir });
    await expect(readFile(join(home, ".codex", "skills", "wechat-search", "SKILL.md"))).rejects.toThrow();
    await expect(readFile(join(project, ".agents", "skills", "wechat-search", "SKILL.md"))).rejects.toThrow();
  });

  it("detects framed filename/content changes that previously collided", async () => {
    const packageRoot = await fixturePackage();
    const home = await mkdtemp(join(tmpdir(), "wechat-agent-home-"));
    const dataDir = await mkdtemp(join(tmpdir(), "wechat-agent-data-"));
    const options: InstallOptions = {
      agents: ["generic"],
      scope: "user",
      dryRun: false,
      yes: true,
      packageRoot,
      userHome: home,
      dataDir,
    };
    await install(options);
    const targetRoot = join(home, ".agents", "skills", "wechat-search");
    const original = await readFile(join(targetRoot, "SKILL.md"), "utf8");
    await rename(join(targetRoot, "SKILL.md"), join(targetRoot, "SKILL.m"));
    await writeFile(join(targetRoot, "SKILL.m"), `d${original}`);

    const operations = await uninstall(options);
    expect(operations).toEqual([
      expect.objectContaining({ action: "skip", target: targetRoot }),
    ]);
    expect(await readFile(join(targetRoot, "SKILL.m"), "utf8")).toBe(`d${original}`);
  });

  it("treats added empty directories as user modifications", async () => {
    const packageRoot = await fixturePackage();
    const home = await mkdtemp(join(tmpdir(), "wechat-agent-home-"));
    const dataDir = await mkdtemp(join(tmpdir(), "wechat-agent-data-"));
    const options: InstallOptions = {
      agents: ["generic"],
      scope: "user",
      dryRun: false,
      yes: true,
      packageRoot,
      userHome: home,
      dataDir,
    };
    await install(options);
    const targetRoot = join(home, ".agents", "skills", "wechat-search");
    await mkdir(join(targetRoot, "user-empty-directory"));

    const operations = await uninstall(options);
    expect(operations[0]?.action).toBe("skip");
    expect(await readFile(join(targetRoot, "SKILL.md"), "utf8")).toContain("name: wechat-search");
  });
});
