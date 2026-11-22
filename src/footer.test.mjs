import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import register, { format } from "./footer.ts";

const plain = (_color, text) => text;
const styled = (color, text) => `${color}:${text}`;

const state = {
  percent: 70,
  estimatedCost: 0.02,
  model: "gpt-6-sol",
  directory: "my\nproject",
  branch: "main",
};

test("uses warning and error colors at the context thresholds", () => {
  assert.match(format(state, 100, styled), /warning:⣿/);
  assert.match(format({ ...state, percent: 90 }, 100, styled), /error:⣿/);
});

test("sanitizes labels and handles unknown context usage", () => {
  const line = stripVTControlCharacters(
    format({ ...state, percent: null }, 100, plain),
  );
  assert.match(line, /—.*myproject/);
  assert.doesNotMatch(line, /\n/);
});

test("keeps the model visible in a narrow terminal", () => {
  assert.equal(stripVTControlCharacters(format(state, 9, plain)), state.model);
});

test("fits every layout into the available width", () => {
  const long = {
    ...state,
    model: "日本語-long-model",
    directory: "wide-directory",
    branch: "feature/long",
  };
  for (let width = 0; width <= 80; width++) {
    const line = format(long, width, plain);
    assert.ok(visibleWidth(line) <= width, `width ${width}: ${line}`);
  }
});

test("shows safe fallbacks for invalid usage and cost", () => {
  for (const cost of [NaN, Infinity, -1]) {
    assert.match(format({ ...state, estimatedCost: cost }, 100, plain), /~\$—/);
  }
  const line = format({ ...state, percent: 150 }, 100, plain);
  assert.match(line, /150%/);
  assert.equal((line.match(/⣿/gu) ?? []).length, 10);
});

test("caches branch cost until the session leaf changes", () => {
  let footerFactory;
  const pi = {
    on(event, handler) {
      assert.equal(event, "session_start");
      this.start = handler;
    },
  };
  register(pi);
  let leafId = "a";
  let traversals = 0;
  const entries = [
    {
      type: "message",
      message: { role: "assistant", usage: { cost: { total: 0.25 } } },
    },
  ];
  const ctx = {
    hasUI: true,
    cwd: "/tmp/project",
    model: { id: "test-model" },
    getContextUsage: () => ({ percent: 25 }),
    sessionManager: {
      getLeafId: () => leafId,
      getBranch: () => {
        traversals++;
        return entries;
      },
    },
    ui: {
      theme: { fg: plain },
      setFooter: (factory) => {
        footerFactory = factory;
      },
    },
  };
  pi.start({}, ctx);
  const footer = footerFactory({ requestRender() {} }, null, {
    onBranchChange: () => () => {},
    getGitBranch: () => null,
    getExtensionStatuses: () => new Map(),
  });
  assert.match(footer.render(100)[0], /~\$0\.25/);
  footer.render(100);
  assert.equal(traversals, 1);
  leafId = "b";
  entries.push({
    type: "message",
    message: { role: "assistant", usage: { cost: { total: 0.5 } } },
  });
  assert.match(footer.render(100)[0], /~\$0\.75/);
  assert.equal(traversals, 2);
});
