import { describe, expect, it } from "vitest";
import { buildApprovalResponse, buildCurrentTimeResponse, buildPermissionResponse, buildUserInputResponse, describePermissionRequest, getPermissionRequest, getServerRequestThreadId, getUserInputQuestions } from "../src/lib/server-requests";

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
});
