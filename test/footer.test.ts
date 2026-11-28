import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
  ReadonlyFooterDataProvider,
  SessionEntry,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import register, {
  type Color,
  format,
  formatDirectory,
  formatExtensionStatuses,
  formatModelName,
  formatProviderName,
  formatThinkingLevel,
  formatTokens,
  type Paint,
  type State,
  type Thinking,
} from "../src/footer.ts";

const plain: Paint = (_color, text) => text;
const styled: Paint = (color, text) => `${color}:${text}`;
const ansi: Paint = (_color, text) => `\x1b[38;5;245m${text}\x1b[39m`;

const baseState: State = {
  percent: 70,
  tokens: 140_000,
  contextWindow: 200_000,
  estimatedCost: 0.02,
  model: "GPT-6 Sol",
  directory: "my\nproject",
  branch: "main",
};

test("uses warning and error colors on both gauge and percentage at context thresholds", () => {
  const warn = format(baseState, 300, styled);
  assert.match(warn, /warning:⣿/);
  assert.match(warn, /warning:70%/);
  assert.doesNotMatch(warn, /140k\/200k/);

  assert.match(
    format({ ...baseState, percent: 69.6 }, 300, styled),
    /warning:⣿.*warning:70%/,
  );
  assert.match(
    format({ ...baseState, percent: 90 }, 300, styled),
    /error:⣿.*error:90%/,
  );
  assert.match(
    format({ ...baseState, percent: 25 }, 300, styled),
    /success:⣿.*muted:25%/,
  );
});

test("lights a full cell for nonzero usage and caps at 9/10 until 100%", () => {
  const zero = format({ ...baseState, percent: 0, tokens: 0 }, 300, styled);
  assert.doesNotMatch(zero, /success:⣿/u);

  const tiny = format({ ...baseState, percent: 0.1 }, 300, styled);
  assert.match(tiny, /success:⣿borderMuted:⣿{9} /u);

  const low = format({ ...baseState, percent: 2, tokens: 8000 }, 300, styled);
  assert.match(low, /success:⣿borderMuted:⣿{9} muted:2%/u);
  assert.doesNotMatch(low, /8000|8k|200k/);

  const high = format({ ...baseState, percent: 98 }, 300, styled);
  assert.match(high, /error:⣿{9}borderMuted:⣿ /u);

  const full = format({ ...baseState, percent: 100 }, 300, styled);
  assert.match(full, /error:⣿{10}borderMuted: /u);
});

test("sanitizes labels and keeps muted bar alignment when context usage is unknown", () => {
  const line = stripVTControlCharacters(
    format({ ...baseState, percent: null, tokens: null }, 120, plain),
  );
  assert.match(line, /⣿{10} —.*myproject/u);
  assert.doesNotMatch(line, /\n/);
});

test("formats token counts, model names, provider names, and thinking levels cleanly", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(512), "512");
  assert.equal(formatTokens(1000), "1k");
  assert.equal(formatTokens(2500), "2.5k");
  assert.equal(formatTokens(26_000), "26k");
  assert.equal(formatTokens(999_600), "1M");
  assert.equal(formatTokens(1_250_000), "1.3M");

  assert.equal(
    formatModelName("Claude Sonnet 4.5 (latest)"),
    "Claude Sonnet 4.5",
  );
  assert.equal(
    formatModelName("Anthropic: Claude Sonnet 4.5"),
    "Claude Sonnet 4.5",
  );
  assert.equal(
    formatModelName("eu.anthropic.claude-sonnet-4-5-20250929-v1:0"),
    "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
  );
  assert.equal(formatModelName("   "), "no model");

  assert.equal(formatProviderName("openai-codex"), "OpenAI Codex");
  assert.equal(formatProviderName("amazon-bedrock"), "Bedrock");
  assert.equal(formatProviderName("openrouter"), "OpenRouter");
  assert.equal(formatProviderName("my-custom_gateway"), "My Custom Gateway");

  assert.equal(formatThinkingLevel("xhigh"), "x-high");
  assert.equal(formatThinkingLevel("high"), "high");
});

test("formats sub-cent, standard, subscription, and invalid costs", () => {
  assert.match(
    format({ ...baseState, estimatedCost: 0 }, 300, styled),
    /borderAccent:~\$0\.00/,
  );
  assert.match(
    format({ ...baseState, estimatedCost: 0.004 }, 120, plain),
    /~\$0\.004/,
  );
  assert.match(
    format({ ...baseState, estimatedCost: 0.0099 }, 120, plain),
    /~\$0\.01(?!\d)/,
  );
  assert.match(
    format(
      { ...baseState, estimatedCost: 1.33, usingSubscription: true },
      300,
      styled,
    ),
    /borderAccent:~\$1\.33borderMuted: · muted:subscription/,
  );
  for (const cost of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.match(
      format(
        { ...baseState, estimatedCost: cost, usingSubscription: true },
        300,
        styled,
      ),
      /muted:~\$—(?!.*subscription)/,
    );
  }
  const over = format({ ...baseState, percent: 150 }, 120, plain);
  assert.match(over, /150%/);
  assert.equal((over.match(/⣿/gu) ?? []).length, 10);
});

test("renders model before humanized provider and thinking level", () => {
  const withBoth = format(
    {
      ...baseState,
      model: "Anthropic: Claude Sonnet 4.5 (latest)",
      provider: "openrouter",
      thinking: "xhigh",
    },
    300,
    styled,
  );
  assert.match(
    withBoth,
    /accent:Claude Sonnet 4\.5 muted:\(OpenRouter\)borderMuted: · thinkingXhigh:x-high/,
  );

  const offThinking = format(
    {
      ...baseState,
      thinking: "off",
    },
    120,
    plain,
  );
  assert.doesNotMatch(offThinking, /GPT-6 Sol ·/);
});

test("colors cwd and branch independently from effort and cost", () => {
  const line = format({ ...baseState, thinking: "medium" }, 300, styled);
  assert.match(line, /thinkingMedium:medium/);
  assert.match(line, /syntaxOperator: myproject/);
  assert.match(line, /syntaxNumber: main/);
  assert.match(line, /borderAccent:~\$0\.02/);
});

test("compacts secondary details before dropping branch or directory in an 80-col split pane", () => {
  const rich: State = {
    percent: 13,
    tokens: 35_000,
    contextWindow: 272_000,
    estimatedCost: 1.33,
    usingSubscription: true,
    provider: "openai-codex",
    thinking: "xhigh",
    model: "GPT-5.3 Codex",
    directory: "pi-status",
    branch: "main",
  };

  const at80 = format(rich, 80, plain);
  assert.ok(visibleWidth(at80) <= 80, `width 80 exceeded: ${at80}`);
  assert.match(at80, /13%/);
  assert.match(at80, /~\$1\.33/);
  assert.match(at80, /GPT-5\.3 Codex · x-high/);
  assert.match(at80, / pi-status/);
  assert.match(at80, / main/);
  assert.doesNotMatch(at80, /OpenAI Codex/);
  assert.doesNotMatch(at80, /subscription/);
});

test("drops secondary tags and truncates long branch or directory before dropping whole segments", () => {
  const rich: State = {
    percent: 25,
    tokens: 50_000,
    contextWindow: 200_000,
    estimatedCost: 0.12,
    provider: "openrouter",
    thinking: "medium",
    model: "Claude Sonnet 4.5",
    directory: "pi-status",
    branch: "feature/JIRA-1234-long-branch-description-for-status-footer",
  };

  const at90 = format(rich, 90, plain);
  assert.ok(visibleWidth(at90) <= 90);
  assert.match(at90, / pi-status/);
  assert.match(stripVTControlCharacters(at90), / featu.*…/);

  const longDir: State = {
    ...baseState,
    directory: "very-long-enterprise-monorepo-package-directory",
    branch: null,
  };
  const at70 = format(longDir, 70, plain);
  assert.ok(visibleWidth(at70) <= 70);
  assert.match(at70, / very-long-.*…/);
});

test("keeps the model visible in a narrow terminal and fits every width", () => {
  assert.equal(
    stripVTControlCharacters(format(baseState, 9, plain)),
    baseState.model,
  );

  const complex: State = {
    percent: 82,
    tokens: 164_000,
    contextWindow: 200_000,
    estimatedCost: 0.004,
    usingSubscription: true,
    provider: "amazon-bedrock",
    thinking: "xhigh",
    model: "日本語-long-model",
    directory: "wide-directory",
    branch: "feature/long-branch-name",
  };
  for (let width = 0; width <= 120; width++) {
    const line = format(complex, width, ansi);
    assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
  }
});

test("formats home, root, and regular directories cleanly", () => {
  assert.equal(formatDirectory("/home/dev", "/home/dev"), "~");
  assert.equal(formatDirectory("/home/dev/", "/home/dev"), "~");
  assert.equal(formatDirectory("/", "/home/dev"), "/");
  assert.equal(
    formatDirectory("/home/dev/pi-status", "/home/dev"),
    "pi-status",
  );
});

test("sanitizes, sorts, resets ANSI, and joins extension statuses", () => {
  const statuses = new Map<string, string>([
    ["z-plain", "  ready\nnow\t"],
    ["a-ansi", "\x1b[1;32m✓ ok"],
    ["m-blank", "   \n\t  "],
    ["b-osc", "\x1b]2;malicious-title\x07\x1b[2Jclean"],
  ]);

  const rendered = formatExtensionStatuses(statuses, 100, styled);
  assert.ok(rendered !== undefined);
  assert.doesNotMatch(rendered, /[\r\n\t]/);
  assert.equal(rendered.includes("\u0007"), false);
  assert.doesNotMatch(rendered, /malicious-title/);
  assert.equal(
    rendered,
    "\x1b[1;32m✓ ok\x1b[0mborderMuted:  muted:cleanborderMuted:  muted:ready now",
  );

  const onlyBlank = new Map<string, string>([["empty", "  \n  "]]);
  assert.equal(formatExtensionStatuses(onlyBlank, 80, plain), undefined);
});

test("tracks session switches, guards aborted usage, and skips non-TUI modes", () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  let footerFactory: Parameters<ExtensionUIContext["setFooter"]>[0];
  let thinkingLevel: Thinking = "high";
  let setFooterCalls = 0;

  const pi = {
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler);
      return () => {};
    },
    getThinkingLevel: () => thinkingLevel,
  } as unknown as ExtensionAPI;

  register(pi);

  const startHandler = handlers.get("session_start");
  assert.ok(startHandler, "session_start handler registered");

  let sessionId = "s1";
  let leafId: string | null = "a";
  let traversals = 0;
  let renderRequests = 0;
  const entries: SessionEntry[] = [
    {
      type: "message",
      id: "a",
      parentId: null,
      timestamp: "2026-11-27T00:00:00Z",
      message: {
        role: "assistant",
        usage: { cost: { total: 0.25 } },
      } as never,
    },
    {
      // Aborted/incomplete assistant turn missing usage.cost
      type: "message",
      id: "aborted",
      parentId: "a",
      timestamp: "2026-11-27T00:00:01Z",
      message: {
        role: "assistant",
      } as never,
    },
    {
      type: "compaction",
      id: "comp",
      parentId: "aborted",
      timestamp: "2026-11-27T00:00:02Z",
      summary: "compacted",
      firstKeptEntryId: "a",
      tokensBefore: 1000,
      usage: { cost: { total: 0.05 } } as never,
    },
  ];

  const makeCtx = (mode: ExtensionContext["mode"]): ExtensionContext =>
    ({
      hasUI: true,
      mode,
      cwd: "/home/dev/project",
      model: {
        id: "test-model",
        name: "Test Model",
        provider: "openai-codex",
        reasoning: true,
      },
      modelRegistry: {
        isUsingOAuth: () => true,
      },
      getContextUsage: () => ({
        tokens: 2500,
        contextWindow: 10000,
        percent: 25,
      }),
      sessionManager: {
        getCwd: () => "/home/dev/project",
        getSessionId: () => sessionId,
        getLeafId: () => leafId,
        getBranch: () => {
          traversals++;
          return entries;
        },
      },
      ui: {
        theme: {
          fg: (_color: Color, text: string) => text,
        },
        setFooter: (
          factory: Parameters<ExtensionUIContext["setFooter"]>[0],
        ) => {
          setFooterCalls++;
          footerFactory = factory;
        },
      },
    }) as unknown as ExtensionContext;

  const startEvent: SessionStartEvent = {
    type: "session_start",
    reason: "startup",
  };

  // RPC mode has hasUI: true, but must not mount a terminal footer
  startHandler(startEvent, makeCtx("rpc"));
  assert.equal(setFooterCalls, 0);

  startHandler(startEvent, makeCtx("tui"));
  assert.equal(setFooterCalls, 1);
  assert.ok(footerFactory);

  const footerData: ReadonlyFooterDataProvider = {
    onBranchChange: () => () => {},
    getGitBranch: () => "main",
    getAvailableProviderCount: () => 2,
    getExtensionStatuses: () => new Map([["ext", "active\njob"]]),
  };

  const footer = footerFactory(
    {
      requestRender() {
        renderRequests++;
      },
    } as never,
    {} as never,
    footerData,
  );

  const initialLines = footer.render(160);
  assert.equal(initialLines.length, 2);
  assert.match(initialLines[0] ?? "", /25%/);
  assert.doesNotMatch(initialLines[0] ?? "", /2\.5k\/10k/);
  assert.match(initialLines[0] ?? "", /~\$0\.30 · subscription/);
  assert.match(initialLines[0] ?? "", /Test Model \(OpenAI Codex\) · high/);
  assert.match(initialLines[1] ?? "", /active job/);
  assert.equal(traversals, 1);

  // Cached on ordinary terminal redraw
  footer.render(160);
  assert.equal(traversals, 1);

  // Thinking level change requests redraw and updates rendered thinking suffix
  thinkingLevel = "low";
  handlers.get("thinking_level_select")?.();
  assert.equal(renderRequests, 1);
  assert.match(
    footer.render(160)[0] ?? "",
    /Test Model \(OpenAI Codex\) · low/,
  );

  // Switching to a new empty session with the same leafId (null -> null) invalidates via sessionId
  leafId = null;
  entries.length = 0;
  assert.match(footer.render(160)[0] ?? "", /~\$0\.00 · subscription/);
  assert.equal(traversals, 2);

  entries.push({
    type: "usage",
    id: "u1",
    parentId: null,
    timestamp: "2026-11-27T00:00:03Z",
    kind: "cache_warm",
    provider: "openai-codex",
    model: "test-model",
    usage: { cost: { total: 0.004 } } as never,
  });
  sessionId = "s2";
  assert.match(footer.render(160)[0] ?? "", /~\$0\.004 · subscription/);
  assert.equal(traversals, 3);

  footer.dispose?.();
});
