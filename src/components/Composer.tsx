import { ArrowUp, ChevronDown, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CodexModel } from "../types";

interface ComposerProps {
  value: string;
  running: boolean;
  disabled: boolean;
  models: CodexModel[];
  model: string;
  effort: string;
  cwd: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  onCwd: (value: string) => void;
}

export function Composer(props: ComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = "0px";
    textarea.current.style.height = `${Math.min(180, Math.max(48, textarea.current.scrollHeight))}px`;
  }, [props.value]);
  const active = props.models.find((model) => model.model === props.model || model.id === props.model);
  const efforts = active?.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort) ?? ["low", "medium", "high"];
  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={textarea}
          autoFocus
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              props.onSubmit();
            }
          }}
          placeholder="Ask Codex to build, explain, or fix something…"
          aria-label="Message Codex"
        />
        <div className="composer-footer">
          <div className="composer-selects">
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
            <input className="cwd-input" value={props.cwd} onChange={(event) => props.onCwd(event.target.value)} aria-label="Working directory" title="Working directory" />
          </div>
          {props.running ? (
            <button className="send-button stop-button" onClick={props.onStop} aria-label="Stop"><Square size={13} fill="currentColor" /></button>
          ) : (
            <button className="send-button" disabled={props.disabled || !props.value.trim()} onClick={props.onSubmit} aria-label="Send"><ArrowUp size={17} /></button>
          )}
        </div>
      </div>
      <p className="composer-hint">Enter to send · Shift Enter for a new line</p>
    </div>
  );
}
