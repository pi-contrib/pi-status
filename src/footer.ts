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
  | "text"
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
  tokens?: number | null | undefined;
  contextWindow?: number | null | undefined;
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

const THINKING_LABELS: Partial<Record<Exclude<Thinking, "off">, string>> = {
  xhigh: "x-high",
};

const PROVIDER_NAMES: Record<string, string> = {
  "amazon-bedrock": "Bedrock",
  bedrock: "Bedrock",
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  google: "Google",
  "google-vertex": "Google Vertex",
  "google-gemini-cli": "Gemini CLI",
  "github-copilot": "GitHub Copilot",
  openrouter: "OpenRouter",
  "kimi-coding": "Kimi",
  xai: "xAI",
  groq: "Groq",
  cerebras: "Cerebras",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  azure: "Azure",
  "vercel-ai-gateway": "Vercel",
  "cloudflare-workers-ai": "Cloudflare",
  "cloudflare-ai-gateway": "Cloudflare",
  huggingface: "Hugging Face",
  fireworks: "Fireworks",
  together: "Together",
  baseten: "Baseten",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax",
  moonshotai: "Moonshot",
  "moonshotai-cn": "Moonshot",
  zai: "Z.ai",
  "zai-coding-cn": "Z.ai",
  nvidia: "NVIDIA",
  meta: "Meta",
  xiaomi: "Xiaomi",
};

const sanitize = (label: string) => label.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "");

export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "0";
  if (count < 1000) return `${Math.round(count)}`;
  if (count < 9950) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (count < 999_500) return `${Math.round(count / 1000)}k`;
  if (count < 9_950_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatModelName(raw: string): string {
  const cleaned = sanitize(raw).trim();
  if (!cleaned) return "no model";
  const withoutVendor = cleaned.replace(/^[^:]+:\s+(?=\S)/, "");
  const withoutLatest = withoutVendor.replace(/\s+\(latest\)$/i, "").trim();
  return withoutLatest || cleaned;
}

export function formatProviderName(provider: string): string {
  const cleaned = sanitize(provider).trim();
  if (!cleaned) return "";
  const known = PROVIDER_NAMES[cleaned.toLowerCase()];
  if (known) return known;
  return cleaned
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatThinkingLevel(level: Exclude<Thinking, "off">): string {
  return THINKING_LABELS[level] ?? level;
}

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
  const dot = paint("borderMuted", " · ");
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
  const percentColor: Color =
    usagePercent === undefined
      ? "muted"
      : usagePercent >= 90
        ? "error"
        : usagePercent >= 70
          ? "warning"
          : "muted";

  const formatContextUsage = (cells: number) => {
    const label = paint(
      percentColor,
      usagePercent === undefined ? "—" : `${usagePercent}%`,
    );
    if (cells <= 0) return label;
    const filled =
      percent == null || !Number.isFinite(percent) || percent <= 0
        ? 0
        : percent >= 100
          ? cells
          : Math.min(
              cells - 1,
              Math.max(1, Math.round((percent * cells) / 100)),
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
      ? `${costCompact}${dot}${paint("muted", "subscription")}`
      : costCompact;

  const cleanModel = formatModelName(model);
  const cleanProvider = provider ? formatProviderName(provider) : "";
  const activeThinking = thinking && thinking !== "off" ? thinking : undefined;

  const modelBare = paint("accent", cleanModel);
  const modelWithProvider = cleanProvider
    ? `${modelBare} ${paint("muted", `(${cleanProvider})`)}`
    : modelBare;
  const thinkingSuffix = activeThinking
    ? `${dot}${paint(THINKING_COLORS[activeThinking], formatThinkingLevel(activeThinking))}`
    : "";
  const modelWithThinking = `${modelBare}${thinkingSuffix}`;
  const modelFull = `${modelWithProvider}${thinkingSuffix}`;

  const cleanDirectory = sanitize(directory);
  const cleanBranch = branch ? sanitize(branch) : "";

  const tryFitTrailing = (
    prefixSegments: readonly string[],
    color: Color,
    icon: string,
    label: string,
    allowTruncate: boolean,
  ): string | undefined => {
    if (!label) return undefined;
    const prefix = `${prefixSegments.join(separator)}${separator}`;
    const full = `${prefix}${paint(color, `${icon} ${label}`)}`;
    if (visibleWidth(full) <= width) return full;
    if (!allowTruncate) return undefined;

    const iconOverhead = visibleWidth(paint(color, `${icon} `));
    const maxLabelWidth = width - visibleWidth(prefix) - iconOverhead;
    if (maxLabelWidth < MIN_TRUNCATED_LABEL_WIDTH) return undefined;

    const truncated = truncateToWidth(label, maxLabelWidth, "…");
    const candidate = `${prefix}${paint(color, `${icon} ${truncated}`)}`;
    return visibleWidth(candidate) <= width ? candidate : undefined;
  };

  const bar10 = formatContextUsage(10);
  const bar5 = formatContextUsage(5);
  const bar0 = formatContextUsage(0);

  const coreTiers: string[][] = [
    ...(cleanProvider ? [[bar10, costFull, modelFull]] : []),
    [bar10, costFull, modelWithThinking],
    ...(costFull !== costCompact
      ? [[bar10, costCompact, modelWithThinking]]
      : []),
    [bar5, costCompact, modelWithThinking],
  ];

  if (cleanDirectory && cleanBranch) {
    const dirSegment = paint("border", ` ${cleanDirectory}`);
    for (const allowTruncate of [false, true]) {
      for (const tier of coreTiers) {
        const fitted = tryFitTrailing(
          [...tier, dirSegment],
          "borderAccent",
          "",
          cleanBranch,
          allowTruncate,
        );
        if (fitted !== undefined) return fitted;
      }
    }
  }

  if (cleanDirectory) {
    for (const allowTruncate of [false, true]) {
      for (const tier of coreTiers) {
        const fitted = tryFitTrailing(
          tier,
          "border",
          "",
          cleanDirectory,
          allowTruncate,
        );
        if (fitted !== undefined) return fitted;
      }
    }
  }

  const candidateLayouts: string[][] = [
    ...coreTiers,
    [bar0, costCompact, modelWithThinking],
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

          const contextUsage = ctx.getContextUsage();
          const footerLine = format(
            {
              percent: contextUsage?.percent,
              tokens: contextUsage?.tokens,
              contextWindow:
                contextUsage?.contextWindow ?? model?.contextWindow,
              estimatedCost: cachedBranchCost,
              usingSubscription,
              provider,
              thinking,
              model: model?.name?.trim() || model?.id || "no model",
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
