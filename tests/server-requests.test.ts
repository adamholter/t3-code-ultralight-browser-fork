import { describe, expect, it } from "vitest";
import { buildApprovalResponse, buildUserInputResponse, getUserInputQuestions } from "../src/lib/server-requests";

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
});
