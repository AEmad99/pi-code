import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PiService } from "./pi-service.js";
import { TerminalService } from "./terminal-service.js";
import { AppConfigStore } from "./app-config.js";
import type { ThinkingLevel } from "../shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const piService = new PiService();
const terminalService = new TerminalService();
const configStore = new AppConfigStore();

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 960,
    minWidth: 1180,
    minHeight: 740,
    title: "Pi Code",
    backgroundColor: "#f7f7f6",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

function emitState() {
  piService.getState().then((state) => mainWindow?.webContents.send("app:state", state)).catch(() => {});
}

app.whenReady().then(async () => {
  await configStore.load();
  registerIpc();
  terminalService.onEvent((event) => mainWindow?.webContents.send("terminal:event", event));
  createWindow();
  void piService.initialize(process.cwd(), configStore.get(), (event) => mainWindow?.webContents.send("pi:event", event)).finally(emitState);
});

app.on("window-all-closed", () => {
  terminalService.dispose();
  piService.dispose();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function registerIpc() {
  ipcMain.handle("app:get-state", () => piService.getState());
  ipcMain.handle("app:list-files", (_event, cwd?: string) => piService.listFiles(cwd));
  ipcMain.handle("app:set-theme", async (_event, theme) => {
    const config = await configStore.setTheme(theme);
    piService.setConfig(config);
    emitState();
    return config;
  });
  ipcMain.handle("app:update-config", async (_event, patch) => {
    const config = await configStore.update(patch);
    piService.setConfig(config);
    emitState();
    return config;
  });
  ipcMain.handle("app:pin-session", async (_event, id: string, pinned: boolean) => {
    const config = await configStore.pinSession(id, pinned);
    piService.setConfig(config);
    emitState();
    return config;
  });
  ipcMain.handle("app:self-improve", async (_event, prompt?: string) => {
    await piService.selfImprove(prompt);
    emitState();
  });
  ipcMain.handle("app:choose-directory", async () => {
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    await piService.setCwd(result.filePaths[0]);
    emitState();
    return result.filePaths[0];
  });

  ipcMain.handle("pi:prompt", async (_event, text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => {
    await piService.prompt(text, options);
    emitState();
  });
  ipcMain.handle("pi:steer", (_event, text: string) => piService.steer(text));
  ipcMain.handle("pi:follow-up", (_event, text: string) => piService.followUp(text));
  ipcMain.handle("pi:abort", () => piService.abort());
  ipcMain.handle("pi:compact", (_event, instructions?: string) => piService.compact(instructions));
  ipcMain.handle("pi:set-model", async (_event, modelKey: string) => {
    await piService.setModel(modelKey);
    emitState();
  });
  ipcMain.handle("pi:set-thinking-level", async (_event, level: ThinkingLevel) => {
    await piService.setThinkingLevel(level);
    emitState();
  });
  ipcMain.handle("pi:login", (_event, provider?: string) => piService.login(provider));
  ipcMain.handle("pi:logout", (_event, provider?: string) => piService.logout(provider));

  ipcMain.handle("sessions:list", () => piService.listSessions());
  ipcMain.handle("sessions:new", async () => {
    await piService.newSession();
    emitState();
  });
  ipcMain.handle("sessions:open", async (_event, fileOrId: string) => {
    await piService.openSession(fileOrId);
    await configStore.markRecent(fileOrId);
    piService.setConfig(configStore.get());
    emitState();
  });
  ipcMain.handle("sessions:rename", async (_event, id: string, name: string) => {
    await piService.renameSession(id, name);
    emitState();
  });
  ipcMain.handle("sessions:fork", async (_event, entryId?: string) => {
    await piService.fork(entryId);
    emitState();
  });
  ipcMain.handle("sessions:delete", async (_event, fileOrId: string) => {
    await piService.deleteSession(fileOrId);
    emitState();
  });

  ipcMain.handle("terminal:create", (_event, options?: { cwd?: string; shell?: string; cols?: number; rows?: number }) =>
    terminalService.create({ cwd: options?.cwd ?? piService.cwd, shell: options?.shell, cols: options?.cols, rows: options?.rows })
  );
  ipcMain.handle("terminal:input", (_event, id: string, data: string) => terminalService.input(id, data));
  ipcMain.handle("terminal:resize", (_event, id: string, cols: number, rows: number) => terminalService.resize(id, cols, rows));
  ipcMain.handle("terminal:kill", (_event, id: string) => terminalService.kill(id));
}
