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
  type Paint,
  type State,
  type Thinking,
} from "../src/footer.ts";

const plain: Paint = (_color, text) => text;
const styled: Paint = (color, text) => `${color}:${text}`;
const ansi: Paint = (_color, text) => `\x1b[38;5;245m${text}\x1b[39m`;

const baseState: State = {
  percent: 70,
  estimatedCost: 0.02,
  model: "gpt-6-sol",
  directory: "my\nproject",
  branch: "main",
};

test("uses warning and error colors at the context thresholds", () => {
  assert.match(format(baseState, 100, styled), /warning:⣿/);
  assert.match(
    format({ ...baseState, percent: 69.6 }, 100, styled),
    /warning:⣿/,
  );
  assert.match(format({ ...baseState, percent: 90 }, 100, styled), /error:⣿/);
});

test("lights at least one cell for low nonzero context usage and caps 10/10 until 100%", () => {
  const zero = format({ ...baseState, percent: 0 }, 100, styled);
  assert.doesNotMatch(zero, /success:⣿/);

  const low = format({ ...baseState, percent: 4 }, 100, styled);
  assert.match(low, /success:⣿borderMuted:⣿{9} /u);
  assert.match(low, /muted:4%/);

  const high = format({ ...baseState, percent: 98 }, 100, styled);
  assert.match(high, /error:⣿{9}borderMuted:⣿ /u);

  const full = format({ ...baseState, percent: 100 }, 100, styled);
  assert.match(full, /error:⣿{10}borderMuted: /u);
});

test("sanitizes labels and keeps muted bar alignment when context usage is unknown", () => {
  const line = stripVTControlCharacters(
    format({ ...baseState, percent: null }, 100, plain),
  );
  assert.match(line, /⣿{10} —.*myproject/u);
  assert.doesNotMatch(line, /\n/);
});

test("formats sub-cent, standard, subscription, and invalid costs", () => {
  assert.match(
    format({ ...baseState, estimatedCost: 0 }, 100, plain),
    /~\$0\.00/,
  );
  assert.match(
    format({ ...baseState, estimatedCost: 0.004 }, 100, plain),
    /~\$0\.004/,
  );
  assert.match(
    format({ ...baseState, estimatedCost: 0.0099 }, 100, plain),
    /~\$0\.01(?!\d)/,
  );
  assert.match(
    format(
      { ...baseState, estimatedCost: 1.33, usingSubscription: true },
      100,
      plain,
    ),
    /~\$1\.33 \(sub\)/,
  );
  for (const cost of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.match(
      format(
        { ...baseState, estimatedCost: cost, usingSubscription: true },
        100,
        plain,
      ),
      /~\$—(?! \(sub\))/,
    );
  }
  const over = format({ ...baseState, percent: 150 }, 100, plain);
  assert.match(over, /150%/);
  assert.equal((over.match(/⣿/gu) ?? []).length, 10);
});

test("renders thinking level with dedicated theme token and optional multi-provider prefix", () => {
  const withBoth = format(
    {
      ...baseState,
      provider: "anthropic",
      thinking: "high",
    },
    300,
    styled,
  );
  assert.match(
    withBoth,
    /muted:\(anthropic\) accent:gpt-6-solborderMuted: • thinkingHigh:high/,
  );

  const offThinking = format(
    {
      ...baseState,
      thinking: "off",
    },
    100,
    plain,
  );
  assert.doesNotMatch(offThinking, /•/);
});

test("drops provider prefix and truncates long branch or directory before dropping whole segments", () => {
  const rich: State = {
    percent: 25,
    estimatedCost: 0.12,
    provider: "openrouter",
    thinking: "medium",
    model: "claude-sonnet-4-5",
    directory: "pi-status",
    branch: "feature/JIRA-1234-long-branch-description-for-status-footer",
  };

  const at90 = format(rich, 90, plain);
  assert.ok(visibleWidth(at90) <= 90);
  assert.match(at90, / {2}pi-status/);
  assert.match(at90, / {2}feature\/.*…/);

  const longDir: State = {
    ...baseState,
    directory: "very-long-enterprise-monorepo-package-directory",
    branch: null,
  };
  const at70 = format(longDir, 70, plain);
  assert.ok(visibleWidth(at70) <= 70);
  assert.match(at70, / {2}very-long-.*…/);
});

test("keeps the model visible in a narrow terminal and fits every width", () => {
  assert.equal(
    stripVTControlCharacters(format(baseState, 9, plain)),
    baseState.model,
  );

  const complex: State = {
    percent: 82,
    estimatedCost: 0.004,
    usingSubscription: true,
    provider: "bedrock",
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

  const initialLines = footer.render(120);
  assert.equal(initialLines.length, 2);
  assert.match(initialLines[0] ?? "", /~\$0\.30 \(sub\)/);
  assert.match(initialLines[0] ?? "", /\(openai-codex\) test-model • high/);
  assert.match(initialLines[1] ?? "", /active job/);
  assert.equal(traversals, 1);

  // Cached on ordinary terminal redraw
  footer.render(120);
  assert.equal(traversals, 1);

  // Thinking level change requests redraw and updates rendered thinking suffix
  thinkingLevel = "low";
  handlers.get("thinking_level_select")?.();
  assert.equal(renderRequests, 1);
  assert.match(footer.render(120)[0] ?? "", /test-model • low/);

  // Switching to a new empty session with the same leafId (null -> null) invalidates via sessionId
  leafId = null;
  entries.length = 0;
  assert.match(footer.render(120)[0] ?? "", /~\$0\.00 \(sub\)/);
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
  assert.match(footer.render(120)[0] ?? "", /~\$0\.004 \(sub\)/);
  assert.equal(traversals, 3);

  footer.dispose?.();
});
