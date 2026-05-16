import { contextBridge, ipcRenderer } from "electron";
import type { AppConfig, AppState, ChatEvent, PiCodeApi, TerminalEvent, ThemeMode, ThinkingLevel } from "../shared.js";

function onChannel<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: PiCodeApi = {
  app: {
    getState: () => ipcRenderer.invoke("app:get-state"),
    listFiles: (cwd?: string) => ipcRenderer.invoke("app:list-files", cwd),
    chooseDirectory: () => ipcRenderer.invoke("app:choose-directory"),
    setTheme: (theme: ThemeMode) => ipcRenderer.invoke("app:set-theme", theme),
    updateConfig: (config: Partial<AppConfig>) => ipcRenderer.invoke("app:update-config", config),
    pinSession: (id: string, pinned: boolean) => ipcRenderer.invoke("app:pin-session", id, pinned),
    selfImprove: (prompt?: string) => ipcRenderer.invoke("app:self-improve", prompt),
    onState: (listener: (state: AppState) => void) => onChannel("app:state", listener)
  },
  pi: {
    prompt: (text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => ipcRenderer.invoke("pi:prompt", text, options),
    steer: (text: string) => ipcRenderer.invoke("pi:steer", text),
    followUp: (text: string) => ipcRenderer.invoke("pi:follow-up", text),
    abort: () => ipcRenderer.invoke("pi:abort"),
    compact: (instructions?: string) => ipcRenderer.invoke("pi:compact", instructions),
    setModel: (modelKey: string) => ipcRenderer.invoke("pi:set-model", modelKey),
    setThinkingLevel: (level: ThinkingLevel) => ipcRenderer.invoke("pi:set-thinking-level", level),
    login: (provider?: string) => ipcRenderer.invoke("pi:login", provider),
    logout: (provider?: string) => ipcRenderer.invoke("pi:logout", provider),
    onEvent: (listener: (event: ChatEvent) => void) => onChannel("pi:event", listener)
  },
  sessions: {
    list: () => ipcRenderer.invoke("sessions:list"),
    create: () => ipcRenderer.invoke("sessions:new"),
    open: (fileOrId: string) => ipcRenderer.invoke("sessions:open", fileOrId),
    rename: (id: string, name: string) => ipcRenderer.invoke("sessions:rename", id, name),
    fork: (entryId?: string) => ipcRenderer.invoke("sessions:fork", entryId),
    delete: (fileOrId: string) => ipcRenderer.invoke("sessions:delete", fileOrId)
  },
  terminal: {
    create: (options?: { cwd?: string; shell?: string; cols?: number; rows?: number }) => ipcRenderer.invoke("terminal:create", options),
    input: (id: string, data: string) => ipcRenderer.invoke("terminal:input", id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke("terminal:resize", id, cols, rows),
    kill: (id: string) => ipcRenderer.invoke("terminal:kill", id),
    onEvent: (listener: (event: TerminalEvent) => void) => onChannel("terminal:event", listener)
  }
};

contextBridge.exposeInMainWorld("piCode", api);
