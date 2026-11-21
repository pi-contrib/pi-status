import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type FooterColor = "borderMuted" | "muted" | "accent" | "border" | "borderAccent"
  | "success" | "warning" | "error";
type Paint = (color: FooterColor, text: string) => string;

type FooterState = {
  percent: number | null | undefined;
  estimatedCost: number;
  model: string;
  directory: string;
  branch: string | null | undefined;
};

const sanitize = (label: string) => label.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "");

export function formatFooter(state: FooterState, width: number, paint: Paint): string {
  const separator = paint("borderMuted", "  ");
  const { percent, estimatedCost, model, directory, branch } = state;
  const used = percent != null && Number.isFinite(percent)
    ? Math.max(0, Math.floor(percent))
    : undefined;
  const color = (used ?? 0) >= 90 ? "error" : (used ?? 0) >= 70 ? "warning" : "success";
  const context = (cells: number) => {
    const filled = Math.min(cells, Math.floor(((used ?? 0) * cells) / 100));
    const bar = paint(color, "⣿".repeat(filled)) + paint("borderMuted", "⣿".repeat(cells - filled));
    const label = paint("muted", used === undefined ? "—" : `${used}%`);
    return cells > 0 ? `${bar} ${label}` : label;
  };
  // Pi reports a usage estimate for the active conversation branch, not a billed amount.
  const cost = paint("muted", `~$${estimatedCost.toFixed(2)}`);
  const modelLabel = paint("accent", sanitize(model));
  const directoryLabel = paint("border", `  ${sanitize(directory)}`);
  const branchLabel = branch ? paint("borderAccent", `  ${sanitize(branch)}`) : undefined;
  const core = [context(10), cost, modelLabel];
  const location = [...core, directoryLabel];
  const layouts = [
    branchLabel ? [...location, branchLabel] : location,
    location,
    core,
    [context(5), cost, modelLabel],
    [context(0), modelLabel],
    [modelLabel],
  ];
  for (const layout of layouts) {
    const line = layout.join(separator);
    if (visibleWidth(line) <= width) return line;
  }
  return truncateToWidth(modelLabel, width);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, _theme, data) => ({
      dispose: data.onBranchChange(() => tui.requestRender()),
      invalidate() {},
      render(width) {
        let estimatedCost = 0;
        for (const entry of ctx.sessionManager.getBranch()) {
          if (entry.type === "message" && entry.message.role === "assistant") {
            estimatedCost += entry.message.usage.cost.total;
          }
        }

        const line = formatFooter({
          percent: ctx.getContextUsage()?.percent,
          estimatedCost,
          model: ctx.model?.id ?? "no model",
          directory: basename(ctx.cwd),
          branch: data.getGitBranch(),
        }, width, (color, text) => ctx.ui.theme.fg(color, text));
        const status = [...data.getExtensionStatuses().values()].filter(Boolean).join("  ");
        return status ? [line, truncateToWidth(status, width)] : [line];
      },
    }));
  });
}
