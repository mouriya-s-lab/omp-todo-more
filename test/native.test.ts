import { describe, expect, test } from "bun:test";
import type { NativeChild, NativeNode } from "@oh-my-pi/pi-tui";
import { describeSnapshot, describeTodoHud, describeTodoResult } from "../src/native.ts";
import type { TodoMoreSnapshot, TodoStatus } from "../src/state.ts";
import type { TodoMoreDetails } from "../src/tool.ts";

const snapshot: TodoMoreSnapshot = {
	goal: {
		objective: "Ship the native todo replacement",
		measure: "Every task and explanation is visible",
		doneWhen: "The replacement preserves all rich todo fields",
	},
	phases: [
		{
			name: "Delivery",
			items: [
				{
					title: "Plan the replacement",
					explanation: "Keep the host projection",
					status: "pending",
					time: { kind: "missing" },
				},
				{
					title: "Implement the card",
					explanation: "Use the native checklist",
					status: "in_progress",
					time: { kind: "estimated", budgetId: "implement-budget", minutes: 25, elapsedMs: 60_000, runningSince: 120_000 },
				},
			],
		},
		{
			name: "Verification",
			items: [
				{
					title: "Inspect saved fields",
					explanation: "Read the historical result",
					status: "completed",
					time: { kind: "estimated", budgetId: "inspect-budget", minutes: 10, elapsedMs: 180_000, runningSince: null },
				},
				{
					title: "Old approach",
					explanation: "No longer needed",
					status: "abandoned",
					time: { kind: "missing" },
				},
				{
					title: "Check runtime",
					explanation: "Exercise the real native consumer",
					status: "blocked",
					blocker: "Waiting for the terminal",
					time: { kind: "estimated", budgetId: "runtime-budget", minutes: 12, elapsedMs: 120_000, runningSince: null },
				},
			],
		},
	],
};

function nativeNodes(children: readonly NativeChild[]): NativeNode[] {
	const nodes: NativeNode[] = [];
	for (const child of children) {
		if (!("k" in child)) throw new Error("Expected native descriptors, not an ANSI component");
		nodes.push(child, ...nativeNodes(child.c ?? []));
	}
	return nodes;
}

function only<T>(values: readonly T[]): T {
	expect(values).toHaveLength(1);
	const value = values[0];
	if (value === undefined) throw new Error("Expected one native descriptor");
	return value;
}

function checklist(children: readonly NativeChild[]) {
	const list = only(
		nativeNodes(children)
			.filter((entry) => entry.k === "checklist")
			.filter((entry) => entry.p?.mode === "full"),
	);
	if (list.p === undefined) throw new Error("Expected checklist properties");
	return list.p;
}

function goalItems(children: readonly NativeChild[]) {
	const goal = only(nativeNodes(children).filter((entry) => entry.k === "kv"));
	if (goal.p === undefined) throw new Error("Expected goal properties");
	return goal.p.items;
}

function resultFor(more: TodoMoreSnapshot): Parameters<typeof describeTodoResult>[0] & { details: TodoMoreDetails } {
	return {
		content: [{ type: "text", text: "This summary is not the native snapshot." }],
		details: {
			todoMore: true,
			storage: "session",
			phases: more.phases.map((phase) => ({
				name: phase.name,
				tasks: phase.items.map((item) => ({ content: item.title, status: item.status })),
			})),
			more,
		},
	};
}

function resultBody(result: Parameters<typeof describeTodoResult>[0]): readonly NativeChild[] {
	const view = describeTodoResult(result, { expanded: false, isPartial: false });
	if (view?.body === undefined) throw new Error("Expected a native result body");
	return view.body;
}

describe("native todo presentation", () => {
	test("expanded disclosure preserves all goal fields, all five statuses, estimate notes, and both blocked explanation and reason", () => {
		const hud = describeTodoHud(snapshot, true);
		if (hud === null) throw new Error("Expected a native HUD");
		const body = [hud];

		expect(goalItems(body)).toEqual([
			{ k: "Objective", v: "Ship the native todo replacement" },
			{ k: "Measure", v: "Every task and explanation is visible" },
			{ k: "Done when", v: "The replacement preserves all rich todo fields" },
		]);
		expect(checklist(body)).toMatchObject({
			phases: [
				{
					title: "Delivery",
					items: [
						{
							text: "Plan the replacement",
							status: "pending",
							note: "(no time estimate yet: add one with op estimate)\nExplanation: Keep the host projection",
						},
						{
							text: "Implement the card",
							status: "active",
							note: "Estimate: 25 min\nExplanation: Use the native checklist",
						},
					],
				},
				{
					title: "Verification",
					items: [
						{
							text: "Inspect saved fields",
							status: "done",
							note: "Estimate: 10 min\nExplanation: Read the historical result",
						},
						{
							text: "Old approach",
							status: "dropped",
							note: "(no time estimate yet: add one with op estimate)\nExplanation: No longer needed",
						},
						{
							text: "Check runtime",
							status: "blocked",
							note: "Estimate: 12 min\nExplanation: Exercise the real native consumer\nBlocker: Waiting for the terminal",
						},
					],
				},
			],
		});
	});

	test("keeps missing goal, estimate, and explanation visible without inventing goal tasks", () => {
		const body = describeSnapshot({
			goal: null,
			phases: [
				{
					name: "Imported",
					items: [{ title: "Imported task", status: "pending", explanation: null, time: { kind: "missing" } }],
				},
			],
		});

		expect(goalItems(body)).toEqual([
			{ k: "Objective", v: "[goal missing]" },
			{ k: "Measure", v: "[goal missing]" },
			{ k: "Done when", v: "[goal missing]" },
		]);
		expect(checklist(body).phases.flatMap((phase) => phase.items.map(({ text, status, note }) => ({ text, status, note })))).toEqual([
			{
				text: "Imported task",
				status: "pending",
				note: "(no time estimate yet: add one with op estimate)\nExplanation: [explanation missing]",
			},
		]);
	});
});

describe("native todo HUD", () => {
	test("empty lists have no HUD, including a phase with no tasks", () => {
		expect(describeTodoHud({ goal: null, phases: [] })).toBeNull();
		expect(describeTodoHud({ goal: snapshot.goal, phases: [{ name: "Empty phase", items: [] }] })).toBeNull();
	});

	test("rich goal, full checklist, and edit content appear only when expanded", () => {
		for (const expanded of [false, true]) {
			const hud = describeTodoHud(snapshot, expanded);
			if (hud === null) throw new Error("Expected a native HUD");
			const nodes = nativeNodes([hud]);

			expect(nodes.filter((entry) => entry.k === "kv")).toHaveLength(expanded ? 1 : 0);
			expect(nodes.filter((entry) => entry.k === "checklist" && entry.p?.mode === "full")).toHaveLength(expanded ? 1 : 0);
			const editControls = nodes.filter((entry) => entry.k === "text" && entry.p?.text === "Edit goal / explanations");
			expect(editControls).toHaveLength(expanded ? 1 : 0);
		}
	});

	test.each([
		{
			name: "first in_progress takes precedence over pending and later in_progress",
			statuses: ["pending", "in_progress", "in_progress", "completed", "abandoned", "blocked"],
			label: "Task 2 2/6",
		},
		{
			name: "first pending takes precedence when no task is in_progress",
			statuses: ["blocked", "pending", "pending", "completed"],
			label: "Task 2 1/4",
		},
		{
			name: "completed and abandoned tasks are both closed",
			statuses: ["abandoned", "completed"],
			label: "All done 2/2",
		},
		{
			name: "blocked tasks keep the list open without becoming the primary title",
			statuses: ["blocked", "completed", "abandoned"],
			label: "Todos 2/3",
		},
	] satisfies { name: string; statuses: TodoStatus[]; label: string }[])("$name", ({ statuses, label }) => {
		const hud = describeTodoHud(
			{
				goal: null,
				phases: [
					{
						name: "Progress",
						items: statuses.map((status, index) => ({
							title: `Task ${index + 1}`,
							status,
							explanation: null,
							time: { kind: "missing" },
						})),
					},
				],
			},
			false,
		);
		if (hud === null) throw new Error("Expected a native HUD");
		const headings = nativeNodes([hud]).flatMap((entry) =>
			entry.p !== undefined && "head" in entry.p && typeof entry.p.head === "string" ? [entry.p.head] : [],
		);

		expect(headings).toContain(label);
	});
});

describe("native historical todo results", () => {
	test("renders each result's own details.more and timing after a different, newer snapshot was rendered", () => {
		const historical = resultFor(snapshot);
		const newer = resultFor({
			goal: { objective: "A new objective", measure: "A new measure", doneWhen: "A new completion boundary" },
			phases: [
				{
					name: "New phase",
					items: [{ title: "A new task", explanation: "Only in the new result", status: "completed", time: { kind: "missing" } }],
				},
				{
					name: "Verification",
					items: [
						{
							title: "Check runtime",
							explanation: "A newer runtime check",
							status: "completed",
							time: { kind: "estimated", budgetId: "runtime-budget", minutes: 45, elapsedMs: 300_000, runningSince: null },
						},
					],
				},
			],
		});
		// A conflicting host projection must not replace the result's rich display copy.
		historical.details = { ...historical.details, phases: newer.details.phases };
		const newerBody = resultBody(newer);
		const historicalBody = resultBody(historical);

		expect(goalItems(newerBody)).toEqual([
			{ k: "Objective", v: "A new objective" },
			{ k: "Measure", v: "A new measure" },
			{ k: "Done when", v: "A new completion boundary" },
		]);
		expect(checklist(newerBody).phases.flatMap((phase) => phase.items.map((item) => item.text))).toEqual(["A new task", "Check runtime"]);
		expect(
			only(
				checklist(newerBody)
					.phases.flatMap((phase) => phase.items)
					.filter((item) => item.text === "Check runtime"),
			).note,
		).toBe("Estimate: 45 min\nExplanation: A newer runtime check");
		expect(goalItems(historicalBody)).toEqual([
			{ k: "Objective", v: "Ship the native todo replacement" },
			{ k: "Measure", v: "Every task and explanation is visible" },
			{ k: "Done when", v: "The replacement preserves all rich todo fields" },
		]);
		expect(checklist(historicalBody).phases.flatMap((phase) => phase.items.map((item) => item.text))).toEqual([
			"Plan the replacement",
			"Implement the card",
			"Inspect saved fields",
			"Old approach",
			"Check runtime",
		]);
		expect(
			only(
				checklist(historicalBody)
					.phases.flatMap((phase) => phase.items)
					.filter((item) => item.text === "Check runtime"),
			).note,
		).toBe("Estimate: 12 min\nExplanation: Exercise the real native consumer\nBlocker: Waiting for the terminal");
	});
});
