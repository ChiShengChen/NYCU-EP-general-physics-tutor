"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold mt-4 mb-2 text-slate-900">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold mt-3 mb-1.5 text-slate-800">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold mt-2 mb-1 text-slate-700">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="my-1.5 leading-relaxed text-slate-700">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 my-1.5 space-y-0.5 text-slate-700">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 my-1.5 space-y-0.5 text-slate-700">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        blockquote: ({ children }) => {
          const text = String(children);
          const isWarning = text.includes("\u26a0\ufe0f") || text.includes("COUNTEREXAMPLE") || text.includes("WRONG");
          return (
            <blockquote
              className={`border-l-4 pl-3 my-2 py-1 rounded-r ${
                isWarning
                  ? "border-amber-500 bg-amber-50 text-amber-900"
                  : "border-indigo-300 bg-indigo-50 text-indigo-900"
              }`}
            >
              {children}
            </blockquote>
          );
        },
        code: ({ className, children }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="bg-slate-800 text-slate-100 rounded-lg p-3 my-2 overflow-x-auto text-sm">
                <code>{children}</code>
              </pre>
            );
          }
          return (
            <code className="bg-slate-100 text-indigo-700 rounded px-1.5 py-0.5 text-sm font-mono">
              {children}
            </code>
          );
        },
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-slate-200">
            <table className="min-w-full border-collapse text-sm">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-slate-100">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-slate-200">{children}</tbody>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-slate-50 transition-colors">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left font-semibold text-slate-700 border-b-2 border-slate-300 whitespace-nowrap">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-slate-600">{children}</td>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-900">{children}</strong>
        ),
        a: ({ href, children }) => (
          <a href={href} className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
