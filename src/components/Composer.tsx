import { ArrowUp, ChevronDown, ImagePlus, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { CodexModel } from "../types";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

export interface ComposerImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

interface ComposerProps {
  autoFocus?: boolean;
  value: string;
  images: ComposerImageAttachment[];
  running: boolean;
  disabled: boolean;
  models: CodexModel[];
  model: string;
  effort: string;
  cwd: string;
  onChange: (value: string) => void;
  onImagesChange: (images: ComposerImageAttachment[]) => void;
  onSubmit: () => void;
  onStop: () => void;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  onCwd: (value: string) => void;
}

export function Composer(props: ComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "0px";
    textarea.current.style.height = `${Math.min(180, Math.max(48, textarea.current.scrollHeight))}px`;
  }, [props.value]);

  const active = props.models.find((model) => model.model === props.model || model.id === props.model);
  const efforts = active?.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort) ?? ["low", "medium", "high"];

  async function addImages(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      setAttachmentError("Choose an image file.");
      return;
    }
    if (props.images.length + images.length > MAX_IMAGES) {
      setAttachmentError(`Attach up to ${MAX_IMAGES} images.`);
      return;
    }
    if (images.some((file) => file.size > MAX_IMAGE_BYTES)) {
      setAttachmentError("Each image must be 5 MB or smaller.");
      return;
    }
    const totalBytes = props.images.reduce((sum, image) => sum + image.sizeBytes, 0) + images.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      setAttachmentError("Attachments must total 10 MB or less.");
      return;
    }
    setAttachmentError(null);
    setReading(true);
    try {
      const additions = await Promise.all(images.map(async (file) => ({
        id: crypto.randomUUID(),
        name: file.name || "Pasted image",
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl: await readFileAsDataUrl(file),
      })));
      props.onImagesChange([...props.images, ...additions]);
    } catch (cause) {
      setAttachmentError(cause instanceof Error ? cause.message : "Could not read that image.");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  }

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${dragging ? "composer-dragging" : ""}`}
        onDragEnter={onDragEnter}
        onDragOver={(event) => {
          if (!hasImageFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={onDragLeave}
        onDrop={(event) => {
          if (!hasImageFiles(event.dataTransfer)) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void addImages(Array.from(event.dataTransfer.files));
        }}
      >
        {props.images.length > 0 && (
          <div className="composer-attachments" aria-label="Attached images">
            {props.images.map((image) => (
              <div className="composer-attachment" key={image.id}>
                <img src={image.dataUrl} alt={image.name} />
                <button
                  type="button"
                  aria-label={`Remove ${image.name}`}
                  onClick={() => props.onImagesChange(props.images.filter((entry) => entry.id !== image.id))}
                ><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          autoFocus={props.autoFocus}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
            const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
            if (!images.length) return;
            event.preventDefault();
            void addImages(images);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              props.onSubmit();
            }
          }}
          placeholder="Ask Codex to build, explain, or fix something…"
          aria-label="Message Codex"
        />
        {dragging && <div className="composer-drop-target">Drop images here</div>}
        {attachmentError && <p className="attachment-error" role="alert">{attachmentError}</p>}
        <div className="composer-footer">
          <div className="composer-selects">
            <input
              ref={fileInput}
              className="attachment-input"
              type="file"
              accept="image/*"
              multiple
              aria-label="Upload images"
              onChange={(event) => void addImages(Array.from(event.target.files ?? []))}
            />
            <button
              type="button"
              className="attachment-button"
              disabled={props.disabled || props.running || reading || props.images.length >= MAX_IMAGES}
              onClick={() => fileInput.current?.click()}
              aria-label="Attach images"
              title="Attach images"
            ><ImagePlus size={16} /></button>
            <label className="select-control">
              <select value={props.model} onChange={(event) => props.onModel(event.target.value)} aria-label="Model">
                {props.models.map((model) => <option key={model.id} value={model.model}>{model.displayName}</option>)}
              </select><ChevronDown size={13} />
            </label>
            <label className="select-control">
              <select value={props.effort} onChange={(event) => props.onEffort(event.target.value)} aria-label="Reasoning effort">
                {efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
              </select><ChevronDown size={13} />
            </label>
            <input className="cwd-input" value={props.cwd} placeholder="Bridge workspace" onChange={(event) => props.onCwd(event.target.value)} aria-label="Working directory" title="Working directory" />
          </div>
          {props.running ? (
            <button className="send-button stop-button" onClick={props.onStop} aria-label="Stop"><Square size={13} fill="currentColor" /></button>
          ) : (
            <button className="send-button" disabled={props.disabled || reading || (!props.value.trim() && !props.images.length)} onClick={props.onSubmit} aria-label="Send"><ArrowUp size={17} /></button>
          )}
        </div>
      </div>
      <p className="composer-hint">Enter to send · Shift Enter for a new line · Paste or drop images</p>
    </div>
  );
}

function hasImageFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.items).some((item) => item.kind === "file" && item.type.startsWith("image/"));
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read that image."));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}
