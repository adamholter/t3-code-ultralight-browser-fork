import { describe, expect, it } from "vitest";
import { buildApprovalResponse, buildCurrentTimeResponse, buildMcpElicitationAction, buildMcpElicitationResponse, buildPermissionResponse, buildUserInputResponse, describePermissionRequest, getMcpElicitationDefaults, getMcpElicitationRequest, getPermissionRequest, getServerRequestThreadId, getUserInputQuestions, isMcpElicitationComplete } from "../src/lib/server-requests";

describe("server request helpers", () => {
  it("serializes user answers in the app-server response shape", () => {
    expect(buildUserInputResponse({ framework: ["React"], empty: [""] })).toEqual({
      answers: { framework: { answers: ["React"] } },
    });
  });

  it("validates request_user_input questions", () => {
    expect(getUserInputQuestions({
      id: 7,
      method: "item/tool/requestUserInput",
      params: {
        questions: [{ id: "choice", header: "Choice", question: "Pick one", isOther: true, isSecret: false, options: [{ label: "A", description: "First" }] }],
      },
    })?.[0].id).toBe("choice");
  });

  it("maps current and legacy approval decisions", () => {
    expect(buildApprovalResponse("item/commandExecution/requestApproval", "accept")).toEqual({ decision: "accept" });
    expect(buildApprovalResponse("execCommandApproval", "accept")).toEqual({ decision: "approved" });
    expect(buildApprovalResponse("applyPatchApproval", "decline")).toEqual({ decision: "denied" });
  });

  it("parses and grants exactly the requested permission profile", () => {
    const request = getPermissionRequest({
      id: "permission-1",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        cwd: "/project",
        reason: "Download and update a generated file",
        permissions: {
          network: { enabled: true },
          fileSystem: {
            read: ["/project/input"],
            write: ["/project/output"],
            entries: [{ path: { type: "glob_pattern", pattern: "/tmp/*.json" }, access: "read" }],
          },
        },
      },
    });
    expect(request).not.toBeNull();
    expect(describePermissionRequest(request!)).toEqual([
      "Enable network access",
      "Read /project/input",
      "Write /project/output",
      "Read /tmp/*.json",
    ]);
    expect(buildPermissionResponse(request!, "turn", true)).toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: ["/project/input"],
          write: ["/project/output"],
          entries: [{ path: { type: "glob_pattern", pattern: "/tmp/*.json" }, access: "read" }],
        },
      },
      scope: "turn",
      strictAutoReview: true,
    });
  });

  it("rejects malformed permission profiles", () => {
    expect(getPermissionRequest({
      id: 1,
      method: "item/permissions/requestApproval",
      params: { permissions: { network: { enabled: "yes" }, fileSystem: null } },
    })).toBeNull();
  });

  it("builds whole-second time responses and reads modern or legacy thread IDs", () => {
    expect(buildCurrentTimeResponse(1_750)).toEqual({ currentTimeAt: 1 });
    expect(getServerRequestThreadId({ id: 1, method: "modern", params: { threadId: "thread-modern" } })).toBe("thread-modern");
    expect(getServerRequestThreadId({ id: 2, method: "legacy", params: { conversationId: "thread-legacy" } })).toBe("thread-legacy");
  });

  it("parses primitive MCP forms and serializes typed content", () => {
    const request = getMcpElicitationRequest({
      id: "mcp-1",
      method: "mcpServer/elicitation/request",
      params: {
        mode: "form",
        serverName: "Issue tracker",
        message: "Create the issue",
        requestedSchema: {
          type: "object",
          required: ["title", "priority", "estimate"],
          properties: {
            title: { type: "string", title: "Title", minLength: 3 },
            priority: { type: "string", oneOf: [{ const: "high", title: "High" }, { const: "low", title: "Low" }], default: "high" },
            estimate: { type: "integer", minimum: 1, maximum: 10, default: 3 },
            notify: { type: "boolean", default: true },
            labels: { type: "array", items: { type: "string", enum: ["bug", "feature"] }, default: ["bug"], maxItems: 2 },
          },
        },
      },
    });
    expect(request?.mode).toBe("form");
    if (!request || request.mode === "url") throw new Error("Expected an MCP form");
    const values = getMcpElicitationDefaults(request);
    expect(values).toEqual({ title: "", priority: "high", estimate: 3, notify: true, labels: ["bug"] });
    expect(isMcpElicitationComplete(request, values)).toBe(false);
    values.title = "Broken export";
    expect(isMcpElicitationComplete(request, values)).toBe(true);
    expect(buildMcpElicitationResponse(request, values)).toEqual({ action: "accept", content: values, _meta: null });
    expect(buildMcpElicitationAction("decline")).toEqual({ action: "decline", content: null, _meta: null });
  });

  it("accepts safe MCP URL flows and rejects unsafe or nested schemas", () => {
    expect(getMcpElicitationRequest({
      id: 1,
      method: "mcpServer/elicitation/request",
      params: { mode: "url", serverName: "Calendar", message: "Connect", url: "https://accounts.example.com/connect", elicitationId: "auth-1" },
    })).toMatchObject({ mode: "url", url: "https://accounts.example.com/connect" });
    expect(getMcpElicitationRequest({
      id: 2,
      method: "mcpServer/elicitation/request",
      params: { mode: "url", serverName: "Bad", message: "Connect", url: "javascript:alert(1)", elicitationId: "bad" },
    })).toBeNull();
    expect(getMcpElicitationRequest({
      id: 3,
      method: "mcpServer/elicitation/request",
      params: { mode: "openai/form", serverName: "Nested", message: "No", requestedSchema: { type: "object", properties: { nested: { type: "object", properties: {} } } } },
    })).toBeNull();
  });
});
