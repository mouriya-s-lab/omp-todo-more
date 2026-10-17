import { describe, expect, test } from "bun:test";
import type { ExtensionRunner, RegisteredTool } from "@oh-my-pi/pi-coding-agent";
import { ExtensionToolWrapper, RegisteredToolAdapter } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/wrapper";
import type { TUI } from "@oh-my-pi/pi-tui";
import { ToolExecutionComponent } from "@oh-my-pi/pi-tui/chat/tool-execution";
import { TODO_TOOL_DEFINITION } from "../index.ts";
import type { TodoMoreSnapshot } from "../src/state.ts";
import type { TodoMoreDetails } from "../src/tool.ts";

/**
 * One `todo` call paints one card. The host renders the call body and the result
 * body of a non-merged renderer in the same block, so the registered definition
 * must merge them; this drives the real `ToolExecutionComponent` through the
 * host's own wrapper chain and reads the rendered card.
 */

const PREVIEW_MARKER = "Preview only — not committed.";
const PREVIEW_ROLE = "todo-more.preview";
const PANEL_ROLE = "todo-more.panel";
const CHECKLIST_ROLE = "todo-more.list";
const CARD_TOP = "╭";

const document = `*** Begin Todo
INIT "Stop the double render" "One card per call" "Native and ANSI verified"
PHASE "Implementation"
ADD "Read the merge path" "Follow the host view merge" 25
ADD "Set the flag" "Declare mergeCallAndResult on the tool" 10
*** End Todo
`;

const snapshot: TodoMoreSnapshot = {
	goal: { objective: "Stop the double render", measure: "One card per call", doneWhen: "Native and ANSI verified" },
	phases: [
		{
			name: "Implementation",
			items: [
				{
					title: "Read the merge path",
					explanation: "Follow the host view merge",
					status: "in_progress",
					time: { kind: "estimated", budgetId: "b1", minutes: 25, elapsedMs: 0, runningSince: null },
				},
				{
					title: "Set the flag",
					explanation: "Declare mergeCallAndResult on the tool",
					status: "pending",
					time: { kind: "estimated", budgetId: "b2", minutes: 10, elapsedMs: 0, runningSince: null },
				},
			],
		},
	],
};

const result: { content: { type: "text"; text: string }[]; details: TodoMoreDetails } = {
	content: [{ type: "text", text: "Todo list initialized." }],
	details: {
		op: "batch",
		operations: ["init", "append", "append"],
		phases: [
			{
				name: "Implementation",
				tasks: [
					{ content: "Read the merge path", status: "in_progress" },
					{ content: "Set the flag", status: "pending" },
				],
			},
		],
		storage: "session",
		todoMore: true,
		more: snapshot,
	},
};

/** The component only calls `requestRender`/`requestComponentRender`; no terminal is needed. */
const headlessUi: TUI = { requestRender() {}, requestComponentRender() {} } as unknown as TUI;
/** The adapter stores the runner and uses it only in `execute`, which this card test never calls. */
const unusedRunner = undefined as unknown as ExtensionRunner;

/**
 * The card path never reads the parameter schema, and the registry slot that
 * `RegisteredToolAdapter` takes erases `TParams` (its `renderCall` is typed over
 * `unknown`), while this definition's hooks are typed over its own schema.
 */
const registered = {
	definition: TODO_TOOL_DEFINITION,
	extensionPath: "test/card.test.ts",
	sourceInfo: { path: "test/card.test.ts", source: "extension", scope: "project", origin: "package" },
} as RegisteredTool;
/** The tool object the transcript receives: extension definition → adapter → interceptor wrapper. */
const renderedTool = new ExtensionToolWrapper(new RegisteredToolAdapter(registered, unusedRunner), unusedRunner);

function component(): ToolExecutionComponent {
	return new ToolExecutionComponent(
		"todo",
		{ input: document.slice(0, 40) },
		{ showImages: false, useBuiltInRenderer: false },
		renderedTool,
		headlessUi,
		process.cwd(),
		"todo-call",
	);
}

function settle(target: ToolExecutionComponent): void {
	target.updateArgs({ input: document });
	target.setArgsComplete();
	target.setExecutionStarted();
	target.updateResult({ content: result.content, details: result.details }, false, "todo-call");
}

/** Every string the native card tree carries, in render order. */
function nativeStrings(target: ToolExecutionComponent): string[] {
	const found: string[] = [];
	const walk = (value: unknown): void => {
		if (typeof value === "string") found.push(value);
		else if (Array.isArray(value)) for (const item of value) walk(item);
		else if (value && typeof value === "object") for (const item of Object.values(value)) walk(item);
	};
	walk(target.describe({ supports: (kind: string) => kind === "tool" } as never));
	return found;
}

const count = (values: readonly string[], needle: string): number => values.filter((value) => value.includes(needle)).length;

describe("one card per todo call", () => {
	test("streaming arguments paint the uncommitted preview", () => {
		const pending = component();
		const lines = pending.render(100);
		const nodes = nativeStrings(pending);

		expect(count(lines, PREVIEW_MARKER)).toBe(1);
		expect(count(lines, "· 25m")).toBe(0);
		expect(count(nodes, PREVIEW_MARKER)).toBe(1);
		expect(count(nodes, PANEL_ROLE)).toBe(0);
		pending.stopAnimation();
	});

	test("the result replaces the call view in the ANSI transcript", () => {
		const settled = component();
		settle(settled);
		const lines = settled.render(100);

		expect(count(lines, PREVIEW_MARKER)).toBe(0);
		expect(count(lines, CARD_TOP)).toBe(1);
		expect(count(lines, "Read the merge path · 25m")).toBe(1);
		expect(count(lines, "Objective: Stop the double render")).toBe(1);
		settled.stopAnimation();
	});

	test("the result replaces the call view in the native card", () => {
		const settled = component();
		settle(settled);
		const nodes = nativeStrings(settled);

		expect(count(nodes, PREVIEW_MARKER)).toBe(0);
		expect(count(nodes, PREVIEW_ROLE)).toBe(0);
		expect(count(nodes, PANEL_ROLE)).toBe(1);
		expect(count(nodes, CHECKLIST_ROLE)).toBe(1);
		settled.stopAnimation();
	});
});
