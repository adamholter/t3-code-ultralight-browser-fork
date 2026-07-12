import { ShieldAlert } from "lucide-react";
import { useId, useState } from "react";
import { buildApprovalResponse, buildPermissionResponse, buildUserInputResponse, describePermissionRequest, getPermissionRequest, getUserInputQuestions, isApprovalRequest, type PermissionRequest } from "../lib/server-requests";
import type { PendingServerRequest } from "../types";

interface PendingRequestPanelProps {
  request: PendingServerRequest;
  onRespond: (result: unknown) => void;
  onReject: (message?: string) => void;
}

export function PendingRequestPanel({ request, onRespond, onReject }: PendingRequestPanelProps) {
  const questions = getUserInputQuestions(request);
  if (questions) return <UserInputPanel questions={questions} onRespond={onRespond} />;
  const permissions = getPermissionRequest(request);
  if (permissions) return <PermissionPanel request={permissions} onRespond={onRespond} onReject={onReject} />;
  if (isApprovalRequest(request.method)) return <ApprovalBar request={request} onRespond={onRespond} />;
  if (request.method === "mcpServer/elicitation/request") {
    return <UnsupportedRequest request={request} onRespond={onRespond} onReject={() => onRespond({ action: "decline", content: null, _meta: null })} />;
  }
  return <UnsupportedRequest request={request} onRespond={onRespond} onReject={onReject} />;
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

function UserInputPanel({ questions, onRespond }: { questions: NonNullable<ReturnType<typeof getUserInputQuestions>>; onRespond: (result: unknown) => void }) {
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
                    autoFocus={questions.length === 1}
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
