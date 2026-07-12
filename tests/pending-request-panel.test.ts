import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PendingRequestPanel } from "../src/components/PendingRequestPanel";

describe("PendingRequestPanel", () => {
  it("renders structured permission details and explicit grant scopes", () => {
    const html = renderToStaticMarkup(createElement(PendingRequestPanel, {
      request: {
        id: "permission-1",
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          cwd: "/project",
          reason: "Fetch a dependency and update generated output",
          permissions: {
            network: { enabled: true },
            fileSystem: { read: ["/project/input"], write: ["/project/output"] },
          },
        },
      },
      onRespond: () => undefined,
      onReject: () => undefined,
    }));

    expect(html).toContain("Codex requests additional permissions");
    expect(html).toContain("Enable network access");
    expect(html).toContain("Read /project/input");
    expect(html).toContain("Write /project/output");
    expect(html).toContain("Allow for this turn");
    expect(html).toContain("Allow for session");
    expect(html).toContain("Review every later command");
  });
});
