import type { ReactNode } from "react";

/**
 * Minimal, safe markdown renderer: converts a small subset (headings, bold,
 * italics, inline code, bullets, numbered lists, paragraphs) into React
 * nodes. No dangerouslySetInnerHTML anywhere — crawled content can never
 * inject markup.
 */

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return <div className={`space-y-2 ${className}`}>{renderBlocks(text)}</div>;
}

function renderBlocks(text: string): ReactNode[] {
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let listBuffer: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    const items = listBuffer.items;
    nodes.push(
      listBuffer.ordered ? (
        <ol key={nodes.length} className="list-decimal pl-6 space-y-1">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={nodes.length} className="list-disc pl-6 space-y-1">
          {items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    );
    listBuffer = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);

    if (bullet) {
      if (!listBuffer || listBuffer.ordered) {
        flushList();
        listBuffer = { ordered: false, items: [] };
      }
      listBuffer.items.push(bullet[1]);
      continue;
    }
    if (numbered) {
      if (!listBuffer || !listBuffer.ordered) {
        flushList();
        listBuffer = { ordered: true, items: [] };
      }
      listBuffer.items.push(numbered[1]);
      continue;
    }
    flushList();

    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2]);
      nodes.push(
        level <= 2 ? (
          <h3 key={nodes.length} className="text-lg font-semibold mt-3">{content}</h3>
        ) : (
          <h4 key={nodes.length} className="text-base font-semibold mt-2">{content}</h4>
        )
      );
      continue;
    }
    if (line.trim() === "") continue;
    nodes.push(<p key={nodes.length} className="leading-relaxed">{renderInline(line)}</p>);
  }
  flushList();
  return nodes;
}

function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}
