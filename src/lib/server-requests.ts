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

export function getServerRequestThreadId(request: PendingServerRequest) {
  if (typeof request.params.threadId === "string") return request.params.threadId;
  if (typeof request.params.conversationId === "string") return request.params.conversationId;
  return null;
}

export interface PermissionPathEntry {
  path: { type: "path"; path: string } | { type: "glob_pattern"; pattern: string } | { type: "special"; value: string };
  access: "read" | "write" | "deny";
}

export interface FileSystemPermissionRequest {
  read: string[] | null;
  write: string[] | null;
  globScanMaxDepth?: number;
  entries?: PermissionPathEntry[];
}

export interface PermissionRequest {
  cwd: string;
  reason: string | null;
  network: { enabled: boolean | null } | null;
  fileSystem: FileSystemPermissionRequest | null;
}

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

export function getPermissionRequest(request: PendingServerRequest): PermissionRequest | null {
  if (request.method !== "item/permissions/requestApproval") return null;
  const permissions = request.params.permissions;
  if (!permissions || typeof permissions !== "object") return null;
  const profile = permissions as Record<string, unknown>;
  if (!isNetworkPermissions(profile.network) || !isFileSystemPermissions(profile.fileSystem)) return null;
  return {
    cwd: typeof request.params.cwd === "string" ? request.params.cwd : "",
    reason: typeof request.params.reason === "string" ? request.params.reason : null,
    network: profile.network,
    fileSystem: profile.fileSystem,
  };
}

export function buildPermissionResponse(request: PermissionRequest, scope: "turn" | "session", strictAutoReview = false) {
  return {
    permissions: {
      ...(request.network ? { network: request.network } : {}),
      ...(request.fileSystem ? { fileSystem: request.fileSystem } : {}),
    },
    scope,
    ...(strictAutoReview ? { strictAutoReview: true } : {}),
  };
}

export function describePermissionRequest(request: PermissionRequest) {
  const details: string[] = [];
  if (request.network) details.push(request.network.enabled === true ? "Enable network access" : request.network.enabled === false ? "Keep network access disabled" : "Change network access");
  for (const path of request.fileSystem?.read ?? []) details.push(`Read ${path}`);
  for (const path of request.fileSystem?.write ?? []) details.push(`Write ${path}`);
  for (const entry of request.fileSystem?.entries ?? []) details.push(`${titleCase(entry.access)} ${formatPermissionPath(entry.path)}`);
  return details;
}

export function buildCurrentTimeResponse(now = Date.now()) {
  return { currentTimeAt: Math.floor(now / 1_000) };
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

function isNetworkPermissions(value: unknown): value is PermissionRequest["network"] {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const enabled = (value as Record<string, unknown>).enabled;
  return enabled === null || typeof enabled === "boolean";
}

function isFileSystemPermissions(value: unknown): value is PermissionRequest["fileSystem"] {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const fileSystem = value as Record<string, unknown>;
  return isNullableStringArray(fileSystem.read)
    && isNullableStringArray(fileSystem.write)
    && (fileSystem.globScanMaxDepth === undefined || (typeof fileSystem.globScanMaxDepth === "number" && Number.isInteger(fileSystem.globScanMaxDepth)))
    && (fileSystem.entries === undefined || (Array.isArray(fileSystem.entries) && fileSystem.entries.every(isPermissionPathEntry)));
}

function isPermissionPathEntry(value: unknown): value is PermissionPathEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (!["read", "write", "deny"].includes(String(entry.access)) || !entry.path || typeof entry.path !== "object") return false;
  const path = entry.path as Record<string, unknown>;
  return (path.type === "path" && typeof path.path === "string")
    || (path.type === "glob_pattern" && typeof path.pattern === "string")
    || (path.type === "special" && typeof path.value === "string");
}

function isNullableStringArray(value: unknown): value is string[] | null {
  return value === null || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function formatPermissionPath(path: PermissionPathEntry["path"]) {
  if (path.type === "path") return path.path;
  if (path.type === "glob_pattern") return path.pattern;
  return path.value;
}

function titleCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
