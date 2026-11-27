import { homedir } from "node:os";
import { basename, parse, resolve } from "node:path";
import type {
  ExtensionAPI,
  SessionEntry,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

export type Thinking = ReturnType<ExtensionAPI["getThinkingLevel"]>;

export type Color = Extract<
  ThemeColor,
  | "borderMuted"
  | "muted"
  | "accent"
  | "border"
  | "borderAccent"
  | "success"
  | "warning"
  | "error"
  | "thinkingMinimal"
  | "thinkingLow"
  | "thinkingMedium"
  | "thinkingHigh"
  | "thinkingXhigh"
  | "thinkingMax"
>;

export type State = {
  percent: number | null | undefined;
  estimatedCost: number;
  usingSubscription?: boolean | undefined;
  provider?: string | null | undefined;
  thinking?: Thinking | null | undefined;
  model: string;
  directory: string;
  branch: string | null | undefined;
};

export type Paint = (color: Color, text: string) => string;

const MIN_TRUNCATED_LABEL_WIDTH = 6;
const ESC = "\u001b";
const SGR_SEQUENCE = new RegExp(`(${ESC}\\[[0-9;:]*m)`, "g");

const THINKING_COLORS: Record<Exclude<Thinking, "off">, Color> = {
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

const sanitize = (label: string) => label.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "");

export function formatDirectory(cwd: string, home: string = homedir()): string {
  if (!cwd) return "";
  const resolvedCwd = resolve(cwd);
  if (home && resolvedCwd === resolve(home)) return "~";
  return basename(resolvedCwd) || parse(resolvedCwd).root || cwd;
}

function sanitizeExtensionStatus(raw: string): string {
  const parts = raw.split(SGR_SEQUENCE);
  let cleaned = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (i % 2 === 1) {
      cleaned += part;
    } else {
      cleaned += stripTerminalSequences(part)
        .replace(/[\r\n\t\p{Zl}\p{Zp}]+/gu, " ")
        .replace(/\p{Cc}/gu, "");
    }
  }
  if (stripTerminalSequences(cleaned).trim().length === 0) return "";
  return cleaned.trim();
}

export function formatExtensionStatuses(
  statuses: ReadonlyMap<string, string>,
  width: number,
  paint: Paint,
): string | undefined {
  if (statuses.size === 0) return undefined;

  const formatted: string[] = [];
  const sorted = [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, raw] of sorted) {
    if (!raw) continue;
    const cleaned = sanitizeExtensionStatus(raw);
    if (!cleaned) continue;
    if (cleaned.includes(`${ESC}[`)) {
      formatted.push(
        cleaned.endsWith(`${ESC}[0m`) ? cleaned : `${cleaned}${ESC}[0m`,
      );
    } else {
      formatted.push(paint("muted", cleaned));
    }
  }

  if (formatted.length === 0) return undefined;
  if (width <= 0) return "";

  const joined = formatted.join(paint("borderMuted", "  "));
  return truncateToWidth(joined, width, paint("muted", "…"));
}

function getEntryCost(entry: SessionEntry): number {
  let total: number | undefined;
  if (entry.type === "message") {
    if (
      entry.message.role === "assistant" ||
      entry.message.role === "toolResult"
    ) {
      total = entry.message.usage?.cost?.total;
    }
  } else if (
    entry.type === "usage" ||
    entry.type === "compaction" ||
    entry.type === "branch_summary"
  ) {
    total = entry.usage?.cost?.total;
  }
  return typeof total === "number" && Number.isFinite(total) && total > 0
    ? total
    : 0;
}

export function format(state: State, width: number, paint: Paint): string {
  if (width <= 0) return "";

  const separator = paint("borderMuted", "  ");
  const {
    percent,
    estimatedCost,
    usingSubscription,
    provider,
    thinking,
    model,
    directory,
    branch,
  } = state;

  const usagePercent =
    percent != null && Number.isFinite(percent)
      ? Math.max(0, Math.round(percent))
      : undefined;
  const usageColor: Color =
    (usagePercent ?? 0) >= 90
      ? "error"
      : (usagePercent ?? 0) >= 70
        ? "warning"
        : "success";

  const formatContextUsage = (cells: number) => {
    const label = paint(
      "muted",
      usagePercent === undefined ? "—" : `${usagePercent}%`,
    );
    if (cells <= 0) return label;
    const filled =
      usagePercent === undefined || usagePercent <= 0
        ? 0
        : usagePercent >= 100
          ? cells
          : Math.min(
              cells - 1,
              Math.max(1, Math.round((usagePercent * cells) / 100)),
            );
    const bar =
      paint(usageColor, "⣿".repeat(filled)) +
      paint("borderMuted", "⣿".repeat(cells - filled));
    return `${bar} ${label}`;
  };

  // Pi reports a usage estimate for the active conversation branch, not a billed amount.
  const costAmount =
    Number.isFinite(estimatedCost) && estimatedCost >= 0
      ? `~$${
          estimatedCost > 0 && estimatedCost < 0.0095
            ? estimatedCost.toFixed(3)
            : estimatedCost.toFixed(2)
        }`
      : "~$—";
  const costCompact = paint("muted", costAmount);
  const costFull =
    usingSubscription && costAmount !== "~$—"
      ? paint("muted", `${costAmount} (sub)`)
      : costCompact;

  const cleanModel = sanitize(model) || "no model";
  const cleanProvider = provider ? sanitize(provider) : "";
  const activeThinking = thinking && thinking !== "off" ? thinking : undefined;

  const modelBare = paint("accent", cleanModel);
  const modelWithThinking = activeThinking
    ? `${modelBare}${paint("borderMuted", " • ")}${paint(
        THINKING_COLORS[activeThinking],
        activeThinking,
      )}`
    : modelBare;
  const modelWithProvider = cleanProvider
    ? `${paint("muted", `(${cleanProvider}) `)}${modelWithThinking}`
    : modelWithThinking;

  const cleanDirectory = sanitize(directory);
  const cleanBranch = branch ? sanitize(branch) : "";

  const tryFitTrailing = (
    prefixSegments: readonly string[],
    color: Color,
    icon: string,
    label: string,
  ): string | undefined => {
    if (!label) return undefined;
    const prefix = `${prefixSegments.join(separator)}${separator}`;
    const full = `${prefix}${paint(color, `${icon}  ${label}`)}`;
    if (visibleWidth(full) <= width) return full;

    const iconOverhead = visibleWidth(paint(color, `${icon}  `));
    const maxLabelWidth = width - visibleWidth(prefix) - iconOverhead;
    if (maxLabelWidth < MIN_TRUNCATED_LABEL_WIDTH) return undefined;

    const truncated = truncateToWidth(label, maxLabelWidth, "…");
    const candidate = `${prefix}${paint(color, `${icon}  ${truncated}`)}`;
    return visibleWidth(candidate) <= width ? candidate : undefined;
  };

  const bar10 = formatContextUsage(10);
  const bar5 = formatContextUsage(5);
  const bar0 = formatContextUsage(0);

  if (cleanDirectory && cleanBranch) {
    const dirSegment = paint("border", `  ${cleanDirectory}`);
    if (cleanProvider) {
      const fitWithProvider = tryFitTrailing(
        [bar10, costFull, modelWithProvider, dirSegment],
        "borderAccent",
        "",
        cleanBranch,
      );
      if (fitWithProvider !== undefined) return fitWithProvider;
    }
    const fitWithoutProvider = tryFitTrailing(
      [bar10, costFull, modelWithThinking, dirSegment],
      "borderAccent",
      "",
      cleanBranch,
    );
    if (fitWithoutProvider !== undefined) return fitWithoutProvider;
  }

  if (cleanDirectory) {
    if (cleanProvider && !cleanBranch) {
      const fitDirWithProvider = tryFitTrailing(
        [bar10, costFull, modelWithProvider],
        "border",
        "",
        cleanDirectory,
      );
      if (fitDirWithProvider !== undefined) return fitDirWithProvider;
    }
    const fitDir = tryFitTrailing(
      [bar10, costFull, modelWithThinking],
      "border",
      "",
      cleanDirectory,
    );
    if (fitDir !== undefined) return fitDir;
  }

  const candidateLayouts: string[][] = [
    ...(cleanProvider ? [[bar10, costFull, modelWithProvider]] : []),
    [bar10, costFull, modelWithThinking],
    ...(costFull !== costCompact
      ? [[bar10, costCompact, modelWithThinking]]
      : []),
    [bar5, costFull, modelWithThinking],
    ...(costFull !== costCompact
      ? [[bar5, costCompact, modelWithThinking]]
      : []),
    [bar0, costFull, modelWithThinking],
    ...(costFull !== costCompact
      ? [[bar0, costCompact, modelWithThinking]]
      : []),
    [bar0, modelWithThinking],
    ...(modelWithThinking !== modelBare ? [[bar0, modelBare]] : []),
    [modelWithThinking],
    ...(modelWithThinking !== modelBare ? [[modelBare]] : []),
  ];

  for (const layout of candidateLayouts) {
    const footerLine = layout.join(separator);
    if (visibleWidth(footerLine) <= width) return footerLine;
  }

  return truncateToWidth(modelBare, width, "…");
}

export default function (pi: ExtensionAPI) {
  let activeTui: { requestRender(): void } | undefined;
  let invalidateCache: (() => void) | undefined;

  const refreshFooter = (resetCache: boolean) => {
    if (resetCache) invalidateCache?.();
    activeTui?.requestRender();
  };

  pi.on("session_tree", () => refreshFooter(true));
  pi.on("session_compact", () => refreshFooter(true));
  pi.on("turn_end", () => refreshFooter(true));
  pi.on("message_end", () => refreshFooter(true));
  pi.on("model_select", () => refreshFooter(false));
  pi.on("thinking_level_select", () => refreshFooter(false));
  pi.on("session_shutdown", () => {
    activeTui = undefined;
    invalidateCache = undefined;
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || (ctx.mode && ctx.mode !== "tui")) return;

    // A new leaf or session means the active branch has changed or gained an entry.
    // Keep the branch traversal out of ordinary terminal redraws.
    let cachedSessionId: string | undefined;
    let cachedLeafId: string | null | undefined;
    let cachedBranchCost: number | undefined;

    const resetCostCache = () => {
      cachedSessionId = undefined;
      cachedLeafId = undefined;
      cachedBranchCost = undefined;
    };

    ctx.ui.setFooter((tui, _theme, data) => {
      activeTui = tui;
      invalidateCache = resetCostCache;
      const unsubscribeBranch = data.onBranchChange(() => tui.requestRender());

      return {
        dispose() {
          unsubscribeBranch();
          if (activeTui === tui) activeTui = undefined;
          if (invalidateCache === resetCostCache) invalidateCache = undefined;
        },
        invalidate() {
          resetCostCache();
        },
        render(width) {
          const sessionId = ctx.sessionManager.getSessionId?.() ?? "";
          const leafId = ctx.sessionManager.getLeafId();
          if (
            cachedBranchCost === undefined ||
            cachedSessionId !== sessionId ||
            cachedLeafId !== leafId
          ) {
            let total = 0;
            for (const entry of ctx.sessionManager.getBranch()) {
              total += getEntryCost(entry);
            }
            cachedSessionId = sessionId;
            cachedLeafId = leafId;
            cachedBranchCost = total;
          }

          const paint: Paint = (color, text) => ctx.ui.theme.fg(color, text);
          const model = ctx.model;
          const usingSubscription = model
            ? model.provider === "kimi-coding" ||
              Boolean(ctx.modelRegistry?.isUsingOAuth?.(model))
            : false;
          const provider =
            model && (data.getAvailableProviderCount?.() ?? 0) > 1
              ? model.provider
              : undefined;
          const rawThinking =
            model?.reasoning === false
              ? "off"
              : (ctx.thinkingLevel ?? pi.getThinkingLevel?.() ?? "off");
          const thinking =
            model && rawThinking !== "off" ? rawThinking : undefined;

          const footerLine = format(
            {
              percent: ctx.getContextUsage()?.percent,
              estimatedCost: cachedBranchCost,
              usingSubscription,
              provider,
              thinking,
              model: model?.id ?? "no model",
              directory: formatDirectory(
                ctx.sessionManager.getCwd?.() ?? ctx.cwd,
              ),
              branch: data.getGitBranch(),
            },
            width,
            paint,
          );

          const extensionStatus = formatExtensionStatuses(
            data.getExtensionStatuses(),
            width,
            paint,
          );
          return extensionStatus !== undefined
            ? [footerLine, extensionStatus]
            : [footerLine];
        },
      };
    });
  });
}
