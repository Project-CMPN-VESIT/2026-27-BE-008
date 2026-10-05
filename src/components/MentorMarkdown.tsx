"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders AI-mentor feedback. The model returns markdown (**bold**, numbered points) and often
 * runs the points together in one paragraph ("... 2. **RK Score**: ..."), so split those onto
 * their own lines first and then render with compact styling.
 */
export function normalizeMentorText(raw: string): string {
  let t = (raw || "").replace(/\r\n/g, "\n").trim();
  // "... sentence. 2. **Heading**" / "... sentence. 3) Heading" -> start a new list item
  t = t.replace(/([.!?:])\s+(?=\d{1,2}[.)]\s+(?:\*\*|[A-Z]))/g, "$1\n");
  // start of text "1. foo" is fine; make sure each list item sits on its own line
  t = t.replace(/\n(?=\d{1,2}[.)]\s)/g, "\n\n");
  return t;
}

export default function MentorMarkdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`mentor-md text-[13px] leading-relaxed ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1.5 last:mb-0">{children}</ol>,
          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1.5 last:mb-0">{children}</ul>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="underline">
              {children}
            </a>
          ),
        }}
      >
        {normalizeMentorText(text)}
      </ReactMarkdown>
    </div>
  );
}
