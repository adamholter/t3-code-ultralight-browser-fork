import { CodexSession, type CodexSessionOptions } from "./codex-client.js";
import {
  attachCodexSessionRequestHandlers,
  type CodexRequestHandlers,
} from "./server-requests.js";

export interface CodexAssistantOptions extends CodexSessionOptions {
  /** Browser UI handlers for approvals, questions, permissions, and MCP elicitation. Missing handlers decline safely. */
  requestHandlers?: CodexRequestHandlers;
}

/**
 * Smallest safe custom-UI surface: a stateful Codex session with one scoped,
 * fail-closed request adapter whose lifecycle follows the session.
 */
export class CodexAssistant extends CodexSession {
  private readonly detachRequests: () => void;
  private assistantClosePromise: Promise<void> | null = null;

  constructor(options: CodexAssistantOptions = {}) {
    const { requestHandlers, ...sessionOptions } = options;
    super(sessionOptions);
    this.detachRequests = attachCodexSessionRequestHandlers(this, requestHandlers);
  }

  override close() {
    if (this.assistantClosePromise) return this.assistantClosePromise;
    this.assistantClosePromise = super.close().finally(() => this.detachRequests());
    return this.assistantClosePromise;
  }
}

export function createCodexAssistant(options: CodexAssistantOptions = {}) {
  return new CodexAssistant(options);
}

export type {
  CodexRequestHandlers,
  McpElicitationRequest,
  McpElicitationValues,
  PermissionRequest,
  UserInputAnswerValues,
  UserInputQuestion,
} from "./server-requests.js";
