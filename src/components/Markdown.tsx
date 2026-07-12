import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="code-block">
      <button className="code-copy" onClick={copy} aria-label="Copy code">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) return extractText((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  return "";
}
