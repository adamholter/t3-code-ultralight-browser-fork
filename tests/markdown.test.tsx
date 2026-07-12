import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../src/components/Markdown";

function render(markdown: string) {
  return renderToStaticMarkup(<div className="markdown"><Markdown>{markdown}</Markdown></div>);
}

describe("ultralight markdown renderer", () => {
  it("renders the response structures Codex commonly emits", () => {
    const html = render(`# Result

Text with **bold**, *emphasis*, ~~removed~~, \`inline()\`, and https://example.com/docs.

> A quoted note with [a link](https://example.com "Example").

- [x] Finished
- [ ] Remaining
  - Nested item

1. First
2. Second

| Name | Value |
| :--- | ----: |
| Model | GPT-5 |

\`\`\`ts
const answer: number = 42;
\`\`\``);

    expect(html).toContain("<h1>Result</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<del>removed</del>");
    expect(html).toContain("<code>inline()</code>");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain("Nested item");
    expect(html).toContain("<ol>");
    expect(html).toContain('<div class="markdown-table-wrap"><table>');
    expect(html).toContain('text-align:right');
    expect(html).toContain('class="language-ts"');
    expect(html).toContain("const answer: number = 42;");
    expect(html).toContain('aria-label="Copy code"');
  });

  it("never turns response HTML or unsafe URLs into executable markup", () => {
    const html = render(`<script>alert("x")</script>

[unsafe](javascript:alert(1)) ![tracking](javascript:alert(2))

[safe](/relative) ![image](https://example.com/image.png)`);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="/relative"');
    expect(html).toContain('src="https://example.com/image.png"');
    expect(html).toContain('loading="lazy"');
  });

  it("preserves escaped punctuation, entities, hard breaks, and code text", () => {
    const html = render(`Escaped \\*asterisk\\* &amp; entity.  
Next line.

    <tag attr="value"> & raw`);

    expect(html).toContain("Escaped *asterisk* &amp; entity.<br/>Next line.");
    expect(html).toContain("&lt;tag attr=&quot;value&quot;&gt; &amp; raw");
    expect(() => render("Invalid &#99999999; entity")).not.toThrow();
    expect(render("Invalid &#99999999; entity")).toContain("&amp;#99999999;");
    expect(render("Setext heading\n---")).toContain("<h2>Setext heading</h2>");
  });
});
