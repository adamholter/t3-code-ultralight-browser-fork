import { ArrowUp, Bot, ChevronDown, File, Folder, ImagePlus, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { CodexFileMatch, CodexModel, CodexSkill, ComposerContextItem, PermissionMode, TokenUsage } from "../types";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

export interface ComposerImageAttachment { id: string; name: string; mimeType: string; sizeBytes: number; dataUrl: string }

interface ComposerProps {
  autoFocus?: boolean;
  value: string;
  images: ComposerImageAttachment[];
  context: ComposerContextItem[];
  running: boolean;
  disabled: boolean;
  models: CodexModel[];
  skills: CodexSkill[];
  model: string;
  effort: string;
  cwd: string;
  collaborationMode: "build" | "plan";
  permissionMode: PermissionMode;
  tokenUsage: TokenUsage | null;
  onChange: (value: string) => void;
  onImagesChange: (images: ComposerImageAttachment[]) => void;
  onContextChange: (items: ComposerContextItem[]) => void;
  onSubmit: () => void;
  onStop: () => void;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  onCwd: (value: string) => void;
  onCollaborationMode: (value: "build" | "plan") => void;
  onPermissionMode: (value: PermissionMode) => void;
  onSearchFiles: (query: string) => Promise<CodexFileMatch[]>;
}

type Suggestion = { id: string; type: "mention" | "skill" | "command"; name: string; detail: string; path?: string; directory?: boolean };

export function Composer(props: ComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ComposerImageAttachment | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);

  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "0px";
    textarea.current.style.height = `${Math.min(180, Math.max(48, textarea.current.scrollHeight))}px`;
  }, [props.value]);

  const trigger = useMemo(() => findTrigger(props.value), [props.value]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!trigger) return setSuggestions([]);
      let next: Suggestion[] = [];
      if (trigger.kind === "@") {
        next = (await props.onSearchFiles(trigger.query)).slice(0, 8).map((entry) => ({
          id: `mention:${entry.path}`, type: "mention", name: entry.file_name, path: entry.path,
          detail: entry.path, directory: entry.match_type === "directory",
        }));
      } else if (trigger.kind === "$") {
        next = props.skills.filter((skill) => skill.enabled && matches(skill.name, trigger.query)).slice(0, 8).map((skill) => ({
          id: `skill:${skill.path}`, type: "skill", name: skill.name, path: skill.path,
          detail: skill.shortDescription || skill.description,
        }));
      } else {
        next = commands.filter((entry) => matches(entry.name, trigger.query));
      }
      if (!cancelled) { setSuggestions(next); setActiveSuggestion(0); }
    }, trigger?.kind === "@" ? 120 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [trigger?.kind, trigger?.query, props.skills, props.onSearchFiles]);

  const active = props.models.find((entry) => entry.model === props.model || entry.id === props.model);
  const efforts = active?.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort) ?? ["low", "medium", "high"];
  const usedTokens = props.tokenUsage?.total?.totalTokens ?? props.tokenUsage?.last?.totalTokens ?? 0;
  const contextWindow = props.tokenUsage?.modelContextWindow ?? 0;
  const contextPercent = contextWindow ? Math.min(100, Math.round((usedTokens / contextWindow) * 100)) : 0;

  async function addImages(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) return setAttachmentError("Choose an image file.");
    if (props.images.length + images.length > MAX_IMAGES) return setAttachmentError(`Attach up to ${MAX_IMAGES} images.`);
    if (images.some((file) => file.size > MAX_IMAGE_BYTES)) return setAttachmentError("Each image must be 5 MB or smaller.");
    if (props.images.reduce((sum, image) => sum + image.sizeBytes, 0) + images.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) return setAttachmentError("Attachments must total 10 MB or less.");
    setAttachmentError(null); setReading(true);
    try {
      const additions = await Promise.all(images.map(async (file) => ({ id: crypto.randomUUID(), name: file.name || "Pasted image", mimeType: file.type, sizeBytes: file.size, dataUrl: await readFileAsDataUrl(file) })));
      props.onImagesChange([...props.images, ...additions]);
    } catch (cause) { setAttachmentError(cause instanceof Error ? cause.message : "Could not read that image."); }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  function choose(suggestion: Suggestion) {
    if (!trigger) return;
    props.onChange(`${props.value.slice(0, trigger.start)}${props.value.slice(trigger.end)}`);
    if (suggestion.type === "command") {
      if (suggestion.name === "plan") props.onCollaborationMode("plan");
      if (suggestion.name === "build") props.onCollaborationMode("build");
      if (suggestion.name === "supervised") props.onPermissionMode("supervised");
      if (suggestion.name === "auto-edit") props.onPermissionMode("auto-edit");
      if (suggestion.name === "full-access") props.onPermissionMode("full-access");
    } else if (suggestion.path && !props.context.some((entry) => entry.type === suggestion.type && entry.path === suggestion.path)) {
      props.onContextChange([...props.context, { id: crypto.randomUUID(), type: suggestion.type, name: suggestion.name, path: suggestion.path }]);
    }
    setSuggestions([]); textarea.current?.focus();
  }

  return (
    <div className="composer-wrap">
      <div className={`composer ${dragging ? "composer-dragging" : ""}`} onDragEnter={(event) => { if (!hasImageFiles(event.dataTransfer)) return; event.preventDefault(); dragDepth.current += 1; setDragging(true); }} onDragOver={(event) => { if (hasImageFiles(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDragLeave={(event) => { if (!hasImageFiles(event.dataTransfer)) return; event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={(event) => { if (!hasImageFiles(event.dataTransfer)) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); void addImages(Array.from(event.dataTransfer.files)); }}>
        {(props.images.length > 0 || props.context.length > 0) && <div className="composer-context">
          {props.images.map((image) => <div className="composer-attachment" key={image.id}><button className="attachment-preview" type="button" onClick={() => setPreview(image)} aria-label={`Preview ${image.name}`}><img src={image.dataUrl} alt={image.name} /></button><button type="button" aria-label={`Remove ${image.name}`} onClick={() => props.onImagesChange(props.images.filter((entry) => entry.id !== image.id))}><X size={12} /></button></div>)}
          {props.context.map((entry) => <div className="context-item" key={entry.id}>{entry.type === "skill" ? <Sparkles size={13} /> : <File size={13} />}<span>{entry.type === "skill" ? "$" : "@"}{entry.name}</span><button type="button" aria-label={`Remove ${entry.name}`} onClick={() => props.onContextChange(props.context.filter((item) => item.id !== entry.id))}><X size={12} /></button></div>)}
        </div>}
        <textarea ref={textarea} autoFocus={props.autoFocus} value={props.value} onChange={(event) => props.onChange(event.target.value)} onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => { const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (images.length) { event.preventDefault(); void addImages(images); } }} onKeyDown={(event) => {
          if (suggestions.length && ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "ArrowDown") setActiveSuggestion((value) => (value + 1) % suggestions.length);
            else if (event.key === "ArrowUp") setActiveSuggestion((value) => (value - 1 + suggestions.length) % suggestions.length);
            else if (event.key === "Escape") setSuggestions([]);
            else choose(suggestions[activeSuggestion]);
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); props.onSubmit(); }
        }} placeholder="Ask Codex… Use @ for files, $ for skills, / for commands" aria-label="Message Codex" />
        {suggestions.length > 0 && <div className="composer-menu" role="listbox">{suggestions.map((entry, index) => <button type="button" role="option" aria-selected={index === activeSuggestion} className={index === activeSuggestion ? "active" : ""} key={entry.id} onMouseDown={(event) => { event.preventDefault(); choose(entry); }}><span>{entry.directory ? <Folder size={14} /> : entry.type === "skill" ? <Sparkles size={14} /> : entry.type === "command" ? <Bot size={14} /> : <File size={14} />}</span><strong>{entry.type === "skill" ? "$" : entry.type === "command" ? "/" : "@"}{entry.name}</strong><small>{entry.detail}</small></button>)}</div>}
        {dragging && <div className="composer-drop-target">Drop images here</div>}
        {attachmentError && <p className="attachment-error" role="alert">{attachmentError}</p>}
        <div className="composer-footer">
          <div className="composer-selects">
            <input ref={fileInput} className="attachment-input" type="file" accept="image/*" multiple aria-label="Upload images" onChange={(event) => void addImages(Array.from(event.target.files ?? []))} />
            <button type="button" className="attachment-button" disabled={props.disabled || props.running || reading || props.images.length >= MAX_IMAGES} onClick={() => fileInput.current?.click()} aria-label="Attach images" title="Attach images"><ImagePlus size={16} /></button>
            <label className="select-control mode-control"><select value={props.collaborationMode} onChange={(event) => props.onCollaborationMode(event.target.value as "build" | "plan")} aria-label="Collaboration mode"><option value="build">Build</option><option value="plan">Plan</option></select><ChevronDown size={13} /></label>
            <label className="select-control permission-control" title="Codex permission mode"><ShieldCheck size={13} /><select value={props.permissionMode} onChange={(event) => props.onPermissionMode(event.target.value as PermissionMode)} aria-label="Permission mode"><option value="supervised">Supervised</option><option value="auto-edit">Auto edits</option><option value="full-access">Full access</option></select><ChevronDown size={13} /></label>
            <label className="select-control"><select value={props.model} onChange={(event) => props.onModel(event.target.value)} aria-label="Model">{props.models.map((entry) => <option key={entry.id} value={entry.model}>{entry.displayName}</option>)}</select><ChevronDown size={13} /></label>
            <label className="select-control effort-control"><select value={props.effort} onChange={(event) => props.onEffort(event.target.value)} aria-label="Reasoning effort">{efforts.map((value) => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={13} /></label>
            <input className="cwd-input" value={props.cwd} placeholder="Bridge workspace" onChange={(event) => props.onCwd(event.target.value)} aria-label="Working directory" title="Working directory" />
          </div>
          <div className="composer-actions">{contextWindow > 0 && <span className="context-meter" title={`${usedTokens.toLocaleString()} of ${contextWindow.toLocaleString()} context tokens`}>{contextPercent}%</span>}{props.running ? <button className="send-button stop-button" onClick={props.onStop} aria-label="Stop"><Square size={13} fill="currentColor" /></button> : <button className="send-button" disabled={props.disabled || reading || (!props.value.trim() && !props.images.length && !props.context.length)} onClick={props.onSubmit} aria-label="Send"><ArrowUp size={17} /></button>}</div>
        </div>
      </div>
      <p className="composer-hint">Enter to send · Shift Enter for a new line · Paste or drop images</p>
      {preview && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={preview.name} onClick={() => setPreview(null)}><button type="button" aria-label="Close image preview" onClick={() => setPreview(null)}><X size={18} /></button><img src={preview.dataUrl} alt={preview.name} onClick={(event) => event.stopPropagation()} /></div>}
    </div>
  );
}

const commands: Suggestion[] = [
  { id: "command:plan", type: "command", name: "plan", detail: "Plan before editing" },
  { id: "command:build", type: "command", name: "build", detail: "Implement changes" },
  { id: "command:supervised", type: "command", name: "supervised", detail: "Ask before commands and edits" },
  { id: "command:auto-edit", type: "command", name: "auto-edit", detail: "Allow workspace edits; ask for risky actions" },
  { id: "command:full-access", type: "command", name: "full-access", detail: "Allow commands and edits" },
];

function findTrigger(value: string) {
  const match = value.match(/(?:^|\s)([@$/])([^\s@$/]*)$/);
  if (!match || match.index == null) return null;
  const offset = match[0].startsWith(" ") || match[0].startsWith("\n") || match[0].startsWith("\t") ? 1 : 0;
  return { kind: match[1] as "@" | "$" | "/", query: match[2], start: match.index + offset, end: value.length };
}
function matches(value: string, query: string) { return value.toLowerCase().includes(query.toLowerCase()); }
function hasImageFiles(dataTransfer: DataTransfer) { return Array.from(dataTransfer.items).some((item) => item.kind === "file" && item.type.startsWith("image/")); }
function readFileAsDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read that image.")); reader.onerror = () => reject(reader.error ?? new Error("Could not read that image.")); reader.readAsDataURL(file); }); }
