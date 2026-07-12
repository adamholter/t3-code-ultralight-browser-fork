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

  it("renders typed MCP form fields and URL authorization controls", () => {
    const form = renderToStaticMarkup(createElement(PendingRequestPanel, {
      request: {
        id: "mcp-form",
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-1",
          mode: "form",
          serverName: "Issue tracker",
          message: "Create an issue",
          requestedSchema: {
            type: "object",
            required: ["title", "priority"],
            properties: {
              title: { type: "string", title: "Issue title", minLength: 3 },
              priority: { type: "string", enum: ["high", "low"] },
              estimate: { type: "integer", minimum: 1, maximum: 10 },
              notify: { type: "boolean", default: true },
              labels: { type: "array", items: { type: "string", enum: ["bug", "feature"] } },
            },
          },
        },
      },
      onRespond: () => undefined,
      onReject: () => undefined,
    }));
    expect(form).toContain("Issue tracker needs information");
    expect(form).toContain("Issue title");
    expect(form).toContain('type="number"');
    expect(form).toContain("Choose an option");
    expect(form).toContain("bug");
    expect(form).toContain("Continue");

    const url = renderToStaticMarkup(createElement(PendingRequestPanel, {
      request: {
        id: "mcp-url",
        method: "mcpServer/elicitation/request",
        params: { threadId: "thread-1", mode: "url", serverName: "Calendar", message: "Connect your account", url: "https://accounts.example.com/connect", elicitationId: "auth-1" },
      },
      onRespond: () => undefined,
      onReject: () => undefined,
    }));
    expect(url).toContain("Calendar needs authorization");
    expect(url).toContain("Open accounts.example.com");
    expect(url).toContain('rel="noreferrer noopener"');
    expect(url).toContain("I’ve finished");
  });
});
