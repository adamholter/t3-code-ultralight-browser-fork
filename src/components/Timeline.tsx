import { Bot, Brain, ListChecks, User } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ThreadItem } from "../types";
import { userInputText } from "../lib/thread-items";
import { Markdown } from "./Markdown";
import { ToolItem } from "./ToolItem";

export function Timeline({ items, running }: { items: ThreadItem[]; running: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: running ? "instant" : "smooth", block: "end" }), [items, running]);
  return (
    <div className="timeline" aria-live="polite">
      {items.map((item, index) => <TimelineItem item={item} key={item.id ?? `${item.type}-${index}`} />)}
      {running && <div className="working"><span className="working-dot" /><span>Codex is working</span></div>}
      <div ref={endRef} />
    </div>
  );
}

function TimelineItem({ item }: { item: ThreadItem }) {
  if (item.type === "userMessage") {
    return <article className="message user-message"><div className="message-mark"><User size={14} /></div><div className="user-copy">{userInputText(item.content as any)}</div></article>;
  }
  if (item.type === "agentMessage") {
    if (!item.text) return null;
    return <article className="message assistant-message"><div className="message-mark"><Bot size={15} /></div><div className="markdown"><Markdown children={String(item.text)} /></div></article>;
  }
  if (item.type === "reasoning") {
    const text = [...(Array.isArray(item.summary) ? item.summary : []), ...(Array.isArray(item.content) ? item.content : [])].filter(Boolean).join("\n");
    if (!text) return null;
    return <details className="reasoning"><summary><Brain size={14} />Reasoning</summary><div><Markdown>{text}</Markdown></div></details>;
  }
  if (item.type === "plan") {
    return <article className="plan"><header><ListChecks size={15} />Plan</header><Markdown children={String(item.text)} /></article>;
  }
  return <ToolItem item={item} />;
}
