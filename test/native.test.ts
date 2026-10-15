import { describe, expect, test } from "bun:test";
import type { NativeChild, NativeNode } from "@oh-my-pi/pi-tui";
import { describeSnapshot, describeTodoHud, describeTodoResult } from "../src/native.ts";
import type { TodoMoreSnapshot } from "../src/state.ts";
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
	const list = only(nativeNodes(children).filter((entry) => entry.k === "checklist"));
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
	test("preserves all goal fields, all five statuses, estimate notes, and both blocked explanation and reason", () => {
		const body = describeSnapshot(snapshot);

		expect(goalItems(body)).toEqual([
			{ k: "Objective", v: "Ship the native todo replacement" },
			{ k: "Measure", v: "Every task and explanation is visible" },
			{ k: "Done when", v: "The replacement preserves all rich todo fields" },
		]);
		expect(checklist(body)).toMatchObject({
			mode: "full",
			phases: [
				{
					id: "Delivery",
					title: "Delivery",
					collapsed: false,
					items: [
						{
							id: "Plan the replacement",
							text: "Plan the replacement",
							status: "pending",
							note: "(no time estimate yet: add one with op estimate)\nExplanation: Keep the host projection",
						},
						{
							id: "Implement the card",
							text: "Implement the card",
							status: "active",
							note: "Estimate: 25 min\nExplanation: Use the native checklist",
						},
					],
				},
				{
					id: "Verification",
					title: "Verification",
					collapsed: false,
					items: [
						{
							id: "Inspect saved fields",
							text: "Inspect saved fields",
							status: "done",
							note: "Estimate: 10 min\nExplanation: Read the historical result",
						},
						{
							id: "Old approach",
							text: "Old approach",
							status: "dropped",
							note: "(no time estimate yet: add one with op estimate)\nExplanation: No longer needed",
						},
						{
							id: "Check runtime",
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
		expect(checklist(body).phases.flatMap((phase) => phase.items)).toEqual([
			{
				id: "Imported task",
				text: "Imported task",
				status: "pending",
				note: "(no time estimate yet: add one with op estimate)\nExplanation: [explanation missing]",
			},
		]);
	});

	test("deletion and phase/task reorder preserve surviving checklist and editor identities", () => {
		const before = describeSnapshot(snapshot, true);
		const reordered: TodoMoreSnapshot = {
			...snapshot,
			phases: [...snapshot.phases].reverse().map((phase) => ({
				...phase,
				items: [...phase.items].reverse().filter((item) => item.title !== "Plan the replacement"),
			})),
		};
		const after = describeSnapshot(reordered, true);
		const originalPhases = checklist(before).phases;
		const reorderedPhases = checklist(after).phases;

		expect(reorderedPhases.map((phase) => phase.id)).toEqual(["Verification", "Delivery"]);
		expect(reorderedPhases.flatMap((phase) => phase.items.map((item) => item.id))).toEqual([
			"Check runtime",
			"Old approach",
			"Inspect saved fields",
			"Implement the card",
		]);
		for (const phase of reorderedPhases) {
			const original = only(originalPhases.filter((candidate) => candidate.title === phase.title));
			expect(phase.id).toBe(original.id);
			for (const item of phase.items) {
				expect(item).toEqual(only(original.items.filter((candidate) => candidate.text === item.text)));
			}
		}

		const originalEditors = nativeNodes(before).filter((entry) => entry.k === "row" && entry.p?.role === "omp.btn");
		const survivingEditors = nativeNodes(after).filter((entry) => entry.k === "row" && entry.p?.role === "omp.btn");
		expect(originalEditors).toHaveLength(5);
		expect(survivingEditors).toHaveLength(4);
		for (const editor of survivingEditors) {
			const original = only(originalEditors.filter((candidate) => candidate.p?.title === editor.p?.title));
			expect(editor.key).toBeDefined();
			expect(editor.key).toBe(original.key);
			expect(editor.p?.actions).toEqual(original.p?.actions);
		}
		expect(new Set(survivingEditors.map((editor) => editor.key)).size).toBe(4);
		expect(goalItems(after)).toEqual(goalItems(before));
	});
});

describe("native todo HUD", () => {
	test("empty lists have no HUD, including a phase with no tasks", () => {
		expect(describeTodoHud({ goal: null, phases: [] })).toBeNull();
		expect(describeTodoHud({ goal: snapshot.goal, phases: [{ name: "Empty phase", items: [] }] })).toBeNull();
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
			checklist(newerBody)
				.phases.flatMap((phase) => phase.items)
				.find((item) => item.id === "Check runtime")?.note,
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
			checklist(historicalBody)
				.phases.flatMap((phase) => phase.items)
				.find((item) => item.id === "Check runtime")?.note,
		).toBe("Estimate: 12 min\nExplanation: Exercise the real native consumer\nBlocker: Waiting for the terminal");
	});
});
