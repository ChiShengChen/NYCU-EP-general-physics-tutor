"use client";

import { useState } from "react";
import { findSimForPage } from "@/lib/sim-mappings";

/**
 * Inline simulator embed for teaching-mode pages.
 *
 * Renders nothing when no mapping exists for (chapter, page), so dropping
 * it into the teaching layout is safe even for chapters that don't yet
 * have a sim. When a mapping does exist, shows a single collapsible
 * banner — students still focused on reading the slide can leave it
 * tucked away, but the prompt is visible enough to invite play.
 *
 * State (open / closed) is local per mount; we deliberately don't
 * persist it because the value of the sim is in the "oh, let me try
 * that" reflex on the page it's pinned to. Persisting open-state would
 * lead to a stale half-collapsed sim trailing the student into the next
 * page.
 */

interface Props {
  chapter: number;
  page: number;
}

export function TeachingSimEmbed({ chapter, page }: Props) {
  const meta = findSimForPage(chapter, page);
  const [open, setOpen] = useState(false);

  if (!meta) return null;

  const { Component } = meta;

  return (
    <div className="mt-3 mx-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 hover:shadow-sm transition-all"
      >
        <span className="text-2xl shrink-0">{meta.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            🔬 互動探索：{meta.title}
            <span className="text-[10px] font-normal text-indigo-600 dark:text-indigo-300 ml-2">{meta.subtitle}</span>
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 truncate">
            {meta.blurb}
          </div>
        </div>
        <span className="shrink-0 text-xs text-indigo-700 dark:text-indigo-300">
          {open ? "收合 ▴" : "展開 ▾"}
        </span>
      </button>

      {open && (
        <div className="mt-3">
          <Component inline />
        </div>
      )}
    </div>
  );
}
