import { ShieldAlert } from "lucide-react";
import type { PendingServerRequest } from "../types";

export function ApprovalBar({ request, onDecision }: { request: PendingServerRequest; onDecision: (decision: "accept" | "decline") => void }) {
  const params = request.params;
  const command = typeof params.command === "string" ? params.command : null;
  const reason = typeof params.reason === "string" ? params.reason : null;
  return (
    <div className="approval-bar">
      <ShieldAlert size={18} />
      <div><strong>Codex needs approval</strong><span>{command || reason || "Allow this action?"}</span></div>
      <button onClick={() => onDecision("decline")}>Decline</button>
      <button className="approval-primary" onClick={() => onDecision("accept")}>Allow</button>
    </div>
  );
}
