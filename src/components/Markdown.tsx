import { Check, Copy } from "lucide-react";
import { Fragment, createElement, useState, type ReactNode } from "react";

export function Markdown({ children }: { children: string }) {
  return <>{renderBlocks(children.replace(/\r\n?/g, "\n").split("\n"), "md")}</>;
}

function renderBlocks(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const fence = lines[index].match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/);
    if (fence) {
      const marker = fence[1][0];
      const minimum = fence[1].length;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s{0,3}${escapeRegExp(marker)}{${minimum},}\\s*$`).test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      nodes.push(<CodeBlock key={`${keyPrefix}-${nodes.length}`} text={code.join("\n")} language={fence[2]} />);
      continue;
    }

    if (/^ {4}\S/.test(lines[index])) {
      const code: string[] = [];
      while (index < lines.length && (/^ {4}/.test(lines[index]) || !lines[index].trim())) {
        code.push(lines[index].slice(4));
        index += 1;
      }
      nodes.push(<CodeBlock key={`${keyPrefix}-${nodes.length}`} text={code.join("\n").replace(/\n+$/, "")} />);
      continue;
    }

    const heading = lines[index].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      nodes.push(createElement(`h${heading[1].length}`, { key: `${keyPrefix}-${nodes.length}` }, parseInline(heading[2], `${keyPrefix}-h`)));
      index += 1;
      continue;
    }

    const setext = index + 1 < lines.length ? lines[index + 1].match(/^\s{0,3}(=+|-+)\s*$/) : null;
    if (setext && lines[index].trim()) {
      nodes.push(createElement(setext[1][0] === "=" ? "h1" : "h2", { key: `${keyPrefix}-${nodes.length}` }, parseInline(lines[index].trim(), `${keyPrefix}-setext`)));
      index += 2;
      continue;
    }

    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(lines[index])) {
      nodes.push(<hr key={`${keyPrefix}-${nodes.length}`} />);
      index += 1;
      continue;
    }

    if (/^\s{0,3}>/.test(lines[index])) {
      const quoted: string[] = [];
      while (index < lines.length && (/^\s{0,3}>/.test(lines[index]) || !lines[index].trim())) {
        quoted.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      nodes.push(<blockquote key={`${keyPrefix}-${nodes.length}`}>{renderBlocks(quoted, `${keyPrefix}-q`)}</blockquote>);
      continue;
    }

    if (index + 1 < lines.length && isTableDelimiter(lines[index + 1]) && splitTableRow(lines[index]).length > 0) {
      const headers = splitTableRow(lines[index]);
      const alignments = splitTableRow(lines[index + 1]).map((cell) => {
        const value = cell.trim();
        return value.startsWith(":") && value.endsWith(":") ? "center" : value.endsWith(":") ? "right" : value.startsWith(":") ? "left" : undefined;
      });
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      nodes.push(
        <div className="markdown-table-wrap" key={`${keyPrefix}-${nodes.length}`}>
          <table>
            <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex} style={{ textAlign: alignments[cellIndex] }}>{parseInline(cell.trim(), `${keyPrefix}-th-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex} style={{ textAlign: alignments[cellIndex] }}>{parseInline((row[cellIndex] ?? "").trim(), `${keyPrefix}-td-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const list = listMatch(lines[index]);
    if (list) {
      const ordered = /^\d/.test(list.marker);
      const baseIndent = list.indent.length;
      const items: Array<{ text: string; continuation: string[] }> = [];
      const start = ordered ? Number.parseInt(list.marker, 10) : undefined;
      while (index < lines.length) {
        const item = listMatch(lines[index]);
        if (!item || item.indent.length !== baseIndent || /^\d/.test(item.marker) !== ordered) break;
        const value = { text: item.text, continuation: [] as string[] };
        index += 1;
        while (index < lines.length) {
          if (!lines[index].trim()) {
            value.continuation.push("");
            index += 1;
            continue;
          }
          const next = listMatch(lines[index]);
          if (next?.indent.length === baseIndent) break;
          const leading = lines[index].match(/^\s*/)?.[0].length ?? 0;
          if (leading <= baseIndent && startsBlock(lines, index)) break;
          value.continuation.push(leading > baseIndent ? lines[index].slice(Math.min(lines[index].length, baseIndent + 2)) : lines[index]);
          index += 1;
        }
        items.push(value);
      }
      const ListTag = ordered ? "ol" : "ul";
      nodes.push(
        <ListTag key={`${keyPrefix}-${nodes.length}`} {...(ordered && start !== 1 ? { start } : {})}>
          {items.map((item, itemIndex) => {
            const task = item.text.match(/^\[([ xX])\]\s+(.*)$/);
            return (
              <li className={task ? "task-item" : undefined} key={itemIndex}>
                {task && <input type="checkbox" checked={task[1].toLowerCase() === "x"} readOnly disabled aria-label="Task status" />}
                <span>{parseInline(task ? task[2] : item.text, `${keyPrefix}-li-${itemIndex}`)}</span>
                {item.continuation.some((line) => line.trim()) && renderBlocks(item.continuation, `${keyPrefix}-li-${itemIndex}-nested`)}
              </li>
            );
          })}
        </ListTag>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && startsBlock(lines, index)) break;
      if (index + 1 < lines.length && isTableDelimiter(lines[index + 1]) && lines[index].includes("|")) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    if (!paragraph.length) {
      paragraph.push(lines[index]);
      index += 1;
    }
    nodes.push(<p key={`${keyPrefix}-${nodes.length}`}>{parseInline(paragraph.join("\n"), `${keyPrefix}-p-${nodes.length}`)}</p>);
  }
  return nodes;
}

function parseInline(source: string, keyPrefix: string): ReactNode[] {
  const text = decodeEntities(source);
  const nodes: ReactNode[] = [];
  let buffer = "";
  let index = 0;
  const flush = () => {
    if (!buffer) return;
    nodes.push(<Fragment key={`${keyPrefix}-${nodes.length}`}>{buffer}</Fragment>);
    buffer = "";
  };
  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length && /[\\`*{}\[\]()#+\-.!_|>~]/.test(text[index + 1])) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (text[index] === "\n") {
      const hardBreak = buffer.endsWith("  ");
      buffer = hardBreak ? buffer.slice(0, -2) : `${buffer} `;
      flush();
      if (hardBreak) nodes.push(<br key={`${keyPrefix}-${nodes.length}`} />);
      index += 1;
      continue;
    }
    if (text[index] === "`") {
      const run = text.slice(index).match(/^`+/)?.[0] ?? "`";
      const end = text.indexOf(run, index + run.length);
      if (end >= 0) {
        flush();
        const code = text.slice(index + run.length, end).replace(/\s+/g, " ").replace(/^ | $/g, "");
        nodes.push(<code key={`${keyPrefix}-${nodes.length}`}>{code}</code>);
        index = end + run.length;
        continue;
      }
    }
    const rest = text.slice(index);
    const link = rest.match(/^(!?)\[([^\]]+)\]\(\s*([^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/);
    if (link) {
      const href = safeUrl(link[3], link[1] === "!");
      flush();
      if (link[1] === "!" && href) {
        nodes.push(<img key={`${keyPrefix}-${nodes.length}`} src={href} alt={plainText(link[2])} title={link[4]} loading="lazy" />);
      } else if (href) {
        nodes.push(<a key={`${keyPrefix}-${nodes.length}`} href={href} title={link[4]} target="_blank" rel="noreferrer noopener">{parseInline(link[2], `${keyPrefix}-a-${nodes.length}`)}</a>);
      } else {
        nodes.push(<Fragment key={`${keyPrefix}-${nodes.length}`}>{parseInline(link[2], `${keyPrefix}-unsafe-${nodes.length}`)}</Fragment>);
      }
      index += link[0].length;
      continue;
    }
    const autoLink = rest.match(/^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>/i);
    if (autoLink) {
      flush();
      nodes.push(<a key={`${keyPrefix}-${nodes.length}`} href={autoLink[1]} target="_blank" rel="noreferrer noopener">{autoLink[1]}</a>);
      index += autoLink[0].length;
      continue;
    }
    const bareLink = rest.match(/^https?:\/\/[^\s<>]+/i);
    if (bareLink) {
      const href = trimUrlPunctuation(bareLink[0]);
      flush();
      nodes.push(<a key={`${keyPrefix}-${nodes.length}`} href={href} target="_blank" rel="noreferrer noopener">{href}</a>);
      index += href.length;
      continue;
    }
    const delimiter = rest.startsWith("**") || rest.startsWith("__") ? rest.slice(0, 2) : null;
    if (delimiter) {
      const end = text.indexOf(delimiter, index + 2);
      if (end > index + 2) {
        flush();
        nodes.push(<strong key={`${keyPrefix}-${nodes.length}`}>{parseInline(text.slice(index + 2, end), `${keyPrefix}-strong-${nodes.length}`)}</strong>);
        index = end + 2;
        continue;
      }
    }
    if (rest.startsWith("~~")) {
      const end = text.indexOf("~~", index + 2);
      if (end > index + 2) {
        flush();
        nodes.push(<del key={`${keyPrefix}-${nodes.length}`}>{parseInline(text.slice(index + 2, end), `${keyPrefix}-del-${nodes.length}`)}</del>);
        index = end + 2;
        continue;
      }
    }
    if (text[index] === "*" || (text[index] === "_" && !/\w/.test(text[index - 1] ?? ""))) {
      const delimiter = text[index];
      const end = text.indexOf(delimiter, index + 1);
      if (end > index + 1 && (delimiter !== "_" || !/\w/.test(text[end + 1] ?? ""))) {
        flush();
        nodes.push(<em key={`${keyPrefix}-${nodes.length}`}>{parseInline(text.slice(index + 1, end), `${keyPrefix}-em-${nodes.length}`)}</em>);
        index = end + 1;
        continue;
      }
    }
    buffer += text[index];
    index += 1;
  }
  flush();
  return nodes;
}

function CodeBlock({ text, language }: { text: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* Clipboard permission is host-controlled. */ }
  }
  return (
    <div className="code-block">
      <button className="code-copy" onClick={copy} aria-label="Copy code">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre><code className={language ? `language-${language}` : undefined}>{text}</code></pre>
    </div>
  );
}

function startsBlock(lines: string[], index: number) {
  const line = lines[index];
  return /^\s{0,3}(`{3,}|~{3,})/.test(line)
    || /^ {4}\S/.test(line)
    || /^\s{0,3}#{1,6}\s+/.test(line)
    || /^\s{0,3}>/.test(line)
    || /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)
    || Boolean(listMatch(line))
    || (index + 1 < lines.length && line.includes("|") && isTableDelimiter(lines[index + 1]));
}

function listMatch(line: string) {
  const match = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
  return match ? { indent: match[1], marker: match[2], text: match[3] } : null;
}

function isTableDelimiter(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function splitTableRow(line: string) {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let code = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\" && value[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (value[index] === "`") {
      code = !code;
      cell += value[index];
    } else if (value[index] === "|" && !code) {
      cells.push(cell);
      cell = "";
    } else {
      cell += value[index];
    }
  }
  cells.push(cell);
  return cells;
}

function safeUrl(value: string, image = false) {
  const url = value.trim();
  if (/^(https?:\/\/|\/|#)/i.test(url)) return url;
  if (!image && /^mailto:/i.test(url)) return url;
  if (image && /^data:image\/(png|gif|jpe?g|webp);base64,/i.test(url)) return url;
  return null;
}

function trimUrlPunctuation(value: string) {
  let url = value;
  while (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
  return url;
}

function plainText(value: string) {
  return value.replace(/[*_~`]/g, "");
}

function decodeEntities(value: string) {
  return value.replace(/&(amp|lt|gt|quot|apos|#39|#x27|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (["apos", "#39", "#x27"].includes(normalized)) return "'";
    const numeric = normalized.startsWith("#x") ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff && !(numeric >= 0xd800 && numeric <= 0xdfff)
      ? String.fromCodePoint(numeric)
      : entity;
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
