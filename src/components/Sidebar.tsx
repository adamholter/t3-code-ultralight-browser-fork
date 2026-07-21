import { Archive, Menu, Moon, MoreHorizontal, Pencil, Plus, Search, Sun, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CodexThread, ConnectionStatus } from "../types";

interface SidebarProps {
  threads: CodexThread[];
  selectedId: string | null;
  open: boolean;
  status: ConnectionStatus;
  search: string;
  dark: boolean;
  onSearch: (value: string) => void;
  onSelect: (thread: CodexThread) => void;
  onNew: () => void;
  onRename: (thread: CodexThread) => void;
  onArchive: (thread: CodexThread) => void;
  onDelete: (thread: CodexThread) => void;
  onClose: () => void;
  onToggleTheme: () => void;
}

export function Sidebar(props: SidebarProps) {
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const filtered = props.threads.filter((thread) => title(thread).toLowerCase().includes(props.search.toLowerCase()));
  return (
    <>
      {props.open && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={props.onClose} />}
      <aside className={`sidebar ${props.open ? "sidebar-open" : ""}`}>
        <header className="sidebar-header">
          <div className="brand-mark">C</div>
          <strong>Codex Web</strong>
          <button className="icon-button mobile-only" onClick={props.onClose} aria-label="Close sidebar"><X size={18} /></button>
        </header>
        <button className="new-thread" onClick={props.onNew}><Plus size={17} />New thread</button>
        <label className="search-box"><Search size={15} /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Search threads" /></label>
        <div className="thread-list">
          {filtered.map((thread) => <div className={`thread-row-wrap ${thread.id === props.selectedId ? "selected" : ""}`} key={thread.id}>
            <button className="thread-row" onClick={() => props.onSelect(thread)}><span>{title(thread)}</span><small>{formatRecency(thread.recencyAt ?? thread.updatedAt)}</small></button>
            <button className="thread-more" onClick={(event) => { event.stopPropagation(); setMenu(menu === thread.id ? null : thread.id); }} aria-label={`Actions for ${title(thread)}`}><MoreHorizontal size={15} /></button>
            {menu === thread.id && <div className="thread-menu" ref={menuRef}>
              <button onClick={() => { setMenu(null); void props.onRename(thread); }}><Pencil size={13} />Rename</button>
              <button onClick={() => { setMenu(null); void props.onArchive(thread); }}><Archive size={13} />Archive</button>
              <button className="danger" onClick={() => { setMenu(null); void props.onDelete(thread); }}><Trash2 size={13} />Delete</button>
            </div>}
          </div>)}
          {!filtered.length && <p className="sidebar-empty">No threads found</p>}
        </div>
        <footer className="sidebar-footer">
          <span className={`status-dot ${props.status}`} />
          <span>{props.status === "ready" ? "Local Codex" : props.status}</span>
          <button className="icon-button" onClick={props.onToggleTheme} aria-label="Toggle theme">{props.dark ? <Sun size={16} /> : <Moon size={16} />}</button>
        </footer>
      </aside>
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return <button className="icon-button mobile-menu" onClick={onClick} aria-label="Open sidebar"><Menu size={19} /></button>;
}

function title(thread: CodexThread) {
  return thread.name || thread.preview || "Untitled thread";
}

function formatRecency(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
