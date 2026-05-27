/**
 * Registry of which simulator to surface alongside each lecture page.
 *
 * A teaching-mode page renders an inline embed when one entry matches
 * (chapter == X, and either page is null = whole chapter, or page == Y).
 * Page-specific entries win over chapter-wide ones, so a Ch04 page that
 * specifically calls out "free fall" can pin to free-fall while the rest
 * of Ch04 falls back to whatever the chapter-wide entry says.
 *
 * Keep this list curated by hand for now — the parsed_lectures content
 * is in Chinese and the chapter-to-sim association is a pedagogical
 * judgment call, not something we want to auto-derive.
 */

import type { ComponentType } from "react";
import { FreeFallSim } from "@/components/simulators/free-fall";
import { SpringSim } from "@/components/simulators/spring";
import { RCCircuitSim } from "@/components/simulators/rc-circuit";
import { ProjectileSim } from "@/components/simulators/projectile";
import { CollisionSim } from "@/components/simulators/collision";
import { EFieldSim } from "@/components/simulators/efield";
import { LensSim } from "@/components/simulators/lens";

export type SimKey = "free-fall" | "spring" | "rc" | "projectile" | "collision" | "efield" | "lens";

interface SimComponentProps {
  onBack?: () => void;
  inline?: boolean;
}

interface SimMeta {
  key: SimKey;
  title: string;
  subtitle: string;
  emoji: string;
  /** Short pitch shown in the gallery picker (single sentence). */
  blurb: string;
  /** Chapters this sim is most relevant to, used by the gallery picker. */
  chapters: string;
  /** Accent class for the picker card title. */
  accent: string;
  Component: ComponentType<SimComponentProps>;
}

export const SIMS: SimMeta[] = [
  {
    key: "free-fall",
    title: "自由落體",
    subtitle: "Free Fall",
    emoji: "🍎",
    blurb: "拉 g、初始高度、反彈係數，看落地速度與彈跳能量損失。同題型可比較月球 / 地球 / 木星。",
    chapters: "Ch02 · Ch04",
    accent: "text-indigo-700 dark:text-indigo-300",
    Component: FreeFallSim,
  },
  {
    key: "projectile",
    title: "拋體運動",
    subtitle: "Projectile motion",
    emoji: "🎯",
    blurb: "改速度與發射角，看軌跡、射程、最高點。最佳角度真的是 45° 嗎？加入空氣阻力後呢？",
    chapters: "Ch03",
    accent: "text-sky-700 dark:text-sky-300",
    Component: ProjectileSim,
  },
  {
    key: "collision",
    title: "1D 碰撞",
    subtitle: "1D Collision",
    emoji: "🎱",
    blurb: "兩物體在直線上碰撞，調整質量與初速。比較彈性 / 非彈性碰撞下動量與動能的變化。",
    chapters: "Ch08",
    accent: "text-purple-700 dark:text-purple-300",
    Component: CollisionSim,
  },
  {
    key: "spring",
    title: "彈簧與簡諧運動",
    subtitle: "Spring · SHM",
    emoji: "🪀",
    blurb: "質量、彈簧常數、阻尼三條滑桿。連續看到欠阻尼 → 臨界阻尼 → 過阻尼三種行為。",
    chapters: "Ch13",
    accent: "text-amber-700 dark:text-amber-300",
    Component: SpringSim,
  },
  {
    key: "efield",
    title: "電場線",
    subtitle: "Electric field lines",
    emoji: "⚡",
    blurb: "2–3 個點電荷，拖動觀察測試點上的電場向量。電荷符號 / 大小都可調。",
    chapters: "Ch21 · Ch22",
    accent: "text-rose-700 dark:text-rose-300",
    Component: EFieldSim,
  },
  {
    key: "rc",
    title: "RC 電路",
    subtitle: "Capacitor charge / discharge",
    emoji: "🔋",
    blurb: "充電曲線 V_C = V(1 − e^(−t/RC))。切換開關看電容如何放電。理解時間常數 τ = RC。",
    chapters: "Ch24 · Ch26",
    accent: "text-rose-700 dark:text-rose-300",
    Component: RCCircuitSim,
  },
  {
    key: "lens",
    title: "透鏡成像",
    subtitle: "Thin lens imaging",
    emoji: "🔍",
    blurb: "凸透鏡 / 凹透鏡的物距、焦距怎麼決定像距與放大率。實像、虛像、倒立 / 正立直接看出來。",
    chapters: "Ch34",
    accent: "text-emerald-700 dark:text-emerald-300",
    Component: LensSim,
  },
];

interface PageMapping {
  chapter: number;
  /** Null = applies to every page of this chapter. */
  page: number | null;
  simKey: SimKey;
}

/**
 * Page → sim map. Order matters when multiple entries could match: we
 * search top-down and prefer the first hit, so put page-specific entries
 * above chapter-wide ones for the same chapter.
 */
const PAGE_MAPPINGS: PageMapping[] = [
  // Mechanics
  { chapter: 2, page: null, simKey: "free-fall" },
  { chapter: 3, page: null, simKey: "projectile" },
  { chapter: 4, page: null, simKey: "free-fall" },
  { chapter: 8, page: null, simKey: "collision" },
  { chapter: 13, page: null, simKey: "spring" },
  // EM
  { chapter: 21, page: null, simKey: "efield" },
  { chapter: 22, page: null, simKey: "efield" },
  { chapter: 24, page: null, simKey: "rc" },
  { chapter: 26, page: null, simKey: "rc" },
  // Optics
  { chapter: 34, page: null, simKey: "lens" },
];

export function findSimForPage(chapter: number, page: number): SimMeta | null {
  // Page-specific entries first.
  const exact = PAGE_MAPPINGS.find((m) => m.chapter === chapter && m.page === page);
  if (exact) {
    const meta = SIMS.find((s) => s.key === exact.simKey);
    if (meta) return meta;
  }
  // Then chapter-wide.
  const wide = PAGE_MAPPINGS.find((m) => m.chapter === chapter && m.page === null);
  if (wide) {
    const meta = SIMS.find((s) => s.key === wide.simKey);
    if (meta) return meta;
  }
  return null;
}

export function getSimByKey(key: SimKey): SimMeta | null {
  return SIMS.find((s) => s.key === key) ?? null;
}
