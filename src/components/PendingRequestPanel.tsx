import { ShieldAlert } from "lucide-react";
import { useId, useState } from "react";
import { buildApprovalResponse, buildMcpElicitationAction, buildMcpElicitationResponse, buildPermissionResponse, buildUserInputResponse, describePermissionRequest, getMcpElicitationDefaults, getMcpElicitationRequest, getPermissionRequest, getUserInputQuestions, isApprovalRequest, isMcpElicitationComplete, type McpElicitationRequest, type McpElicitationValues, type PermissionRequest } from "../lib/server-requests";
import type { PendingServerRequest } from "../types";

interface PendingRequestPanelProps {
  autoFocus?: boolean;
  request: PendingServerRequest;
  onRespond: (result: unknown) => void;
  onReject: (message?: string) => void;
}

export function PendingRequestPanel({ request, onRespond, onReject, autoFocus }: PendingRequestPanelProps) {
  const questions = getUserInputQuestions(request);
  if (questions) return <UserInputPanel questions={questions} onRespond={onRespond} autoFocus={autoFocus} />;
  const permissions = getPermissionRequest(request);
  if (permissions) return <PermissionPanel request={permissions} onRespond={onRespond} onReject={onReject} />;
  const elicitation = getMcpElicitationRequest(request);
  if (elicitation) return <McpElicitationPanel request={elicitation} onRespond={onRespond} />;
  if (isApprovalRequest(request.method)) return <ApprovalBar request={request} onRespond={onRespond} />;
  if (request.method === "mcpServer/elicitation/request") {
    return <UnsupportedRequest request={request} onRespond={onRespond} onReject={() => onRespond({ action: "decline", content: null, _meta: null })} />;
  }
  return <UnsupportedRequest request={request} onRespond={onRespond} onReject={onReject} />;
}

function McpElicitationPanel({ request, onRespond }: { request: McpElicitationRequest; onRespond: (result: unknown) => void }) {
  return request.mode === "url"
    ? <McpUrlPanel request={request} onRespond={onRespond} />
    : <McpFormPanel request={request} onRespond={onRespond} />;
}

function McpUrlPanel({ request, onRespond }: { request: Extract<McpElicitationRequest, { mode: "url" }>; onRespond: (result: unknown) => void }) {
  const headingId = useId();
  const host = new URL(request.url).host;
  return (
    <section className="permission-panel mcp-panel" aria-labelledby={headingId}>
      <div className="request-heading">
        <strong id={headingId}>{request.serverName} needs authorization</strong>
        <span>{request.message}</span>
      </div>
      <a className="mcp-open-link" href={request.url} target="_blank" rel="noreferrer noopener">Open {host}</a>
      <p className="mcp-help">Complete the flow in the new tab, then return here to continue Codex.</p>
      <div className="request-actions">
        <button type="button" onClick={() => onRespond(buildMcpElicitationAction("decline"))}>Decline</button>
        <button type="button" className="request-primary" onClick={() => onRespond(buildMcpElicitationAction("accept"))}>I’ve finished</button>
      </div>
    </section>
  );
}

function McpFormPanel({ request, onRespond }: { request: Extract<McpElicitationRequest, { mode: "form" | "openai/form" }>; onRespond: (result: unknown) => void }) {
  const [values, setValues] = useState<McpElicitationValues>(() => getMcpElicitationDefaults(request));
  const headingId = useId();
  const complete = isMcpElicitationComplete(request, values);
  const update = (id: string, value: McpElicitationValues[string]) => setValues((current) => ({ ...current, [id]: value }));
  return (
    <form className="permission-panel mcp-panel" aria-labelledby={headingId} onSubmit={(event) => {
      event.preventDefault();
      if (complete) onRespond(buildMcpElicitationResponse(request, values));
    }}>
      <div className="request-heading">
        <strong id={headingId}>{request.serverName} needs information</strong>
        <span>{request.message}</span>
      </div>
      <div className="mcp-fields">
        {request.fields.map((field) => (
          <div className="mcp-field" key={field.id}>
            <label htmlFor={`${headingId}-${field.id}`}><strong>{field.title}{field.required && <span aria-label="required"> *</span>}</strong>{field.description && <small>{field.description}</small>}</label>
            {field.type === "text" && <input id={`${headingId}-${field.id}`} type={field.format === "uri" ? "url" : field.format === "date-time" ? "datetime-local" : field.format ?? "text"} required={field.required} minLength={field.minLength} maxLength={field.maxLength} value={String(values[field.id] ?? "")} onChange={(event) => update(field.id, event.target.value)} />}
            {(field.type === "number" || field.type === "integer") && <input id={`${headingId}-${field.id}`} type="number" required={field.required} step={field.type === "integer" ? 1 : "any"} min={field.minimum} max={field.maximum} value={String(values[field.id] ?? "")} onChange={(event) => update(field.id, event.target.value === "" ? "" : Number(event.target.value))} />}
            {field.type === "boolean" && <label className="mcp-boolean"><input id={`${headingId}-${field.id}`} type="checkbox" checked={Boolean(values[field.id])} onChange={(event) => update(field.id, event.target.checked)} /><span>Yes</span></label>}
            {field.type === "select" && <select id={`${headingId}-${field.id}`} required={field.required} value={String(values[field.id] ?? "")} onChange={(event) => update(field.id, event.target.value)}><option value="">Choose an option</option>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>}
            {field.type === "multiselect" && <div className="mcp-options">{field.options.map((option) => { const selected = Array.isArray(values[field.id]) ? values[field.id] as string[] : []; return <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={(event) => update(field.id, event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))} /><span>{option.label}</span></label>; })}</div>}
          </div>
        ))}
      </div>
      <div className="request-actions">
        <button type="button" onClick={() => onRespond(buildMcpElicitationAction("decline"))}>Decline</button>
        <button type="submit" className="request-primary" disabled={!complete}>Continue</button>
      </div>
    </form>
  );
}

function PermissionPanel({ request, onRespond, onReject }: { request: PermissionRequest; onRespond: (result: unknown) => void; onReject: (message?: string) => void }) {
  const [strictAutoReview, setStrictAutoReview] = useState(false);
  const headingId = useId();
  const details = describePermissionRequest(request);
  return (
    <section className="permission-panel" aria-labelledby={headingId}>
      <div className="request-heading">
        <strong id={headingId}>Codex requests additional permissions</strong>
        <span>{request.reason || "Review the requested access before continuing."}</span>
      </div>
      {request.cwd && <div className="permission-cwd">Working in {request.cwd}</div>}
      <ul className="permission-list">
        {details.length ? details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>) : <li>No additional capabilities were described.</li>}
      </ul>
      <label className="permission-review">
        <input type="checkbox" checked={strictAutoReview} onChange={(event) => setStrictAutoReview(event.target.checked)} />
        <span><strong>Review every later command</strong><small>Keep command-by-command review enabled for the rest of this turn.</small></span>
      </label>
      <div className="request-actions permission-actions">
        <button type="button" onClick={() => onReject("Permission request declined")}>Decline</button>
        <button type="button" className="request-primary" onClick={() => onRespond(buildPermissionResponse(request, "turn", strictAutoReview))}>Allow for this turn</button>
        <button type="button" className="request-primary" onClick={() => onRespond(buildPermissionResponse(request, "session", strictAutoReview))}>Allow for session</button>
      </div>
    </section>
  );
}

function UserInputPanel({ questions, onRespond, autoFocus }: { questions: NonNullable<ReturnType<typeof getUserInputQuestions>>; onRespond: (result: unknown) => void; autoFocus?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, boolean>>({});
  const complete = questions.every((question) => (answers[question.id] ?? "").length > 0);

  function choose(id: string, value: string, isOther = false) {
    setAnswers((current) => ({ ...current, [id]: value }));
    setOther((current) => ({ ...current, [id]: isOther }));
  }

  return (
    <form className="user-input-panel" onSubmit={(event) => {
      event.preventDefault();
      if (!complete) return;
      onRespond(buildUserInputResponse(Object.fromEntries(Object.entries(answers).map(([id, value]) => [id, [value]]))));
    }}>
      <div className="request-heading">
        <strong>Codex has a question</strong>
        <span>Answer to continue the current turn.</span>
      </div>
      <div className="request-questions">
        {questions.map((question) => {
          const hasOptions = Boolean(question.options?.length);
          return (
            <fieldset key={question.id}>
              <legend><span>{question.header}</span>{question.question}</legend>
              {question.options?.map((option) => (
                <label className="request-option" key={option.label}>
                  <input type="radio" name={question.id} value={option.label} checked={!other[question.id] && answers[question.id] === option.label} onChange={() => choose(question.id, option.label)} />
                  <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                </label>
              ))}
              {question.isOther && hasOptions && (
                <label className="request-option">
                  <input type="radio" name={question.id} checked={Boolean(other[question.id])} onChange={() => choose(question.id, "", true)} />
                  <span><strong>Other</strong><small>Enter a different answer.</small></span>
                </label>
              )}
              {(!hasOptions || other[question.id]) && (
                <label className="request-text">
                  <span>{hasOptions ? "Other answer" : "Your answer"}</span>
                  <input
                    autoFocus={autoFocus && questions.length === 1}
                    type={question.isSecret ? "password" : "text"}
                    value={answers[question.id] ?? ""}
                    onChange={(event) => choose(question.id, event.target.value, Boolean(other[question.id]))}
                    autoComplete="off"
                  />
                </label>
              )}
            </fieldset>
          );
        })}
      </div>
      <div className="request-actions">
        <button type="button" onClick={() => onRespond({ answers: {} })}>Skip</button>
        <button type="submit" className="request-primary" disabled={!complete}>Continue</button>
      </div>
    </form>
  );
}

function ApprovalBar({ request, onRespond }: Omit<PendingRequestPanelProps, "onReject">) {
  const command = typeof request.params.command === "string" ? request.params.command : null;
  const reason = typeof request.params.reason === "string" ? request.params.reason : null;
  return (
    <div className="approval-bar">
      <ShieldAlert size={18} />
      <div><strong>Codex needs approval</strong><span>{command || reason || "Allow this action?"}</span></div>
      <button onClick={() => onRespond(buildApprovalResponse(request.method, "decline"))}>Decline</button>
      <button className="approval-primary" onClick={() => onRespond(buildApprovalResponse(request.method, "accept"))}>Allow</button>
    </div>
  );
}

function UnsupportedRequest({ request, onReject }: PendingRequestPanelProps) {
  return (
    <div className="approval-bar">
      <ShieldAlert size={18} />
      <div><strong>Codex requested an unsupported interaction</strong><span>{request.method}</span></div>
      <button onClick={() => onReject(`Unsupported browser interaction: ${request.method}`)}>Decline</button>
    </div>
  );
}
