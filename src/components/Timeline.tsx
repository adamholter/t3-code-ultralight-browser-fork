import { Bot, Brain, Check, ChevronDown, Copy, Download, ListChecks, Play, RotateCcw, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ThreadItem } from "../types";
import { userInputContext, userInputImages, userInputText } from "../lib/thread-items";
import { Markdown } from "./Markdown";
import { ToolItem } from "./ToolItem";

type Group = { type: "item"; item: ThreadItem } | { type: "work"; items: ThreadItem[] };

export function Timeline({ items, running, onRollback, onImplementPlan }: { items: ThreadItem[]; running: boolean; onRollback: (numTurns: number) => void; onImplementPlan: (text: string, fresh: boolean) => void }) {
  const endRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const groups = useMemo(() => groupItems(items), [items]);

  useEffect(() => {
    const root = endRef.current?.closest(".conversation");
    if (!root) return;
    const onScroll = () => { const next = root.scrollHeight - root.scrollTop - root.clientHeight < 80; atBottom.current = next; setShowLatest(!next); };
    root.addEventListener("scroll", onScroll, { passive: true }); onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { if (atBottom.current) endRef.current?.scrollIntoView({ behavior: "instant", block: "end" }); }, [items, running]);

  return <div className="timeline" aria-live="polite">
    {groups.map((group, index) => group.type === "work"
      ? <WorkGroup items={group.items} running={running && index === groups.length - 1} key={`work-${group.items[0]?.id ?? index}`} />
      : <TimelineItem item={group.item} onRollback={onRollback} onImplementPlan={onImplementPlan} key={group.item.id ?? `${group.item.type}-${index}`} />)}
    {running && <div className="working"><span className="working-dot" /><span>Codex is working</span></div>}
    <div ref={endRef} />
    {showLatest && <button className="jump-latest" onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}>Jump to latest <ChevronDown size={14} /></button>}
  </div>;
}

function groupItems(items: ThreadItem[]) {
  const groups: Group[] = [];
  for (const item of items) {
    const work = !["userMessage", "agentMessage", "plan"].includes(item.type);
    const previous = groups.at(-1);
    if (work && previous?.type === "work") previous.items.push(item);
    else groups.push(work ? { type: "work", items: [item] } : { type: "item", item });
  }
  return groups;
}

function WorkGroup({ items, running }: { items: ThreadItem[]; running: boolean }) {
  const [open, setOpen] = useState(running);
  useEffect(() => { if (running) setOpen(true); }, [running]);
  const failures = items.filter((item) => (item as any).status === "failed").length;
  const commands = items.filter((item) => item.type === "commandExecution").length;
  const files = items.filter((item) => item.type === "fileChange").reduce((count, item) => count + (Array.isArray((item as any).changes) ? (item as any).changes.length : 0), 0);
  const detail = [commands && `${commands} command${commands === 1 ? "" : "s"}`, files && `${files} file${files === 1 ? "" : "s"}`, failures && `${failures} failed`].filter(Boolean).join(" · ");
  return <section className={`work-group ${running ? "running" : ""}`}>
    <button className="work-group-header" onClick={() => setOpen((value) => !value)}><Brain size={14} /><span>{running ? "Working" : `Worked through ${items.length} step${items.length === 1 ? "" : "s"}`}</span>{detail && <small>{detail}</small>}<ChevronDown className={open ? "rotate" : ""} size={14} /></button>
    {open && <div className="work-group-items">{items.map((item, index) => item.type === "reasoning" ? <Reasoning item={item} key={item.id ?? index} /> : <ToolItem item={item} key={item.id ?? index} />)}</div>}
  </section>;
}

function TimelineItem({ item, onRollback, onImplementPlan }: { item: ThreadItem; onRollback: (numTurns: number) => void; onImplementPlan: (text: string, fresh: boolean) => void }) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  if (item.type === "userMessage") {
    const text = userInputText(item.content as any); const images = userInputImages(item.content as any); const context = userInputContext(item.content as any);
    return <article className="message user-message"><div className="message-mark"><User size={14} /></div><div className="user-message-body">
      {images.length > 0 && <div className={`user-image-grid user-image-grid-${Math.min(images.length, 4)}`}>{images.map((image, index) => <button type="button" key={`${image.url}-${index}`} onClick={() => setPreview(image)} aria-label={`Preview ${image.name}`}><img src={image.url} alt={image.name} /></button>)}</div>}
      {context.length > 0 && <div className="message-context">{context.map((entry) => <span key={`${entry.type}:${entry.path}`}>{entry.type === "skill" ? "$" : "@"}{entry.name}</span>)}</div>}
      {text && <div className="user-copy">{text}</div>}
      <div className="message-actions">{text && <MessageCopy text={text} label="Copy message" />}{Number((item as any)._turnsAfter) > 0 && <button type="button" className="message-copy-button" onClick={() => onRollback(Number((item as any)._turnsAfter))} aria-label="Revert thread to here" title="Revert thread to here"><RotateCcw size={13} /></button>}</div>
    </div>{preview && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={preview.name} onClick={() => setPreview(null)}><button type="button" aria-label="Close image preview" onClick={() => setPreview(null)}><X size={18} /></button><img src={preview.url} alt={preview.name} onClick={(event) => event.stopPropagation()} /></div>}</article>;
  }
  if (item.type === "agentMessage") {
    if (!item.text) return null; const text = String(item.text);
    return <article className="message assistant-message"><div className="message-mark"><Bot size={15} /></div><div className="assistant-message-body"><div className="markdown"><Markdown>{text}</Markdown></div><MessageCopy text={text} label="Copy response" /></div></article>;
  }
  if (item.type === "plan") return <Plan item={item} onImplement={onImplementPlan} />;
  return null;
}

function Reasoning({ item }: { item: ThreadItem }) {
  const value = item as any;
  const text = [...(Array.isArray(value.summary) ? value.summary : []), ...(Array.isArray(value.content) ? value.content : [])].filter(Boolean).join("\n");
  return text ? <details className="reasoning"><summary><Brain size={14} />Reasoning</summary><div><Markdown>{text}</Markdown></div></details> : null;
}

function Plan({ item, onImplement }: { item: ThreadItem; onImplement: (text: string, fresh: boolean) => void }) {
  const text = String((item as any).text ?? "");
  function download() { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); link.download = "codex-plan.md"; link.click(); URL.revokeObjectURL(link.href); }
  return <article className="plan"><header><span><ListChecks size={15} />Plan</span><div><MessageCopy text={text} label="Copy plan" /><button onClick={download} aria-label="Download plan"><Download size={13} /></button></div></header><div className="markdown"><Markdown>{text}</Markdown></div><footer><button onClick={() => onImplement(text, false)}><Play size={13} />Implement</button><button onClick={() => onImplement(text, true)}>New thread</button></footer></article>;
}

function MessageCopy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }
  return <button type="button" className="message-copy-button" onClick={() => void copy()} aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>;
}
