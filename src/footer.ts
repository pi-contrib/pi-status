import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type Color =
  | "borderMuted"
  | "muted"
  | "accent"
  | "border"
  | "borderAccent"
  | "success"
  | "warning"
  | "error";

type State = {
  percent: number | null | undefined;
  estimatedCost: number;
  model: string;
  directory: string;
  branch: string | null | undefined;
};

type Paint = (color: Color, text: string) => string;

const sanitize = (label: string) => label.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "");

export function format(state: State, width: number, paint: Paint): string {
  const separator = paint("borderMuted", "  ");
  const { percent, estimatedCost, model, directory, branch } = state;
  const usagePercent =
    percent != null && Number.isFinite(percent)
      ? Math.max(0, Math.floor(percent))
      : undefined;
  const usageColor: Color =
    (usagePercent ?? 0) >= 90
      ? "error"
      : (usagePercent ?? 0) >= 70
        ? "warning"
        : "success";

  const formatContextUsage = (cells: number) => {
    const filled = Math.floor((Math.min(usagePercent ?? 0, 100) * cells) / 100);
    const bar =
      paint(usageColor, "⣿".repeat(filled)) +
      paint("borderMuted", "⣿".repeat(cells - filled));
    const label = paint(
      "muted",
      usagePercent === undefined ? "—" : `${usagePercent}%`,
    );
    return cells > 0 ? `${bar} ${label}` : label;
  };

  // Pi reports a usage estimate for the active conversation branch, not a billed amount.
  const costLabel =
    Number.isFinite(estimatedCost) && estimatedCost >= 0
      ? `~$${estimatedCost.toFixed(2)}`
      : "~$—";
  const costSegment = paint("muted", costLabel);
  const modelSegment = paint("accent", sanitize(model));
  const directorySegment = paint("border", `  ${sanitize(directory)}`);
  const branchSegment = branch
    ? paint("borderAccent", `  ${sanitize(branch)}`)
    : undefined;

  const coreSegments = [formatContextUsage(10), costSegment, modelSegment];
  const locationSegments = [...coreSegments, directorySegment];
  const layouts = [
    branchSegment ? [...locationSegments, branchSegment] : locationSegments,
    locationSegments,
    coreSegments,
    [formatContextUsage(5), costSegment, modelSegment],
    [formatContextUsage(0), modelSegment],
    [modelSegment],
  ];

  for (const layout of layouts) {
    const footerLine = layout.join(separator);
    if (visibleWidth(footerLine) <= width) return footerLine;
  }
  return truncateToWidth(modelSegment, width);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    // A new leaf means the active branch has changed or gained a message.
    // Keep the expensive traversal out of ordinary terminal redraws.
    let cachedLeafId: string | null | undefined;
    let cachedCost = 0;
    ctx.ui.setFooter((tui, _theme, data) => ({
      dispose: data.onBranchChange(() => tui.requestRender()),
      invalidate() {},
      render(width) {
        const leafId = ctx.sessionManager.getLeafId();
        if (cachedLeafId !== leafId) {
          cachedCost = 0;
          for (const entry of ctx.sessionManager.getBranch()) {
            if (
              entry.type === "message" &&
              entry.message.role === "assistant"
            ) {
              cachedCost += entry.message.usage.cost.total;
            }
          }
          cachedLeafId = leafId;
        }

        const footerLine = format(
          {
            percent: ctx.getContextUsage()?.percent,
            estimatedCost: cachedCost,
            model: ctx.model?.id ?? "no model",
            directory: basename(ctx.cwd),
            branch: data.getGitBranch(),
          },
          width,
          (color, text) => ctx.ui.theme.fg(color, text),
        );
        const extensionStatus = [...data.getExtensionStatuses().values()]
          .filter(Boolean)
          .join("  ");
        return extensionStatus
          ? [footerLine, truncateToWidth(extensionStatus, width)]
          : [footerLine];
      },
    }));
  });
}
