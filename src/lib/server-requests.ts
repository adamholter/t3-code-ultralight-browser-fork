import type { PendingServerRequest } from "../types";

export interface UserInputOption {
  label: string;
  description: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: UserInputOption[] | null;
}

export type UserInputAnswerValues = Record<string, string[]>;

export function getUserInputQuestions(request: PendingServerRequest): UserInputQuestion[] | null {
  if (request.method !== "item/tool/requestUserInput" || !Array.isArray(request.params.questions)) return null;
  const questions = request.params.questions.filter(isUserInputQuestion);
  return questions.length === request.params.questions.length ? questions : null;
}

export function buildUserInputResponse(answers: UserInputAnswerValues) {
  return {
    answers: Object.fromEntries(
      Object.entries(answers)
        .map(([id, values]) => [id, { answers: values.filter((value) => value.length > 0) }])
        .filter(([, value]) => (value as { answers: string[] }).answers.length > 0),
    ),
  };
}

export function buildApprovalResponse(method: string, decision: "accept" | "decline") {
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: decision === "accept" ? "approved" : "denied" };
  }
  return { decision };
}

export function isApprovalRequest(method: string) {
  return method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method === "execCommandApproval"
    || method === "applyPatchApproval";
}

function isUserInputQuestion(value: unknown): value is UserInputQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Record<string, unknown>;
  return typeof question.id === "string"
    && typeof question.header === "string"
    && typeof question.question === "string"
    && typeof question.isOther === "boolean"
    && typeof question.isSecret === "boolean"
    && (question.options === null || (Array.isArray(question.options) && question.options.every(isUserInputOption)));
}

function isUserInputOption(value: unknown): value is UserInputOption {
  if (!value || typeof value !== "object") return false;
  const option = value as Record<string, unknown>;
  return typeof option.label === "string" && typeof option.description === "string";
}
