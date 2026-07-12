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

interface McpFieldBase {
  id: string;
  title: string;
  description: string;
  required: boolean;
}

export type McpElicitationField =
  | (McpFieldBase & { type: "text"; format?: "email" | "uri" | "date" | "date-time"; minLength?: number; maxLength?: number; default?: string })
  | (McpFieldBase & { type: "number" | "integer"; minimum?: number; maximum?: number; default?: number })
  | (McpFieldBase & { type: "boolean"; default: boolean })
  | (McpFieldBase & { type: "select"; options: Array<{ value: string; label: string }>; default?: string })
  | (McpFieldBase & { type: "multiselect"; options: Array<{ value: string; label: string }>; minItems?: number; maxItems?: number; default: string[] });

export type McpElicitationRequest =
  | { mode: "form" | "openai/form"; serverName: string; message: string; fields: McpElicitationField[] }
  | { mode: "url"; serverName: string; message: string; url: string; elicitationId: string };

export type McpElicitationValues = Record<string, string | number | boolean | string[]>;

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

export function getMcpElicitationRequest(request: PendingServerRequest): McpElicitationRequest | null {
  if (request.method !== "mcpServer/elicitation/request") return null;
  const { mode, serverName, message } = request.params;
  if (typeof serverName !== "string" || typeof message !== "string") return null;
  if (mode === "url") {
    if (typeof request.params.url !== "string" || typeof request.params.elicitationId !== "string") return null;
    try {
      const url = new URL(request.params.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    } catch {
      return null;
    }
    return { mode, serverName, message, url: request.params.url, elicitationId: request.params.elicitationId };
  }
  if (mode !== "form" && mode !== "openai/form") return null;
  const fields = parseMcpSchema(request.params.requestedSchema);
  return fields ? { mode, serverName, message, fields } : null;
}

export function getMcpElicitationDefaults(request: Extract<McpElicitationRequest, { mode: "form" | "openai/form" }>): McpElicitationValues {
  return Object.fromEntries(request.fields.map((field) => {
    if (field.type === "boolean") return [field.id, field.default];
    if (field.type === "multiselect") return [field.id, field.default];
    if (field.default !== undefined) return [field.id, field.default];
    return [field.id, ""];
  }));
}

export function isMcpElicitationComplete(request: Extract<McpElicitationRequest, { mode: "form" | "openai/form" }>, values: McpElicitationValues) {
  return request.fields.every((field) => isValidMcpField(field, values[field.id], field.required));
}

export function buildMcpElicitationResponse(request: Extract<McpElicitationRequest, { mode: "form" | "openai/form" }>, values: McpElicitationValues) {
  if (!isMcpElicitationComplete(request, values)) throw new Error("MCP elicitation form is incomplete or invalid");
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const field of request.fields) {
    const value = values[field.id];
    if ((field.type === "text" || field.type === "select" || field.type === "number" || field.type === "integer") && value === "" && !field.required) continue;
    content[field.id] = value;
  }
  return { action: "accept" as const, content, _meta: null };
}

export function buildMcpElicitationAction(action: "accept" | "decline" | "cancel") {
  return { action, content: null, _meta: null };
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

function parseMcpSchema(value: unknown): McpElicitationField[] | null {
  if (!value || typeof value !== "object") return null;
  const schema = value as Record<string, unknown>;
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties)) return null;
  if (schema.required !== undefined && (!Array.isArray(schema.required) || !schema.required.every((entry) => typeof entry === "string"))) return null;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const fields: McpElicitationField[] = [];
  for (const [id, candidate] of Object.entries(schema.properties as Record<string, unknown>)) {
    const field = parseMcpField(id, candidate, required.has(id));
    if (!field) return null;
    fields.push(field);
  }
  if ([...required].some((id) => !(id in (schema.properties as Record<string, unknown>)))) return null;
  return fields;
}

function parseMcpField(id: string, value: unknown, required: boolean): McpElicitationField | null {
  if (!value || typeof value !== "object") return null;
  const schema = value as Record<string, unknown>;
  const base = {
    id,
    title: typeof schema.title === "string" ? schema.title : humanize(id),
    description: typeof schema.description === "string" ? schema.description : "",
    required,
  };
  if (schema.type === "string") {
    const options = parseSingleSelectOptions(schema);
    if (options) {
      const defaultValue = typeof schema.default === "string" && options.some((option) => option.value === schema.default) ? schema.default : undefined;
      return { ...base, type: "select", options, ...(defaultValue === undefined ? {} : { default: defaultValue }) };
    }
    if (schema.format !== undefined && !["email", "uri", "date", "date-time"].includes(String(schema.format))) return null;
    if (!optionalNonNegativeInteger(schema.minLength) || !optionalNonNegativeInteger(schema.maxLength) || exceeds(schema.minLength, schema.maxLength)) return null;
    return {
      ...base,
      type: "text",
      ...(schema.format === undefined ? {} : { format: schema.format as "email" | "uri" | "date" | "date-time" }),
      ...(schema.minLength === undefined ? {} : { minLength: schema.minLength as number }),
      ...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength as number }),
      ...(typeof schema.default === "string" ? { default: schema.default } : {}),
    };
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (!optionalFiniteNumber(schema.minimum) || !optionalFiniteNumber(schema.maximum) || exceeds(schema.minimum, schema.maximum)) return null;
    return {
      ...base,
      type: schema.type,
      ...(schema.minimum === undefined ? {} : { minimum: schema.minimum as number }),
      ...(schema.maximum === undefined ? {} : { maximum: schema.maximum as number }),
      ...(typeof schema.default === "number" && Number.isFinite(schema.default) ? { default: schema.default } : {}),
    };
  }
  if (schema.type === "boolean") return { ...base, type: "boolean", default: typeof schema.default === "boolean" ? schema.default : false };
  if (schema.type === "array") {
    const options = parseMultiSelectOptions(schema.items);
    if (!options || !optionalNonNegativeInteger(schema.minItems) || !optionalNonNegativeInteger(schema.maxItems) || exceeds(schema.minItems, schema.maxItems)) return null;
    const defaults = Array.isArray(schema.default) ? schema.default.filter((entry): entry is string => typeof entry === "string" && options.some((option) => option.value === entry)) : [];
    return {
      ...base,
      type: "multiselect",
      options,
      default: defaults,
      ...(schema.minItems === undefined ? {} : { minItems: schema.minItems as number }),
      ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems as number }),
    };
  }
  return null;
}

function parseSingleSelectOptions(schema: Record<string, unknown>) {
  if (Array.isArray(schema.oneOf)) return parseConstOptions(schema.oneOf);
  if (!Array.isArray(schema.enum) || !schema.enum.length || !schema.enum.every((entry) => typeof entry === "string")) return null;
  const names = Array.isArray(schema.enumNames) && schema.enumNames.every((entry) => typeof entry === "string") ? schema.enumNames : [];
  return schema.enum.map((value, index) => ({ value, label: names[index] ?? value }));
}

function parseMultiSelectOptions(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const items = value as Record<string, unknown>;
  if (Array.isArray(items.anyOf)) return parseConstOptions(items.anyOf);
  if (items.type !== "string" || !Array.isArray(items.enum) || !items.enum.length || !items.enum.every((entry) => typeof entry === "string")) return null;
  return items.enum.map((value) => ({ value, label: value }));
}

function parseConstOptions(values: unknown[]) {
  if (!values.length || !values.every((value) => value && typeof value === "object" && typeof (value as Record<string, unknown>).const === "string" && typeof (value as Record<string, unknown>).title === "string")) return null;
  return values.map((value) => {
    const option = value as Record<string, string>;
    return { value: option.const, label: option.title };
  });
}

function isValidMcpField(field: McpElicitationField, value: McpElicitationValues[string] | undefined, required: boolean) {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "multiselect") return Array.isArray(value)
    && value.every((entry) => field.options.some((option) => option.value === entry))
    && (field.minItems === undefined || value.length >= field.minItems)
    && (field.maxItems === undefined || value.length <= field.maxItems)
    && (!required || value.length > 0);
  if (field.type === "number" || field.type === "integer") return (value === "" && !required) || (typeof value === "number"
    && Number.isFinite(value)
    && (field.type !== "integer" || Number.isInteger(value))
    && (field.minimum === undefined || value >= field.minimum)
    && (field.maximum === undefined || value <= field.maximum));
  if (typeof value !== "string") return false;
  if (!value && !required) return true;
  if (field.type === "select") return field.options.some((option) => option.value === value);
  if (field.type !== "text") return false;
  return (!required || value.length > 0)
    && (field.minLength === undefined || value.length >= field.minLength)
    && (field.maxLength === undefined || value.length <= field.maxLength);
}

function optionalNonNegativeInteger(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function optionalFiniteNumber(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function exceeds(minimum: unknown, maximum: unknown) {
  return typeof minimum === "number" && typeof maximum === "number" && minimum > maximum;
}

function humanize(value: string) {
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
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
