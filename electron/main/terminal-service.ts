import os from "node:os";
import path from "node:path";
import type { IPty } from "node-pty";
import type { TerminalEvent } from "../shared.js";

type TerminalSink = (event: TerminalEvent) => void;

type PtyModule = {
  spawn: (file: string, args: string[], options: Record<string, unknown>) => IPty;
};

export class TerminalService {
  private pty: PtyModule | null = null;
  private terminals = new Map<string, IPty>();
  private sink: TerminalSink = () => {};

  onEvent(sink: TerminalSink) {
    this.sink = sink;
  }

  async create(options: { cwd?: string; shell?: string; cols?: number; rows?: number } = {}) {
    await this.loadPty();
    if (!this.pty) throw new Error("node-pty is unavailable.");

    const id = crypto.randomUUID();
    const shell = options.shell ?? defaultShell();
    const cwd = options.cwd ?? process.cwd();
    const term = this.pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: options.cols ?? 90,
      rows: options.rows ?? 24,
      cwd,
      env: process.env
    });

    term.onData((data) => this.sink({ type: "data", id, data }));
    term.onExit(({ exitCode }) => {
      this.terminals.delete(id);
      this.sink({ type: "exit", id, exitCode });
    });
    this.terminals.set(id, term);
    return { id, shell: path.basename(shell), cwd };
  }

  input(id: string, data: string) {
    this.terminals.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    this.terminals.get(id)?.resize(Math.max(20, cols), Math.max(5, rows));
  }

  kill(id: string) {
    this.terminals.get(id)?.kill();
    this.terminals.delete(id);
  }

  dispose() {
    for (const id of this.terminals.keys()) this.kill(id);
  }

  private async loadPty() {
    if (this.pty) return;
    this.pty = await import("node-pty");
  }
}

function defaultShell() {
  if (process.platform === "win32") {
    return process.env.ComSpec?.toLowerCase().includes("cmd.exe")
      ? "powershell.exe"
      : process.env.ComSpec ?? "powershell.exe";
  }
  return process.env.SHELL ?? (os.platform() === "darwin" ? "/bin/zsh" : "/bin/bash");
}
