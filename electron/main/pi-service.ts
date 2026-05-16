import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import type { AppConfig, AppSession, AppState, ChatEvent, FileNode, ModelOption, ThinkingLevel } from "../shared.js";

type EventSink = (event: ChatEvent) => void;

type PiModule = Record<string, any>;

const DEFAULT_THINKING: ThinkingLevel = "medium";
const HIDDEN_DIRS = new Set([".git", "node_modules", "dist", "dist-electron", ".vite", ".next", "target", "build"]);

export class PiService {
  cwd = process.cwd();
  private pi: PiModule | null = null;
  private runtime: any | null = null;
  private session: any | null = null;
  private unsubscribe: (() => void) | null = null;
  private authStorage: any | null = null;
  private modelRegistry: any | null = null;
  private settingsManager: any | null = null;
  private resourceLoader: any | null = null;
  private models: ModelOption[] = [];
  private selectedModel: string | null = null;
  private thinkingLevel: ThinkingLevel = DEFAULT_THINKING;
  private appConfig: AppConfig = {
    theme: "dark",
    pinnedSessionIds: [],
    recentSessionIds: [],
    organizationName: "Acme Co.",
    autoAcceptEdits: true,
    worktreeEnabled: true
  };
  private sink: EventSink = () => {};
  private diagnostics: string[] = [];

  async initialize(cwd: string, config: AppConfig, sink: EventSink) {
    this.cwd = cwd;
    this.appConfig = config;
    this.sink = sink;
    await this.loadPi();
    await this.createRuntime();
  }

  setConfig(config: AppConfig) {
    this.appConfig = config;
  }

  dispose() {
    this.unsubscribe?.();
    this.session?.dispose?.();
  }

  async setCwd(cwd: string) {
    this.cwd = cwd;
    await this.createRuntime();
  }

  async getState(): Promise<AppState> {
    await this.refreshModels();
    return {
      cwd: this.cwd,
      appCwd: process.cwd(),
      branch: await this.getGitBranch(),
      sessions: await this.listSessions(),
      models: this.models,
      selectedModel: this.selectedModel,
      thinkingLevel: this.thinkingLevel,
      config: this.appConfig,
      authProviders: await this.getAuthProviders(),
      resources: await this.getResources()
    };
  }

  async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }) {
    await this.ensureSession();
    await this.session.prompt(text, options);
  }

  async steer(text: string) {
    await this.ensureSession();
    await this.session.steer(text);
  }

  async followUp(text: string) {
    await this.ensureSession();
    await this.session.followUp(text);
  }

  async abort() {
    await this.session?.abort?.();
  }

  async compact(instructions?: string) {
    await this.ensureSession();
    await this.session.compact(instructions);
  }

  async setModel(modelKey: string) {
    await this.ensureSession();
    const [provider, ...rest] = modelKey.split(":");
    const id = rest.join(":");
    const model = this.modelRegistry?.find?.(provider, id) ?? this.pi?.getModel?.(provider, id);
    if (!model) throw new Error(`Model not found: ${modelKey}`);
    await this.session.setModel(model);
    this.selectedModel = modelKey;
  }

  async setThinkingLevel(level: ThinkingLevel) {
    await this.ensureSession();
    this.session.setThinkingLevel(level);
    this.thinkingLevel = level;
  }

  async login(provider?: string) {
    await this.runPiCli(["/login", provider].filter(Boolean) as string[]);
  }

  async logout(provider?: string) {
    await this.runPiCli(["/logout", provider].filter(Boolean) as string[]);
  }

  async newSession() {
    if (this.runtime?.newSession) {
      await this.runtime.newSession();
      this.attachSession(this.runtime.session);
    } else {
      await this.createRuntime();
    }
  }

  async openSession(fileOrId: string) {
    await this.ensureRuntime();
    if (this.runtime?.switchSession) {
      await this.runtime.switchSession(fileOrId);
      this.attachSession(this.runtime.session);
      return;
    }
    throw new Error("Pi runtime does not expose switchSession in this version.");
  }

  async fork(entryId?: string) {
    await this.ensureRuntime();
    if (!this.runtime?.fork) throw new Error("Pi runtime does not expose fork in this version.");
    await this.runtime.fork(entryId);
    this.attachSession(this.runtime.session);
  }

  async renameSession(id: string, name: string) {
    if (!this.pi?.SessionManager) throw new Error("SessionManager is unavailable.");
    const match = (await this.listSessions()).find((session) => session.id === id || session.file === id);
    if (!match?.file) throw new Error("Session file not found.");
    const manager = this.pi.SessionManager.open(match.file);
    const leaf = manager.getLeafEntry?.();
    if (leaf?.id && manager.appendLabelChange) manager.appendLabelChange(leaf.id, name);
  }

  async deleteSession(fileOrId: string) {
    const match = (await this.listSessions()).find((session) => session.id === fileOrId || session.file === fileOrId);
    if (!match?.file) throw new Error("Session file not found.");
    await fs.rm(match.file, { force: true });
  }

  async selfImprove(prompt?: string) {
    await this.setCwd(process.cwd());
    const request = prompt?.trim() || [
      "Improve Pi Code itself. Inspect the Electron/React app, preserve Pi SDK capabilities, keep OAuth compatible,",
      "and implement the requested functionality in this local application. Keep changes scoped and verify with npm run build."
    ].join(" ");
    await this.prompt(request);
  }

  async listSessions(): Promise<AppSession[]> {
    if (!this.pi?.SessionManager?.list) return [];
    try {
      const sessions = await this.pi.SessionManager.list(this.cwd);
      return (sessions ?? []).slice(0, 30).map((session: any, index: number) => {
        const file = session.file ?? session.path ?? session.sessionFile;
        const id = session.id ?? session.sessionId ?? file ?? `session-${index}`;
        const title = session.name ?? session.label ?? session.title ?? this.titleFromFile(file) ?? "Untitled session";
        const updatedAt = new Date(session.updatedAt ?? session.modified ?? session.mtimeMs ?? Date.now()).toISOString();
        return { id, title, cwd: session.cwd ?? this.cwd, updatedAt, file };
      });
    } catch (error) {
      this.diagnostics.push(`Session listing failed: ${formatError(error)}`);
      return [];
    }
  }

  async listFiles(cwd = this.cwd): Promise<FileNode[]> {
    return this.readDir(cwd, 0);
  }

  private async loadPi() {
    if (this.pi) return;
    try {
      this.pi = await import("@earendil-works/pi-coding-agent");
    } catch (error) {
      this.diagnostics.push(`Pi SDK import failed: ${formatError(error)}`);
      this.pi = null;
    }
  }

  private async createRuntime() {
    await this.loadPi();
    if (!this.pi) return;
    this.unsubscribe?.();
    this.unsubscribe = null;

    try {
      this.authStorage = this.pi.AuthStorage?.create?.();
      this.modelRegistry = this.pi.ModelRegistry?.create?.(this.authStorage);
      this.settingsManager = this.pi.SettingsManager?.create?.(this.cwd);
      this.resourceLoader = this.pi.DefaultResourceLoader ? new this.pi.DefaultResourceLoader({
        cwd: this.cwd,
        agentDir: this.pi.getAgentDir?.(),
        settingsManager: this.settingsManager
      }) : null;
      await this.resourceLoader?.reload?.();

      if (this.pi.createAgentSessionRuntime && this.pi.createAgentSessionServices && this.pi.createAgentSessionFromServices) {
        const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }: any) => {
          const services = await this.pi!.createAgentSessionServices({ cwd });
          const result = await this.pi!.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
          return { ...result, services, diagnostics: services.diagnostics };
        };
        this.runtime = await this.pi.createAgentSessionRuntime(createRuntime, {
          cwd: this.cwd,
          agentDir: this.pi.getAgentDir?.(),
          sessionManager: this.pi.SessionManager?.create?.(this.cwd)
        });
        this.attachSession(this.runtime.session);
      } else if (this.pi.createAgentSession) {
        const result = await this.pi.createAgentSession({
          cwd: this.cwd,
          authStorage: this.authStorage,
          modelRegistry: this.modelRegistry,
          settingsManager: this.settingsManager,
          resourceLoader: this.resourceLoader,
          sessionManager: this.pi.SessionManager?.create?.(this.cwd)
        });
        this.runtime = null;
        this.attachSession(result.session);
      }
      await this.refreshModels();
    } catch (error) {
      this.diagnostics.push(`Pi runtime initialization failed: ${formatError(error)}`);
      this.sink({ type: "error", message: formatError(error) });
    }
  }

  private attachSession(session: any) {
    this.unsubscribe?.();
    this.session = session;
    this.selectedModel = keyForModel(session?.model);
    this.thinkingLevel = session?.thinkingLevel ?? this.thinkingLevel;
    this.unsubscribe = session?.subscribe?.((event: any) => this.sink(this.normalizeEvent(event)));
  }

  private async ensureRuntime() {
    if (!this.pi) await this.loadPi();
    if (!this.runtime && !this.session) await this.createRuntime();
  }

  private async ensureSession() {
    await this.ensureRuntime();
    if (!this.session) throw new Error("Pi session is not available. Check that @earendil-works/pi-coding-agent installed correctly.");
  }

  private normalizeEvent(event: any): ChatEvent {
    if (!event || typeof event !== "object") return { type: "error", message: "Unknown Pi event" };
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update?.type === "text_delta") return { type: "assistant_delta", delta: update.delta ?? "" };
      if (update?.type === "thinking_delta") return { type: "thinking_delta", delta: update.delta ?? "" };
    }
    if (event.type === "tool_execution_start") return { type: "tool_start", id: event.toolCallId ?? event.id ?? event.toolName, label: event.toolName ?? "tool", input: event.input };
    if (event.type === "tool_execution_update") return { type: "tool_update", id: event.toolCallId ?? event.id ?? event.toolName, output: event.output ?? event.delta ?? "" };
    if (event.type === "tool_execution_end") return { type: "tool_end", id: event.toolCallId ?? event.id ?? event.toolName, isError: Boolean(event.isError), output: event.output ?? event.result };
    if (event.type === "queue_update") return { type: "queue_update", steering: event.steering, followUp: event.followUp };
    if (["message_start", "message_end", "agent_start", "agent_end", "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end"].includes(event.type)) {
      return { type: event.type, role: event.role } as ChatEvent;
    }
    return { type: "message_start", role: event.type };
  }

  private async refreshModels() {
    if (!this.modelRegistry?.getAvailable) return;
    try {
      const models = await this.modelRegistry.getAvailable();
      this.models = (models ?? []).map((model: any) => ({
        provider: model.provider ?? model.providerId ?? "unknown",
        id: model.id ?? model.model ?? model.name,
        label: model.label ?? model.displayName ?? model.id ?? model.name
      })).filter((model: ModelOption) => model.id);
      if (!this.selectedModel && this.models[0]) this.selectedModel = `${this.models[0].provider}:${this.models[0].id}`;
    } catch (error) {
      this.diagnostics.push(`Model discovery failed: ${formatError(error)}`);
    }
  }

  private async getAuthProviders() {
    const authFile = path.join(os.homedir(), ".pi", "agent", "auth.json");
    let auth: Record<string, unknown> = {};
    try {
      auth = JSON.parse(await fs.readFile(authFile, "utf8")) as Record<string, unknown>;
    } catch {
      auth = {};
    }
    const providers = [
      ["openai", "OpenAI / Codex"],
      ["anthropic", "Claude"],
      ["github-copilot", "GitHub Copilot"],
      ["google", "Gemini"],
      ["openrouter", "OpenRouter"]
    ];
    return providers.map(([id, label]) => ({ id, label, status: auth[id] ? "available" as const : "missing" as const }));
  }

  private async getResources() {
    const loader = this.resourceLoader;
    const diagnostics = [...this.diagnostics];
    try {
      return {
        skills: loader?.getSkills?.()?.skills?.length ?? loader?.getSkills?.()?.length ?? 0,
        extensions: loader?.getExtensions?.()?.length ?? 0,
        prompts: loader?.getPrompts?.()?.prompts?.length ?? loader?.getPrompts?.()?.length ?? 0,
        themes: loader?.getThemes?.()?.length ?? 0,
        diagnostics
      };
    } catch {
      return { skills: 0, extensions: 0, prompts: 0, themes: 0, diagnostics };
    }
  }

  private async getGitBranch() {
    return new Promise<string | null>((resolve) => {
      const child = spawn("git", ["branch", "--show-current"], { cwd: this.cwd, shell: false });
      let output = "";
      child.stdout.on("data", (chunk) => { output += String(chunk); });
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code === 0 ? output.trim() || null : null));
    });
  }

  private async readDir(dir: string, depth: number): Promise<FileNode[]> {
    if (depth > 3) return [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const visible = entries.filter((entry) => !entry.name.startsWith(".") && !HIDDEN_DIRS.has(entry.name)).slice(0, 250);
      return Promise.all(visible.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return { name: entry.name, path: fullPath, type: "directory" as const, children: await this.readDir(fullPath, depth + 1) };
        }
        return { name: entry.name, path: fullPath, type: "file" as const };
      }));
    } catch {
      return [];
    }
  }

  private async runPiCli(args: string[]) {
    const command = process.platform === "win32" ? "pi.cmd" : "pi";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { cwd: this.cwd, stdio: "ignore", detached: true, shell: false });
      child.on("error", reject);
      child.on("spawn", () => {
        child.unref();
        resolve();
      });
    }).catch((error) => {
      throw new Error(`Unable to launch Pi CLI for auth. Run "pi ${args.join(" ")}" in the built-in terminal. ${formatError(error)}`);
    });
  }

  private titleFromFile(file?: string) {
    return file ? path.basename(file, path.extname(file)) : undefined;
  }
}

function keyForModel(model: any) {
  if (!model) return null;
  const provider = model.provider ?? model.providerId;
  const id = model.id ?? model.model ?? model.name;
  return provider && id ? `${provider}:${id}` : null;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
