import { ChevronRight, CircleCheck, CircleX, FilePenLine, Search, Terminal, Wrench } from "lucide-react";
import { useState } from "react";
import type { ThreadItem } from "../types";

export function ToolItem({ item }: { item: ThreadItem }) {
  const [open, setOpen] = useState(false);
  const meta = describe(item);
  return (
    <section className={`tool-item ${meta.failed ? "tool-failed" : ""}`}>
      <button className="tool-header" onClick={() => setOpen((value) => !value)}>
        <span className="tool-icon">{meta.icon}</span>
        <span className="tool-label">{String(meta.label)}</span>
        <span className="tool-state">{meta.failed ? <CircleX size={14} /> : meta.done ? <CircleCheck size={14} /> : <span className="spinner" />}</span>
        <ChevronRight className={open ? "rotate" : ""} size={15} />
      </button>
      {open && <pre className="tool-detail">{meta.detail}</pre>}
    </section>
  );
}

function describe(item: ThreadItem) {
  if (item.type === "commandExecution") {
    const failed = item.status === "failed" || (item.exitCode != null && Number(item.exitCode) !== 0);
    return {
      icon: <Terminal size={15} />,
      label: item.command || "Command",
      detail: [item.command, item.aggregatedOutput].filter(Boolean).join("\n\n"),
      failed,
      done: ["completed", "failed", "declined"].includes(item.status),
    };
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const files = changes.map((change: { path?: string }) => change.path ?? "file").join("\n") || "File change";
    return { icon: <FilePenLine size={15} />, label: `Changed ${changes.length} file${changes.length === 1 ? "" : "s"}`, detail: files, failed: item.status === "failed", done: item.status !== "inProgress" };
  }
  if (item.type === "webSearch") {
    return { icon: <Search size={15} />, label: "Searched the web", detail: JSON.stringify(item, null, 2), failed: false, done: true };
  }
  const tool = "tool" in item && typeof item.tool === "string" ? item.tool : item.type;
  const status = "status" in item && typeof item.status === "string" ? item.status : "completed";
  return { icon: <Wrench size={15} />, label: tool, detail: JSON.stringify(item, null, 2), failed: status === "failed", done: !["inProgress", "running"].includes(status) };
}
