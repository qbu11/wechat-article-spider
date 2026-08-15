import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type InstallScope = "user" | "project";
export type AgentTarget = "claude-code" | "codex" | "generic";

export function appDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WECHAT_AGENT_DATA_DIR) return resolve(env.WECHAT_AGENT_DATA_DIR);
  if (platform() === "win32") {
    return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "wechat-agent-kit");
  }
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "wechat-agent-kit");
  }
  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "wechat-agent-kit");
}

export function skillTargetRoot(
  agent: AgentTarget,
  scope: InstallScope,
  cwd = process.cwd(),
  userHome = homedir(),
): string {
  const base = scope === "project" ? cwd : userHome;
  switch (agent) {
    case "claude-code":
      return join(base, ".claude", "skills");
    case "codex":
      return join(base, ".codex", "skills");
    case "generic":
      return join(base, ".agents", "skills");
  }
}

export function findPackageRoot(fromUrl = import.meta.url): string {
  let current = dirname(fileURLToPath(fromUrl));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "skills"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Unable to locate the wechat-agent-kit package root.");
}
