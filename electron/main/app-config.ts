import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, ThemeMode } from "../shared.js";

const defaultConfig: AppConfig = {
  theme: "dark",
  pinnedSessionIds: [],
  recentSessionIds: [],
  organizationName: "Acme Co.",
  autoAcceptEdits: true,
  worktreeEnabled: true
};

export class AppConfigStore {
  private config: AppConfig = defaultConfig;
  private readonly filePath = path.join(app.getPath("userData"), "pi-code-config.json");

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, "utf8")) as Partial<AppConfig>;
      this.config = normalizeConfig(raw);
    } catch {
      this.config = defaultConfig;
      await this.save();
    }
    return this.config;
  }

  get() {
    return this.config;
  }

  async update(next: Partial<AppConfig>) {
    this.config = normalizeConfig({ ...this.config, ...next });
    await this.save();
    return this.config;
  }

  async setTheme(theme: ThemeMode) {
    return this.update({ theme });
  }

  async pinSession(id: string, pinned: boolean) {
    const current = new Set(this.config.pinnedSessionIds);
    if (pinned) current.add(id);
    else current.delete(id);
    return this.update({ pinnedSessionIds: [...current] });
  }

  async markRecent(id: string) {
    const recentSessionIds = [id, ...this.config.recentSessionIds.filter((item) => item !== id)].slice(0, 20);
    return this.update({ recentSessionIds });
  }

  private async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.config, null, 2), "utf8");
  }
}

function normalizeConfig(input: Partial<AppConfig>): AppConfig {
  return {
    theme: input.theme === "light" ? "light" : "dark",
    pinnedSessionIds: Array.isArray(input.pinnedSessionIds) ? input.pinnedSessionIds.filter(Boolean) : [],
    recentSessionIds: Array.isArray(input.recentSessionIds) ? input.recentSessionIds.filter(Boolean) : [],
    organizationName: typeof input.organizationName === "string" && input.organizationName.trim() ? input.organizationName.trim() : defaultConfig.organizationName,
    autoAcceptEdits: typeof input.autoAcceptEdits === "boolean" ? input.autoAcceptEdits : defaultConfig.autoAcceptEdits,
    worktreeEnabled: typeof input.worktreeEnabled === "boolean" ? input.worktreeEnabled : defaultConfig.worktreeEnabled
  };
}
