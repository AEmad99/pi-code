export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AppSession = {
  id: string;
  title: string;
  cwd: string;
  updatedAt: string;
  file?: string;
};

export type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
};

export type ModelOption = {
  provider: string;
  id: string;
  label: string;
};

export type ThemeMode = "dark" | "light";

export type AppConfig = {
  theme: ThemeMode;
  pinnedSessionIds: string[];
  recentSessionIds: string[];
  organizationName: string;
  autoAcceptEdits: boolean;
  worktreeEnabled: boolean;
};

export type AppState = {
  cwd: string;
  appCwd: string;
  branch: string | null;
  sessions: AppSession[];
  models: ModelOption[];
  selectedModel: string | null;
  thinkingLevel: ThinkingLevel;
  config: AppConfig;
  authProviders: Array<{ id: string; label: string; status: "available" | "missing" | "unknown" }>;
  resources: {
    skills: number;
    extensions: number;
    prompts: number;
    themes: number;
    diagnostics: string[];
  };
};

export type ChatEvent =
  | { type: "assistant_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "message_start"; role?: string }
  | { type: "message_end" }
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "tool_start"; id: string; label: string; input?: unknown }
  | { type: "tool_update"; id: string; output: string }
  | { type: "tool_end"; id: string; isError: boolean; output?: string }
  | { type: "queue_update"; steering?: string; followUp?: string }
  | { type: "compaction_start" | "compaction_end" | "auto_retry_start" | "auto_retry_end" }
  | { type: "error"; message: string };

export type TerminalEvent =
  | { type: "data"; id: string; data: string }
  | { type: "exit"; id: string; exitCode?: number };

export type PiCodeApi = {
  app: {
    getState(): Promise<AppState>;
    listFiles(cwd?: string): Promise<FileNode[]>;
    chooseDirectory(): Promise<string | null>;
    setTheme(theme: ThemeMode): Promise<AppConfig>;
    updateConfig(config: Partial<AppConfig>): Promise<AppConfig>;
    pinSession(id: string, pinned: boolean): Promise<AppConfig>;
    selfImprove(prompt?: string): Promise<void>;
    onState(listener: (state: AppState) => void): () => void;
  };
  pi: {
    prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void>;
    steer(text: string): Promise<void>;
    followUp(text: string): Promise<void>;
    abort(): Promise<void>;
    compact(instructions?: string): Promise<void>;
    setModel(modelKey: string): Promise<void>;
    setThinkingLevel(level: ThinkingLevel): Promise<void>;
    login(provider?: string): Promise<void>;
    logout(provider?: string): Promise<void>;
    onEvent(listener: (event: ChatEvent) => void): () => void;
  };
  sessions: {
    list(): Promise<AppSession[]>;
    create(): Promise<void>;
    open(fileOrId: string): Promise<void>;
    rename(id: string, name: string): Promise<void>;
    fork(entryId?: string): Promise<void>;
    delete(fileOrId: string): Promise<void>;
  };
  terminal: {
    create(options?: { cwd?: string; shell?: string; cols?: number; rows?: number }): Promise<{ id: string; shell: string; cwd: string }>;
    input(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    kill(id: string): Promise<void>;
    onEvent(listener: (event: TerminalEvent) => void): () => void;
  };
};
