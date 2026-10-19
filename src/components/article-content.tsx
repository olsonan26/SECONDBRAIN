"use client";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CSSProperties } from "react";

const heading: CSSProperties = { fontFamily: "Arial, Helvetica, sans-serif", fontWeight: 700, color: "#152b3b", letterSpacing: "-0.02em", breakAfter: "avoid" };

/** Inline typography travels with HTML clipboard content into rich-text editors. */
export function ArticleContent({ children }: { children: string }) {
  return <article className="article-prose" style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "12pt", lineHeight: 1.75, color: "#253746", textAlign: "left", overflowWrap: "anywhere" }}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      h1: ({ children }) => <h1 style={{ ...heading, fontSize: "26pt", lineHeight: 1.18, margin: "0 0 20pt" }}>{children}</h1>,
      h2: ({ children }) => <h2 style={{ ...heading, fontSize: "18pt", lineHeight: 1.3, margin: "26pt 0 10pt" }}>{children}</h2>,
      h3: ({ children }) => <h3 style={{ ...heading, fontSize: "14pt", lineHeight: 1.4, margin: "20pt 0 8pt" }}>{children}</h3>,
      h4: ({ children }) => <h4 style={{ ...heading, fontSize: "12pt", lineHeight: 1.4, margin: "18pt 0 8pt" }}>{children}</h4>,
      p: ({ children }) => <p style={{ margin: "0 0 13pt", orphans: 2, widows: 2 }}>{children}</p>,
      strong: ({ children }) => <strong style={{ fontWeight: 700, color: "#152b3b" }}>{children}</strong>,
      ul: ({ children }) => <ul style={{ margin: "3pt 0 15pt", paddingLeft: "24pt", listStyleType: "disc" }}>{children}</ul>,
      ol: ({ children, start }) => <ol start={start} style={{ margin: "3pt 0 15pt", paddingLeft: "24pt", listStyleType: "decimal" }}>{children}</ol>,
      li: ({ children }) => <li style={{ margin: "0 0 6pt", paddingLeft: "3pt" }}>{children}</li>,
      blockquote: ({ children }) => <blockquote style={{ margin: "18pt 0", padding: "3pt 0 3pt 15pt", borderLeft: "3px solid #83a5b1", color: "#455d6b", fontStyle: "italic" }}>{children}</blockquote>,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" style={{ color: "#136278", textDecoration: "underline" }}>{children}</a>,
      hr: () => <hr style={{ border: 0, borderTop: "1px solid #d8e3ea", margin: "24pt 0" }} />,
      table: ({ children }) => <table style={{ width: "100%", borderCollapse: "collapse", margin: "16pt 0", fontFamily: "Arial, Helvetica, sans-serif", fontSize: "10pt", lineHeight: 1.5 }}>{children}</table>,
      th: ({ children }) => <th style={{ textAlign: "left", padding: "8pt 10pt", borderBottom: "2px solid #b7cbd5", background: "#edf3f6", fontWeight: 700 }}>{children}</th>,
      td: ({ children }) => <td style={{ padding: "8pt 10pt", borderBottom: "1px solid #d8e3ea", verticalAlign: "top" }}>{children}</td>,
      pre: ({ children }) => <pre style={{ padding: "12pt", margin: "14pt 0", background: "#f1f5f8", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "10pt" }}>{children}</pre>,
      img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : ""}</span>,
    }}>{children}</ReactMarkdown>
  </article>;
}

export function formatArticleClipboard(markdown: string) {
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  container.style.cssText = "position:fixed;left:-100000px;top:0;width:680px;pointer-events:none;background:white;";
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<ArticleContent>{markdown}</ArticleContent>));
    return { html: container.innerHTML, text: container.innerText.replace(/\r\n/g, "\n").trim() };
  } finally { root.unmount(); container.remove(); }
}

export async function copyFormattedArticle(markdown: string): Promise<"formatted" | "plain"> {
  const content = formatArticleClipboard(markdown);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write && ClipboardItem.supports?.("text/html") !== false) {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([content.html], { type: "text/html" }),
      "text/plain": new Blob([content.text], { type: "text/plain" }),
    })]);
    return "formatted";
  }
  await navigator.clipboard.writeText(content.text);
  return "plain";
}
