#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { install, formatOperations, packageIdentity, planInstall, uninstall } from "./installer.js";
import type { AgentTarget, InstallScope } from "./paths.js";
import { runDoctor } from "./doctor.js";
import { ConnectorError } from "../core/index.js";

interface ParsedArgs {
  command: string;
  flags: Set<string>;
  values: Map<string, string>;
  positionals: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const [name, inline] = argument.split("=", 2);
    if (!name) continue;
    if (inline !== undefined) values.set(name, inline);
    else if (rest[index + 1] && !rest[index + 1]!.startsWith("--")) values.set(name, rest[++index]!);
    else flags.add(name);
  }
  return { command, flags, values, positionals };
}

function agentsFrom(value: string | undefined): AgentTarget[] {
  if (!value || value === "all") return ["claude-code", "codex", "generic"];
  const agents = value.split(",") as AgentTarget[];
  const allowed = new Set<AgentTarget>(["claude-code", "codex", "generic"]);
  for (const agent of agents) if (!allowed.has(agent)) throw new Error(`Unsupported agent target: ${agent}`);
  return agents;
}

function scopeFrom(value: string | undefined): InstallScope {
  if (!value || value === "user") return "user";
  if (value === "project") return "project";
  throw new Error(`Unsupported scope: ${value}`);
}

async function confirm(question: string): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(`${question} [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    prompt.close();
  }
}

function printHelp(): void {
  const identity = packageIdentity();
  console.log(`${identity.name} ${identity.version}

Usage:
  wechat-agent install [--agent all|claude-code,codex,generic] [--scope user|project]
                       [--dry-run] [--yes] [--json]
  wechat-agent doctor [--json]
  wechat-agent search --type articles|accounts --query <text> [--scope local|global|hybrid] [--limit N] --json
  wechat-agent read --url <wechat-url> | --article-id <id> [--content metadata|excerpt|full] --json
  wechat-agent subscribe --feed-url <rss-atom-or-json-feed-url> [--label <name>] --json
  wechat-agent unsubscribe --subscription-id <id> --json
  wechat-agent list --json
  wechat-agent status [--json]
  wechat-agent sync [--subscription-id <id>] --json
  wechat-agent uninstall [--dry-run] [--yes] [--json]

The installer never uses npm postinstall. Review writes with --dry-run; --yes is required for
non-interactive automation. Credentials and article data live outside the plugin directory.`);
}

async function handleInstall(parsed: ParsedArgs): Promise<void> {
  const base = {
    agents: agentsFrom(parsed.values.get("--agent")),
    scope: scopeFrom(parsed.values.get("--scope")),
    dryRun: parsed.flags.has("--dry-run"),
    yes: parsed.flags.has("--yes"),
  };
  const proposed = await planInstall(base);
  const json = parsed.flags.has("--json");
  if (base.dryRun) {
    console.log(json ? JSON.stringify({ success: true, operations: proposed }, null, 2) : formatOperations(proposed));
    return;
  }
  let approved = base.yes;
  if (!approved) {
    console.log(formatOperations(proposed));
    approved = await confirm("Apply these changes?");
  }
  if (!approved) throw new Error("Installation cancelled. Use --dry-run to inspect changes or --yes for automation.");
  const operations = await install({ ...base, yes: true });
  console.log(json ? JSON.stringify({ success: true, operations }, null, 2) : `Installed successfully.\n${formatOperations(operations)}`);
}

async function handleUninstall(parsed: ParsedArgs): Promise<void> {
  const base = {
    agents: agentsFrom(parsed.values.get("--agent")),
    scope: scopeFrom(parsed.values.get("--scope")),
    dryRun: true,
    yes: false,
  };
  const proposed = await uninstall(base);
  const json = parsed.flags.has("--json");
  if (parsed.flags.has("--dry-run")) {
    console.log(json ? JSON.stringify({ success: true, operations: proposed }, null, 2) : formatOperations(proposed));
    return;
  }
  let approved = parsed.flags.has("--yes");
  if (!approved) {
    console.log(formatOperations(proposed));
    approved = await confirm("Remove the unmodified managed files listed above?");
  }
  if (!approved) throw new Error("Uninstall cancelled.");
  const operations = await uninstall({ ...base, dryRun: false, yes: true });
  console.log(json ? JSON.stringify({ success: true, operations }, null, 2) : `Uninstall complete.\n${formatOperations(operations)}`);
}

async function handleDoctor(json: boolean): Promise<void> {
  const checks = await runDoctor();
  const ok = checks.every((check) => check.ok);
  if (json) console.log(JSON.stringify({ success: ok, checks }, null, 2));
  else for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.command) {
    case "install":
      await handleInstall(parsed);
      return;
    case "uninstall":
      await handleUninstall(parsed);
      return;
    case "doctor":
      await handleDoctor(parsed.flags.has("--json"));
      return;
    case "search":
    case "read":
    case "subscribe":
    case "unsubscribe":
    case "list":
    case "status":
    case "sync": {
      const { runRuntimeCommand } = await import("../runtime/commands.js");
      const result = await runRuntimeCommand(parsed.command, parsed);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "--version":
    case "version":
      console.log(packageIdentity().version);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${parsed.command}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      success: false,
      error: message,
      ...(error instanceof ConnectorError
        ? {
            code: error.code,
            retryable: error.retryable,
            needsUserAction: error.needsUserAction,
          }
        : {}),
    }),
  );
  process.exitCode = 1;
});
