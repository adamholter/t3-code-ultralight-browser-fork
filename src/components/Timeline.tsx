import { Bot, Brain, Check, Copy, ListChecks, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ThreadItem } from "../types";
import { userInputImages, userInputText } from "../lib/thread-items";
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
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  if (item.type === "userMessage") {
    const text = userInputText(item.content as any);
    const images = userInputImages(item.content as any);
    return (
      <article className="message user-message">
        <div className="message-mark"><User size={14} /></div>
        <div className="user-message-body">
          {images.length > 0 && (
            <div className={`user-image-grid user-image-grid-${Math.min(images.length, 4)}`}>
              {images.map((image, index) => (
                <button type="button" key={`${image.url}-${index}`} onClick={() => setPreview(image)} aria-label={`Preview ${image.name}`}>
                  <img src={image.url} alt={image.name} />
                </button>
              ))}
            </div>
          )}
          {text && <div className="user-copy">{text}</div>}
          {text && <MessageCopy text={text} label="Copy message" />}
        </div>
        {preview && (
          <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={preview.name} onClick={() => setPreview(null)}>
            <button type="button" aria-label="Close image preview" onClick={() => setPreview(null)}><X size={18} /></button>
            <img src={preview.url} alt={preview.name} onClick={(event) => event.stopPropagation()} />
          </div>
        )}
      </article>
    );
  }
  if (item.type === "agentMessage") {
    if (!item.text) return null;
    const text = String(item.text);
    return (
      <article className="message assistant-message">
        <div className="message-mark"><Bot size={15} /></div>
        <div className="assistant-message-body">
          <div className="markdown"><Markdown children={text} /></div>
          <MessageCopy text={text} label="Copy response" />
        </div>
      </article>
    );
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

function MessageCopy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <button type="button" className="message-copy-button" onClick={() => void copy()} aria-label={copied ? "Copied" : label} title={copied ? "Copied" : label}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}
