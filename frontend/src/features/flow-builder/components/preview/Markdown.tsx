"use client";

import { Fragment, useState, type ReactNode } from "react";
import { parseMarkdown, type MdNode } from "../../lib/markdown";

const LINK = "#62a3e3";
const QUOTE_BAR = "#62a3e3";

/** Hidden until tapped, the way Telegram reveals a spoiler. */
function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      title={revealed ? undefined : "Ochish uchun bosing"}
      className="cursor-pointer rounded-[3px] transition-colors"
      style={
        revealed
          ? undefined
          : { background: "#3a4a5c", color: "transparent", textShadow: "0 0 7px rgba(255,255,255,.55)" }
      }
    >
      {children}
    </span>
  );
}

function renderNodes(nodes: MdNode[]): ReactNode {
  return nodes.map((node, index) => {
    const key = index;
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "bold":
        return <strong key={key}>{renderNodes(node.children)}</strong>;
      case "italic":
        return <em key={key}>{renderNodes(node.children)}</em>;
      case "underline":
        return (
          <span key={key} style={{ textDecoration: "underline" }}>
            {renderNodes(node.children)}
          </span>
        );
      case "strike":
        return (
          <span key={key} style={{ textDecoration: "line-through" }}>
            {renderNodes(node.children)}
          </span>
        );
      case "spoiler":
        return <Spoiler key={key}>{renderNodes(node.children)}</Spoiler>;
      case "code":
        return (
          <code key={key} className="rounded-[3px] px-[3px] font-mono text-[12px]" style={{ background: "#0d1b28" }}>
            {node.value}
          </code>
        );
      case "link":
        return (
          <span key={key} style={{ color: LINK }}>
            {renderNodes(node.children)}
          </span>
        );
    }
  });
}

/** Renders Telegram MarkdownV2 the way the client would display it. */
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((block, index) =>
        block.quote ? (
          <span
            key={index}
            className="my-[2px] block border-l-2 pl-2"
            style={{ borderColor: QUOTE_BAR, opacity: 0.9 }}
          >
            {renderNodes(block.nodes)}
          </span>
        ) : (
          <Fragment key={index}>{renderNodes(block.nodes)}</Fragment>
        ),
      )}
    </>
  );
}
