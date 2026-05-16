import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bot,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  File,
  Folder,
  GitBranch,
  Laptop,
  ListChecks,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Square,
  Sun,
  Terminal as TerminalIcon,
  User,
  X
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import type { AppConfig, AppSession, AppState, ChatEvent, FileNode, PiCodeApi, ThemeMode, ThinkingLevel } from "../electron/shared";

type ChatBlock =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; thinking?: string }
  | { id: string; role: "system"; text: string };

type ToolItem = { id: string; label: string; status: "running" | "done" | "error"; output?: string };
type RightPane = "context" | "customize" | "tasks";

const thinkingLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const emptyState: AppState = {
  cwd: "",
  appCwd: "",
  branch: null,
  sessions: [],
  models: [],
  selectedModel: null,
  thinkingLevel: "medium",
  config: {
    theme: "dark",
    pinnedSessionIds: [],
    recentSessionIds: [],
    organizationName: "Pi Code",
    autoAcceptEdits: true,
    worktreeEnabled: true
  },
  authProviders: [],
  resources: { skills: 0, extensions: 0, prompts: 0, themes: 0, diagnostics: [] }
};

const api: PiCodeApi = window.piCode ?? createPreviewApi();

function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [messages, setMessages] = useState<ChatBlock[]>([
    { id: "welcome", role: "assistant", text: "Open a project or resume a Pi session. I can edit files, run commands, inspect context, and improve this app from inside its own worktree." }
  ]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [rightPane, setRightPane] = useState<RightPane>("tasks");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refreshState();
    const offState = api.app.onState(setState);
    const offPi = api.pi.onEvent(handlePiEvent);
    return () => {
      offState();
      offPi();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = state.config.theme;
  }, [state.config.theme]);

  useEffect(() => {
    if (state.cwd) void api.app.listFiles(state.cwd).then(setFiles);
  }, [state.cwd]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, tools]);

  async function refreshState() {
    const next = await api.app.getState();
    setState(next);
    setFiles(await api.app.listFiles(next.cwd));
  }

  function handlePiEvent(event: ChatEvent) {
    if (event.type === "agent_start") setIsStreaming(true);
    if (event.type === "agent_end") setIsStreaming(false);
    if (event.type === "assistant_delta") appendAssistant(event.delta);
    if (event.type === "thinking_delta") appendThinking(event.delta);
    if (event.type === "tool_start") setTools((current) => [...current, { id: event.id, label: event.label, status: "running" }]);
    if (event.type === "tool_update") setTools((current) => current.map((tool) => tool.id === event.id ? { ...tool, output: `${tool.output ?? ""}${event.output}` } : tool));
    if (event.type === "tool_end") setTools((current) => current.map((tool) => tool.id === event.id ? { ...tool, status: event.isError ? "error" : "done", output: event.output ?? tool.output } : tool));
    if (event.type === "error") {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "system", text: event.message }]);
      setIsStreaming(false);
    }
  }

  function appendAssistant(delta: string) {
    if (!delta) return;
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === "assistant") return [...current.slice(0, -1), { ...last, text: last.text + delta }];
      return [...current, { id: crypto.randomUUID(), role: "assistant", text: delta }];
    });
  }

  function appendThinking(delta: string) {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === "assistant") return [...current.slice(0, -1), { ...last, thinking: `${last.thinking ?? ""}${delta}` }];
      return [...current, { id: crypto.randomUUID(), role: "assistant", text: "", thinking: delta }];
    });
  }

  async function sendPrompt(text = prompt.trim()) {
    if (!text) return;
    setPrompt("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
    try {
      if (isStreaming) await api.pi.followUp(text);
      else await api.pi.prompt(text);
    } catch (error) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "system", text: formatError(error) }]);
      setIsStreaming(false);
    }
  }

  async function toggleTheme() {
    const theme: ThemeMode = state.config.theme === "dark" ? "light" : "dark";
    const config = await api.app.setTheme(theme);
    setState((current) => ({ ...current, config }));
  }

  const selectedModelLabel = useMemo(() => {
    const model = state.models.find((item) => `${item.provider}:${item.id}` === state.selectedModel);
    return model?.label ?? "Select model";
  }, [state.models, state.selectedModel]);

  const pinned = state.sessions.filter((session) => state.config.pinnedSessionIds.includes(session.id) || state.config.pinnedSessionIds.includes(session.file ?? ""));
  const recents = state.sessions.filter((session) => !pinned.includes(session)).slice(0, 12);
  const activeTitle = state.sessions[0]?.title ?? "New Pi session";

  return (
    <div className={`app-shell ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
      <aside className="session-sidebar">
        <div className="sidebar-top">
          <div className="brand"><Code2 size={20} /><span>Pi Code</span></div>
          <div className="sidebar-top-actions">
            <button className="icon-button" title={leftCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setLeftCollapsed((collapsed) => !collapsed)}><PanelLeft size={18} /></button>
            <button className="icon-button" title="New session" onClick={() => void api.sessions.create().then(refreshState)}><Plus size={18} /></button>
          </div>
        </div>

        <div className="sidebar-actions">
          <button onClick={() => void api.sessions.create().then(refreshState)}><Plus size={17} /><span>New session</span></button>
          <button onClick={() => { setRightPane("tasks"); setRightCollapsed(false); }}><Clock3 size={17} /><span>Scheduled</span></button>
          <button onClick={() => { setRightPane("customize"); setRightCollapsed(false); }}><Settings size={17} /><span>Customize</span></button>
        </div>

        <SessionGroup title="Pinned" sessions={pinned} empty="Pin an active session" pinnedIds={state.config.pinnedSessionIds} onOpen={(session) => session.file && api.sessions.open(session.file).then(refreshState)} onPin={pinSession} />
        <SessionGroup title="Recents" sessions={recents} empty="Your Pi sessions will appear here" pinnedIds={state.config.pinnedSessionIds} onOpen={(session) => session.file && api.sessions.open(session.file).then(refreshState)} onPin={pinSession} />

        <div className="sidebar-footer">
          <span>{state.config.organizationName}</span>
          <button className="icon-button" onClick={toggleTheme} title="Toggle theme">{state.config.theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</button>
        </div>
      </aside>

      <section className="session-main">
        <header className="session-toolbar">
          <div>
            <h1>{activeTitle}</h1>
            <button className="path-button" onClick={() => void api.app.chooseDirectory().then(refreshState)}>{shortPath(state.cwd)}</button>
          </div>
          <div className="toolbar-actions">
            <button className="pill" onClick={() => void api.app.chooseDirectory().then(refreshState)}><Laptop size={16} />Local</button>
            <button className="pill"><GitBranch size={16} />{state.branch ?? "no branch"}</button>
            <button className={state.config.worktreeEnabled ? "pill active" : "pill"} onClick={() => void api.app.updateConfig({ worktreeEnabled: !state.config.worktreeEnabled }).then((config) => setState((current) => ({ ...current, config })))}><CheckSquare size={16} />worktree</button>
            <button className={rightCollapsed ? "icon-pill active" : "icon-pill"} onClick={() => setRightCollapsed((collapsed) => !collapsed)} title="Toggle right panel"><PanelRight size={17} /></button>
            <button className={terminalOpen ? "icon-pill active" : "icon-pill"} onClick={() => setTerminalOpen((open) => !open)} title="Toggle terminal"><TerminalIcon size={17} /></button>
          </div>
        </header>

        <div className={terminalOpen ? "pane-area terminal-open" : "pane-area"}>
          <section className="chat-pane">
            <div className="transcript" ref={transcriptRef}>
              {messages.map((message) => <ChatMessage key={message.id} message={message} />)}
              {(tools.length > 0 || isStreaming) && <WorkingCard tools={tools} isStreaming={isStreaming} />}
            </div>
            <Composer
              prompt={prompt}
              setPrompt={setPrompt}
              sendPrompt={sendPrompt}
              isStreaming={isStreaming}
              state={state}
              selectedModelLabel={selectedModelLabel}
              refreshState={refreshState}
              setRightPane={(pane) => { setRightPane(pane); setRightCollapsed(false); }}
              toggleTerminal={() => setTerminalOpen((open) => !open)}
            />
          </section>

          <aside className="right-pane">
            <OutputRail state={state} tools={tools} isStreaming={isStreaming} setRightPane={(pane) => { setRightPane(pane); setRightCollapsed(false); }} collapsed={rightCollapsed} toggleCollapsed={() => setRightCollapsed((collapsed) => !collapsed)} />
            {!rightCollapsed && rightPane === "context" && <ContextPanel state={state} files={filterFiles(files, fileQuery)} fileQuery={fileQuery} setFileQuery={setFileQuery} refreshState={refreshState} />}
            {!rightCollapsed && rightPane === "customize" && <CustomizePanel state={state} refreshState={refreshState} />}
            {!rightCollapsed && rightPane === "tasks" && <TasksPanel tools={tools} isStreaming={isStreaming} />}
          </aside>

          {terminalOpen && (
            <div className="terminal-drawer">
              <TerminalPanel cwd={state.cwd} theme={state.config.theme} onClose={() => setTerminalOpen(false)} />
            </div>
          )}
        </div>

        <footer className="statusbar">
          <span><Circle size={8} fill="currentColor" />{selectedModelLabel}</span>
          <button onClick={() => void api.app.updateConfig({ autoAcceptEdits: !state.config.autoAcceptEdits }).then((config) => setState((current) => ({ ...current, config })))}>Auto accept edits: {state.config.autoAcceptEdits ? "on" : "off"}</button>
          <span>{state.resources.skills} skills</span>
          <span>{state.resources.extensions} extensions</span>
          <span>{state.resources.prompts} prompts</span>
          <Activity size={15} />
        </footer>
      </section>
    </div>
  );

  function pinSession(session: AppSession, pinned: boolean) {
    void api.app.pinSession(session.id, pinned).then((config) => setState((current) => ({ ...current, config })));
  }
}

function SessionGroup(props: { title: string; sessions: AppSession[]; empty: string; pinnedIds: string[]; onOpen: (session: AppSession) => void; onPin: (session: AppSession, pinned: boolean) => void }) {
  return (
    <section className="session-group">
      <h2>{props.title}</h2>
      {props.sessions.length === 0 && <div className="empty-list">{props.empty}</div>}
      {props.sessions.map((session, index) => {
        const isPinned = props.pinnedIds.includes(session.id) || props.pinnedIds.includes(session.file ?? "");
        return (
          <button className={`session-item ${index === 0 ? "active" : ""}`} key={session.id} onClick={() => props.onOpen(session)}>
            <MessageSquare size={16} />
            <span>{session.title}</span>
            <small>{relativeTime(session.updatedAt)}</small>
            <button className="pin-button" onClick={(event) => {
              event.stopPropagation();
              props.onPin(session, !isPinned);
            }}>{isPinned ? "Pinned" : "Pin"}</button>
          </button>
        );
      })}
    </section>
  );
}

function OutputRail({ state, tools, isStreaming, setRightPane, collapsed, toggleCollapsed }: { state: AppState; tools: ToolItem[]; isStreaming: boolean; setRightPane: (pane: RightPane) => void; collapsed: boolean; toggleCollapsed: () => void }) {
  return (
    <div className="output-rail">
      <div className="output-header">
        <span>Outputs</span>
        <button onClick={toggleCollapsed} title={collapsed ? "Expand panel" : "Collapse panel"}><PanelRight size={15} /></button>
        <button onClick={() => setRightPane("context")} title="Context"><Folder size={15} /></button>
        <button onClick={() => setRightPane("tasks")} title="Tasks"><ListChecks size={15} /></button>
        <button onClick={() => setRightPane("customize")} title="Customize"><Settings size={15} /></button>
      </div>
      <button className="output-row" onClick={() => setRightPane("context")}><Folder size={16} /><span>{shortPath(state.cwd)}</span></button>
      <button className="output-row"><GitBranch size={16} /><span>{state.branch ?? "no branch"}</span></button>
      <button className="output-row" onClick={() => setRightPane("tasks")}><Activity size={16} /><span>{isStreaming ? "Pi is working" : `${tools.length} task events`}</span></button>
      <button className="output-row" onClick={() => setRightPane("customize")}><Settings size={16} /><span>{state.resources.skills} skills, {state.resources.extensions} extensions</span></button>
    </div>
  );
}

function ChatMessage({ message }: { message: ChatBlock }) {
  const icon = message.role === "user" ? <User size={16} /> : message.role === "assistant" ? <Bot size={16} /> : <Activity size={16} />;
  return (
    <article className={`message ${message.role}`}>
      <div className="avatar">{icon}</div>
      <div className="message-body">
        <strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Pi" : "System"}</strong>
        {message.thinking && <details><summary>Thinking</summary>{message.thinking}</details>}
        <p>{message.text}</p>
      </div>
    </article>
  );
}

function WorkingCard({ tools, isStreaming }: { tools: ToolItem[]; isStreaming: boolean }) {
  return (
    <div className="work-card">
      <div className="card-title"><ChevronDown size={16} />Working</div>
      {tools.length === 0 && <div className="work-row"><Activity size={15} />waiting for tool activity</div>}
      {tools.map((tool) => <div className="work-row" key={tool.id}><File size={15} />{tool.label}<span className={tool.status}>{tool.status}</span></div>)}
      {isStreaming && <div className="work-row muted">continuing</div>}
    </div>
  );
}

function Composer({
  prompt,
  setPrompt,
  sendPrompt,
  isStreaming,
  state,
  selectedModelLabel,
  refreshState,
  setRightPane,
  toggleTerminal
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  sendPrompt: () => Promise<void>;
  isStreaming: boolean;
  state: AppState;
  selectedModelLabel: string;
  refreshState: () => Promise<void>;
  setRightPane: (pane: RightPane) => void;
  toggleTerminal: () => void;
}) {
  return (
    <div className="composer">
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void sendPrompt();
        }
      }} placeholder="Type / for commands, @ to mention files, or ask Pi to change this app..." />
      <div className="composer-footer">
        <div className="composer-tools">
          <button className="composer-tool ghost" onClick={() => setRightPane("context")}><Plus size={16} /></button>
          <button className="composer-tool permission-button"><CheckSquare size={14} />Full access<ChevronDown size={13} /></button>
          <button className="composer-tool" onClick={() => setRightPane("customize")}><Settings size={14} />Skills & plugins</button>
          <button className="composer-tool" onClick={toggleTerminal}><TerminalIcon size={14} />Terminal</button>
        </div>
        <div className="composer-status">
          <span>{isStreaming ? "Enter queues follow-up" : "Enter to send"}</span>
          <div className="select-shell model">
            <select className="composer-select" value={state.selectedModel ?? ""} title="Model" onChange={(event) => void api.pi.setModel(event.target.value).then(refreshState)}>
              <option value="" disabled>{selectedModelLabel}</option>
              {state.models.map((model) => <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>{model.label}</option>)}
            </select>
            <ChevronDown size={13} />
          </div>
          <div className="select-shell effort">
            <select className="composer-select" value={state.thinkingLevel} title="Effort" onChange={(event) => void api.pi.setThinkingLevel(event.target.value as ThinkingLevel).then(refreshState)}>
              {thinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
            <ChevronDown size={13} />
          </div>
          <button className={isStreaming ? "send-button stop" : "send-button"} onClick={() => void sendPrompt()}>{isStreaming ? <Square size={16} /> : <Send size={16} />}</button>
        </div>
      </div>
    </div>
  );
}

function ContextPanel({ state, files, fileQuery, setFileQuery, refreshState }: { state: AppState; files: FileNode[]; fileQuery: string; setFileQuery: (value: string) => void; refreshState: () => Promise<void> }) {
  return (
    <div className="pane-content">
      <div className="section-title">Working directory</div>
      <button className="working-dir" onClick={() => void api.app.chooseDirectory().then(refreshState)}><Folder size={16} /><span>{shortPath(state.cwd)}</span><GitBranch size={14} /><small>{state.branch ?? "no branch"}</small></button>
      <div className="section-title">Files</div>
      <label className="search-box"><Search size={15} /><input value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Search files..." /></label>
      <div className="file-tree"><FileTree nodes={files} /></div>
    </div>
  );
}

function CustomizePanel({ state, refreshState }: { state: AppState; refreshState: () => Promise<void> }) {
  return (
    <div className="pane-content">
      <div className="section-title">Customize Pi Code</div>
      <label>Theme<select value={state.config.theme} onChange={(event) => void api.app.setTheme(event.target.value as ThemeMode).then(refreshState)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label>Model<select value={state.selectedModel ?? ""} onChange={(event) => void api.pi.setModel(event.target.value).then(refreshState)}><option value="" disabled>Select model</option>{state.models.map((model) => <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>{model.label}</option>)}</select></label>
      <label>Effort<select value={state.thinkingLevel} onChange={(event) => void api.pi.setThinkingLevel(event.target.value as ThinkingLevel).then(refreshState)}>{thinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
      <button className="panel-button" onClick={() => void api.app.selfImprove()}>Self improve this app</button>
      <button className="panel-button" onClick={() => void api.pi.compact()}>Compact session</button>
      <button className="panel-button" onClick={() => void api.pi.login("openai")}>Login with Codex/OpenAI</button>
      <div className="resource-grid"><span>{state.resources.skills} skills</span><span>{state.resources.extensions} extensions</span><span>{state.resources.prompts} prompts</span><span>{state.resources.themes} themes</span></div>
      {state.authProviders.map((provider) => <div className="provider-row" key={provider.id}>{provider.label}<span>{provider.status}</span></div>)}
      {state.resources.diagnostics.slice(0, 4).map((diagnostic) => <small key={diagnostic}>{diagnostic}</small>)}
    </div>
  );
}

function TasksPanel({ tools, isStreaming }: { tools: ToolItem[]; isStreaming: boolean }) {
  return (
    <div className="pane-content">
      <div className="section-title">Tasks</div>
      {tools.length === 0 && <div className="empty-list">Tool calls, background commands, and subagent work will appear here.</div>}
      {tools.map((tool) => <div className="task-row" key={tool.id}>{tool.label}<span>{tool.status}</span></div>)}
      {isStreaming && <div className="task-row">Pi is working<span>running</span></div>}
    </div>
  );
}

function FileTree({ nodes }: { nodes: FileNode[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <>
      {nodes.map((node) => {
        const isOpen = open[node.path] ?? true;
        if (node.type === "directory") {
          return <div key={node.path}><button className="tree-row" onClick={() => setOpen((current) => ({ ...current, [node.path]: !isOpen }))}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<Folder size={15} /><span>{node.name}</span></button>{isOpen && node.children && <div className="tree-children"><FileTree nodes={node.children} /></div>}</div>;
        }
        return <div className="tree-row file" key={node.path}><span className="tree-spacer" /><File size={14} /><span>{node.name}</span></div>;
      })}
    </>
  );
}

function TerminalPanel({ cwd, theme, onClose }: { cwd: string; theme: ThemeMode; onClose?: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const terminalIdRef = useRef<string | null>(null);

  useEffect(() => {
    const dark = theme === "dark";
    const term = new Terminal({ cursorBlink: true, fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace", fontSize: 13, theme: { background: dark ? "#171717" : "#faf9f6", foreground: dark ? "#ddd8ce" : "#24211d", cursor: dark ? "#ddd8ce" : "#24211d" } });
    const fit = new FitAddon();
    term.loadAddon(fit);
    if (containerRef.current) {
      term.open(containerRef.current);
      fit.fit();
    }
    term.onData((data) => terminalIdRef.current && void api.terminal.input(terminalIdRef.current, data));
    const off = api.terminal.onEvent((event) => {
      if (event.id !== terminalIdRef.current) return;
      if (event.type === "data") term.write(event.data);
      if (event.type === "exit") term.writeln(`\r\n[process exited: ${event.exitCode ?? ""}]`);
    });
    termRef.current = term;
    void createTerminal(term);
    const resize = () => {
      fit.fit();
      if (terminalIdRef.current) void api.terminal.resize(terminalIdRef.current, term.cols, term.rows);
    };
    window.addEventListener("resize", resize);
    return () => {
      off();
      window.removeEventListener("resize", resize);
      if (terminalIdRef.current) void api.terminal.kill(terminalIdRef.current);
      term.dispose();
    };
  }, [theme, cwd]);

  async function createTerminal(term = termRef.current) {
    if (terminalIdRef.current) await api.terminal.kill(terminalIdRef.current);
    const created = await api.terminal.create({ cwd, cols: term?.cols, rows: term?.rows });
    terminalIdRef.current = created.id;
    term?.reset();
  }

  return <div className="terminal-pane"><div className="terminal-header"><TerminalIcon size={15} /><span>{shortPath(cwd)}</span><button onClick={() => void createTerminal()}><Plus size={15} /></button><button onClick={() => { if (terminalIdRef.current) void api.terminal.kill(terminalIdRef.current); onClose?.(); }}><X size={15} /></button></div><div className="terminal-surface" ref={containerRef} /></div>;
}

function filterFiles(nodes: FileNode[], query: string): FileNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  return nodes.flatMap((node) => {
    if (node.name.toLowerCase().includes(needle)) return [node];
    if (node.children) {
      const children = filterFiles(node.children, needle);
      if (children.length) return [{ ...node, children }];
    }
    return [];
  });
}

function projectName(cwd: string) {
  return cwd.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "Pi-Code";
}

function shortPath(value: string) {
  if (!value) return "Choose project";
  const parts = value.replaceAll("\\", "/").split("/");
  return parts.length > 2 ? `~/${parts.slice(-2).join("/")}` : value;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createPreviewApi(): PiCodeApi {
  let previewConfig: AppConfig = { ...emptyState.config, pinnedSessionIds: ["alignment-grid"] };
  let terminalListener: ((event: { type: "data"; id: string; data: string } | { type: "exit"; id: string; exitCode?: number }) => void) | null = null;
  return {
    app: {
      getState: async () => ({
        ...emptyState,
        cwd: "D:\\projects\\Pi-Code",
        appCwd: "D:\\projects\\Pi-Code",
        branch: "main",
        selectedModel: "preview:gpt-5.5",
        models: [{ provider: "preview", id: "gpt-5.5", label: "gpt-5.5" }],
        config: previewConfig,
        sessions: [
          { id: "alignment-grid", title: "Build the alignment grid demo", cwd: "D:\\projects\\Pi-Code", updatedAt: new Date().toISOString(), file: "alignment-grid" },
          { id: "fetch-retries", title: "Migrate API client to fetch with retries", cwd: "D:\\projects\\Pi-Code", updatedAt: new Date(Date.now() - 3600000).toISOString(), file: "fetch-retries" },
          { id: "upload-race", title: "Fix race condition in upload queue", cwd: "D:\\projects\\Pi-Code", updatedAt: new Date(Date.now() - 7200000).toISOString(), file: "upload-race" }
        ],
        resources: { skills: 6, extensions: 2, prompts: 9, themes: 2, diagnostics: [] },
        authProviders: [{ id: "openai", label: "OpenAI / Codex", status: "available" }]
      }),
      listFiles: async () => [{ name: "electron", path: "electron", type: "directory", children: [{ name: "main", path: "electron/main", type: "directory", children: [{ name: "pi-service.ts", path: "electron/main/pi-service.ts", type: "file" }] }] }, { name: "src", path: "src", type: "directory", children: [{ name: "App.tsx", path: "src/App.tsx", type: "file" }, { name: "styles.css", path: "src/styles.css", type: "file" }] }],
      chooseDirectory: async () => "D:\\projects\\Pi-Code",
      setTheme: async (theme) => (previewConfig = { ...previewConfig, theme }),
      updateConfig: async (config) => (previewConfig = { ...previewConfig, ...config }),
      pinSession: async (id, pinned) => (previewConfig = { ...previewConfig, pinnedSessionIds: pinned ? [...new Set([...previewConfig.pinnedSessionIds, id])] : previewConfig.pinnedSessionIds.filter((item) => item !== id) }),
      selfImprove: async () => {},
      onState: () => () => {}
    },
    pi: { prompt: async () => {}, steer: async () => {}, followUp: async () => {}, abort: async () => {}, compact: async () => {}, setModel: async () => {}, setThinkingLevel: async () => {}, login: async () => {}, logout: async () => {}, onEvent: () => () => {} },
    sessions: { list: async () => [], create: async () => {}, open: async () => {}, rename: async () => {}, fork: async () => {}, delete: async () => {} },
    terminal: { create: async () => { window.setTimeout(() => terminalListener?.({ type: "data", id: "preview", data: `${projectName("D:\\projects\\Pi-Code")} % ` }), 50); return { id: "preview", shell: "preview", cwd: "D:\\projects\\Pi-Code" }; }, input: async (_id, data) => terminalListener?.({ type: "data", id: "preview", data }), resize: async () => {}, kill: async () => {}, onEvent: (listener) => { terminalListener = listener; return () => { terminalListener = null; }; } }
  };
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
