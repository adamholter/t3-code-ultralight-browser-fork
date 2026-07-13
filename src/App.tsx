import { FolderOpen, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { PendingRequestPanel } from "./components/PendingRequestPanel";
import { MobileMenuButton, Sidebar } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";
import {
  postCodexEmbedEvent,
  subscribeCodexEmbedCommands,
  type CodexEmbedCommandHandlers,
  type CodexEmbedSendOptions,
} from "./embed-events";
import { createCodexClient } from "./lib/codex-client";
import { buildCurrentTimeResponse, getServerRequestThreadId } from "./lib/server-requests";
import { appendItemDelta, flattenItems, reconcileStreamedItem } from "./lib/thread-items";
import type { CodexModel, CodexThread, ConnectionStatus, PendingServerRequest, ThreadItem } from "./types";

const startupParams = new URLSearchParams(window.location.search);
const configuredWebSocketPath = readSameOriginPath(startupParams, "codex-ws-path");
const configuredStatusPath = readSameOriginPath(startupParams, "codex-status-path") ?? "/api/status";

// The complete chat normally follows the origin serving the page. A host may
// opt into a same-origin path when its bridge is token-scoped or reverse-proxied.
const codex = configuredWebSocketPath
  ? createCodexClient({ url: () => webSocketUrl(configuredWebSocketPath) })
  : createCodexClient({ bridgeUrl: () => window.location.origin });

export default function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const embedded = searchParams.get("embed") === "1";
  const collaborationMode = searchParams.get("mode") === "plan" ? "plan" : null;
  const [status, setStatus] = useState<ConnectionStatus>("starting");
  const [threads, setThreads] = useState<CodexThread[]>([]);
  const [models, setModels] = useState<CodexModel[]>([]);
  const [selected, setSelected] = useState<CodexThread | null>(null);
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [model, setModel] = useState(localStorage.getItem("codex-web:model") ?? "");
  const [effort, setEffort] = useState(localStorage.getItem("codex-web:effort") ?? "low");
  const [cwd, setCwd] = useState(localStorage.getItem("codex-web:cwd") ?? "");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingServerRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem("codex-web:theme") !== "light");
  const [embedAllowedOrigins, setEmbedAllowedOrigins] = useState<string[] | null>(embedded ? null : []);
  const [embedAllowLoopbackOrigins, setEmbedAllowLoopbackOrigins] = useState(false);
  const selectedThreadId = useRef<string | null>(null);
  const runningRef = useRef(false);
  const turnIdRef = useRef<string | null>(null);
  const interruptedTurnIds = useRef(new Set<string>());
  const embedCommandHandlers = useRef<CodexEmbedCommandHandlers | null>(null);

  useEffect(() => {
    selectedThreadId.current = selected?.id ?? null;
    if (embedded) postCodexEmbedEvent({ event: "thread", threadId: selected?.id ?? null });
  }, [embedded, selected?.id]);

  const loadSidebar = useCallback(async () => {
    try {
      const [threadPage, modelPage] = await Promise.all([
        codex.request<{ data: CodexThread[] }>("thread/list", { limit: 100, sortKey: "recency_at", sortDirection: "desc" }),
        codex.request<{ data: CodexModel[] }>("model/list", { limit: 100 }),
      ]);
      setThreads(threadPage.data);
      const visibleModels = modelPage.data.filter((entry) => !entry.hidden);
      setModels(visibleModels);
      setModel((current) => current || modelPage.data.find((entry) => entry.isDefault)?.model || modelPage.data[0]?.model || "");
      setStatus("ready");
      if (embedded) postCodexEmbedEvent({ event: "ready", status: "ready", modelCount: visibleModels.length });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [embedded]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("codex-web:theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (embedded) postCodexEmbedEvent({ event: "connection", status });
  }, [embedded, status]);

  useEffect(() => {
    void codex.connect().catch((cause) => {
      setStatus("offline");
      setError(cause instanceof Error ? cause.message : String(cause));
    });
    const cleanup = [
      codex.on("connection", (next) => {
        setStatus(next);
        if (next === "ready") {
          setError(null);
          void loadSidebar();
        }
      }),
      codex.on("reconnectError", (cause) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      }),
      codex.on("status", (message) => {
        setStatus(message.status);
      }),
      codex.on("serverRequest", (request) => {
        const requestThreadId = getServerRequestThreadId(request);
        if (!requestThreadId || requestThreadId !== selectedThreadId.current) {
          codex.respondError(request.id, "Request belongs to an inactive browser thread");
          return;
        }
        if (request.method === "currentTime/read") {
          codex.respond(request.id, buildCurrentTimeResponse());
          return;
        }
        setPendingRequests((current) => [...current, request]);
      }),
      codex.on("serverRequest/resolved", (payload) => {
        setPendingRequests((current) => current.filter((request) => request.id !== payload.requestId));
      }),
      codex.on("item/started", (payload) => {
        if (payload.threadId === selectedThreadId.current) setItems((current) => reconcileStreamedItem(current, payload.item));
      }),
      codex.on("item/completed", (payload) => {
        if (payload.threadId === selectedThreadId.current) setItems((current) => reconcileStreamedItem(current, payload.item));
      }),
      codex.on("item/agentMessage/delta", (payload) => {
        if (payload.threadId === selectedThreadId.current) setItems((current) => appendItemDelta(current, payload.itemId, "text", payload.delta));
      }),
      codex.on("item/reasoning/summaryTextDelta", (payload) => {
        if (payload.threadId === selectedThreadId.current) setItems((current) => appendItemDelta(current, payload.itemId, "summary", payload.delta));
      }),
      codex.on("item/reasoning/textDelta", (payload) => {
        if (payload.threadId === selectedThreadId.current) setItems((current) => appendItemDelta(current, payload.itemId, "summary", payload.delta));
      }),
      codex.on("item/commandExecution/outputDelta", (payload) => {
        if (payload.threadId === selectedThreadId.current) setItems((current) => appendItemDelta(current, payload.itemId, "aggregatedOutput", payload.delta));
      }),
      codex.on("turn/started", (payload) => {
        if (payload.threadId === selectedThreadId.current) {
          if (interruptedTurnIds.current.has(payload.turn.id)) return;
          if (turnIdRef.current && turnIdRef.current !== payload.turn.id) return;
          turnIdRef.current = payload.turn.id;
          runningRef.current = true;
          setRunning(true);
          if (embedded) postCodexEmbedEvent({ event: "turn", phase: "started", threadId: payload.threadId, turnId: payload.turn.id });
        }
      }),
      codex.on("turn/completed", (payload) => {
        interruptedTurnIds.current.delete(payload.turn.id);
        if (payload.threadId !== selectedThreadId.current) return;
        if (turnIdRef.current && turnIdRef.current !== payload.turn.id) {
          if (embedded) postCodexEmbedEvent({
            event: "turn",
            phase: "completed",
            threadId: payload.threadId,
            turnId: payload.turn.id,
            status: payload.turn.status,
            ...(payload.turn?.error?.message ? { error: payload.turn.error.message } : {}),
          });
          return;
        }
        turnIdRef.current = null;
        runningRef.current = false;
        setRunning(false);
        if (payload.turn?.error?.message) setError(payload.turn.error.message);
        if (embedded) postCodexEmbedEvent({
          event: "turn",
          phase: "completed",
          threadId: payload.threadId,
          turnId: payload.turn.id,
          status: payload.turn.status,
          ...(payload.turn?.error?.message ? { error: payload.turn.error.message } : {}),
        });
        void loadSidebar();
      }),
      codex.on("error", (payload) => {
        if (!payload.threadId || payload.threadId === selectedThreadId.current) {
          setError(payload.error?.message ?? "Codex reported an error");
        }
      }),
      codex.on("thread/name/updated", () => void loadSidebar()),
    ];
    return () => { cleanup.forEach((off) => off()); codex.close(); };
  }, [embedded, loadSidebar]);

  useEffect(() => {
    if (embedded && error) postCodexEmbedEvent({ event: "error", message: error, threadId: selectedThreadId.current });
  }, [embedded, error]);

  useEffect(() => {
    if (!embedded) return;
    let cancelled = false;
    void fetch(configuredStatusPath, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load embed origin policy (${response.status})`);
        const status = await response.json() as { allowedOrigins?: unknown; allowLoopbackOrigins?: unknown };
        if (!Array.isArray(status.allowedOrigins) || !status.allowedOrigins.every((origin) => typeof origin === "string")) {
          throw new Error("Bridge returned an invalid embed origin policy");
        }
        if (!cancelled) {
          setEmbedAllowedOrigins(status.allowedOrigins);
          setEmbedAllowLoopbackOrigins(status.allowLoopbackOrigins === true);
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [embedded]);

  async function selectThread(thread: CodexThread) {
    dismissPendingRequests("User switched Codex threads");
    setError(null);
    selectedThreadId.current = thread.id;
    setSelected(thread);
    setItems([]);
    setSidebarOpen(false);
    try {
      const response = await codex.request<{ thread: CodexThread; model: string; reasoningEffort: string | null; cwd: string }>("thread/resume", { threadId: thread.id });
      selectedThreadId.current = response.thread.id;
      setSelected(response.thread);
      setItems(flattenItems(response.thread.turns));
      setModel(response.model);
      if (response.reasoningEffort) setEffort(response.reasoningEffort);
      setCwd(response.cwd);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function newThread() {
    dismissPendingRequests("User started a new Codex thread");
    selectedThreadId.current = null;
    setSelected(null);
    setItems([]);
    setDraft("");
    runningRef.current = false;
    turnIdRef.current = null;
    setRunning(false);
    setSidebarOpen(false);
    setError(null);
  }

  async function sendPrompt(input: string, options: CodexEmbedSendOptions = {}) {
    const text = input.trim();
    if (!text) throw new Error("Codex prompt cannot be empty");
    if (runningRef.current) throw new Error("Codex is already running a turn");
    if (status !== "ready") throw new Error("Codex is not ready");
    const turnCwd = options.cwd?.trim() || cwd.trim();
    if (options.cwd) {
      setCwd(turnCwd);
      localStorage.setItem("codex-web:cwd", turnCwd);
    }
    if (options.newThread) newThread();
    runningRef.current = true;
    setError(null);
    try {
      let thread = options.newThread ? null : selected;
      if (!thread) {
        const response = await codex.request<{ thread: CodexThread }>("thread/start", { ...(turnCwd ? { cwd: turnCwd } : {}), ...(model ? { model } : {}) });
        thread = response.thread;
        selectedThreadId.current = thread.id;
        setSelected(thread);
      }
      setItems((current) => [...current, { type: "userMessage", id: `local-${crypto.randomUUID()}`, content: [{ type: "text", text, text_elements: [] }] }]);
      setRunning(true);
      const response = await codex.request<{ turn: { id: string } }>("turn/start", {
        threadId: thread.id,
        input: [{ type: "text", text, text_elements: [] }],
        ...(turnCwd ? { cwd: turnCwd } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(collaborationMode && model ? { collaborationMode: { mode: collaborationMode, settings: { model, reasoning_effort: effort || null, developer_instructions: null } } } : {}),
      });
      turnIdRef.current = response.turn.id;
      return { threadId: thread.id, turnId: response.turn.id };
    } catch (cause) {
      runningRef.current = false;
      turnIdRef.current = null;
      setRunning(false);
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }

  function send() {
    const text = draft.trim();
    if (!text || running || runningRef.current || status !== "ready") return;
    setDraft("");
    void sendPrompt(text).catch(() => undefined);
  }

  async function stop() {
    const activeThreadId = selectedThreadId.current;
    const activeTurnId = turnIdRef.current;
    if (!activeThreadId || !activeTurnId) return;
    interruptedTurnIds.current.add(activeTurnId);
    if (interruptedTurnIds.current.size > 64) {
      interruptedTurnIds.current.delete(interruptedTurnIds.current.values().next().value!);
    }
    try {
      await codex.request("turn/interrupt", { threadId: activeThreadId, turnId: activeTurnId });
    } catch (cause) {
      if (!(cause instanceof Error) || !/no active turn to interrupt/i.test(cause.message)) {
        interruptedTurnIds.current.delete(activeTurnId);
        throw cause;
      }
    }
    turnIdRef.current = null;
    runningRef.current = false;
    setRunning(false);
  }

  embedCommandHandlers.current = {
    send: sendPrompt,
    newThread: () => {
      if (runningRef.current) throw new Error("Stop the active Codex turn before starting a new thread");
      newThread();
    },
    stop,
  };

  useEffect(() => {
    if (!embedded || !embedAllowedOrigins) return;
    return subscribeCodexEmbedCommands({
      send: (text, options) => embedCommandHandlers.current!.send(text, options),
      newThread: () => embedCommandHandlers.current!.newThread(),
      stop: () => embedCommandHandlers.current!.stop(),
    }, embedAllowedOrigins, embedAllowLoopbackOrigins);
  }, [embedded, embedAllowedOrigins, embedAllowLoopbackOrigins]);

  function answerRequest(result: unknown) {
    const request = pendingRequests[0];
    if (!request) return;
    codex.respond(request.id, result);
    setPendingRequests((current) => current.slice(1));
  }

  function rejectRequest(message?: string) {
    const request = pendingRequests[0];
    if (!request) return;
    codex.respondError(request.id, message);
    setPendingRequests((current) => current.slice(1));
  }

  function dismissPendingRequests(message: string) {
    for (const request of pendingRequests) codex.respondError(request.id, message);
    setPendingRequests([]);
  }

  const title = selected?.name || selected?.preview || "New thread";
  const subtitle = selected?.cwd || cwd || "Bridge workspace";
  const activeModel = useMemo(() => models.find((entry) => entry.model === model), [models, model]);
  function updateModel(value: string) { setModel(value); localStorage.setItem("codex-web:model", value); const entry = models.find((item) => item.model === value); if (entry) setEffort(entry.defaultReasoningEffort); }
  function updateEffort(value: string) { setEffort(value); localStorage.setItem("codex-web:effort", value); }
  function updateCwd(value: string) {
    setCwd(value);
    value.trim() ? localStorage.setItem("codex-web:cwd", value) : localStorage.removeItem("codex-web:cwd");
  }

  return (
    <main className={`app-shell ${embedded ? "embedded" : ""}`}>
      {!embedded && <Sidebar threads={threads} selectedId={selected?.id ?? null} open={sidebarOpen} status={status} search={search} dark={dark} onSearch={setSearch} onSelect={selectThread} onNew={newThread} onClose={() => setSidebarOpen(false)} onToggleTheme={() => setDark((value) => !value)} />}
      <section className="workspace">
        <header className="topbar">
          {!embedded && <MobileMenuButton onClick={() => setSidebarOpen(true)} />}
          <div className="thread-heading"><strong>{title}</strong><span><FolderOpen size={12} />{subtitle}</span></div>
          <div className="model-readout">{activeModel?.displayName ?? "Codex"} · {effort}</div>
        </header>
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
        <div className="conversation">
          {items.length ? <Timeline items={items} running={running} /> : <EmptyState status={status} onRefresh={loadSidebar} />}
        </div>
        {pendingRequests[0] && <PendingRequestPanel key={pendingRequests[0].id} request={pendingRequests[0]} onRespond={answerRequest} onReject={rejectRequest} autoFocus={!embedded} />}
        <Composer autoFocus={!embedded} value={draft} running={running} disabled={status !== "ready"} models={models} model={model} effort={effort} cwd={cwd} onChange={setDraft} onSubmit={send} onStop={stop} onModel={updateModel} onEffort={updateEffort} onCwd={updateCwd} />
      </section>
    </main>
  );
}

function readSameOriginPath(params: URLSearchParams, name: string) {
  const value = params.get(name);
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) throw new Error(`${name} must be a same-origin pathname`);
  const parsed = new URL(value, window.location.origin);
  if (parsed.origin !== window.location.origin || parsed.hash) throw new Error(`${name} must be a same-origin pathname without a fragment`);
  return `${parsed.pathname}${parsed.search}`;
}

function webSocketUrl(path: string) {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function EmptyState({ status, onRefresh }: { status: ConnectionStatus; onRefresh: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-mark"><Sparkles size={24} /></div>
      <h1>Talk to your local Codex</h1>
      <p>Start with a task. Codex uses your local account, configuration, skills, and workspace.</p>
      {status !== "ready" && <button onClick={onRefresh}><RefreshCw size={15} />Reconnect</button>}
    </div>
  );
}
