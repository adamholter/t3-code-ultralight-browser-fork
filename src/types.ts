export type ConnectionStatus = "starting" | "ready" | "reconnecting" | "offline";

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description?: string }>;
}

export interface CodexThread {
  id: string;
  preview: string;
  name: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
  status: { type: string };
  turns: CodexTurn[];
}

export interface CodexTurn {
  id: string;
  status: string;
  error: { message?: string } | null;
  items: ThreadItem[];
}

export type KnownThreadItem =
  | { type: "userMessage"; id: string; content: Array<UserInput> }
  | { type: "agentMessage"; id: string; text: string; phase?: string | null }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | { type: "plan"; id: string; text: string }
  | { type: "commandExecution"; id: string; command: string; cwd?: string; status: string; aggregatedOutput?: string | null; exitCode?: number | null; durationMs?: number | null }
  | { type: "fileChange"; id: string; changes: Array<{ path?: string; kind?: string }>; status: string }
  | { type: "mcpToolCall"; id: string; server: string; tool: string; status: string; arguments?: unknown; result?: unknown; error?: unknown; durationMs?: number | null }
  | { type: "dynamicToolCall"; id: string; namespace?: string | null; tool: string; status: string; arguments?: unknown; contentItems?: unknown; success?: boolean | null; durationMs?: number | null }
  | { type: "webSearch"; id?: string; query?: string };

export type ThreadItem = KnownThreadItem | { type: string; id?: string; [key: string]: any };

export type UserInput =
  | { type: "text"; text: string; text_elements?: unknown[] }
  | { type: "localImage"; path: string }
  | { type: string; [key: string]: unknown };

export interface PendingServerRequest {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}
