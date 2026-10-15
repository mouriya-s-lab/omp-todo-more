import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { type NativeChild, type NativeNode, node, stableKey } from "@oh-my-pi/pi-tui";
import { detailsSchema, parseCall } from "./render.ts";
import { type TodoMoreSnapshot, type TodoStatus, timeEstimateText } from "./state.ts";
import type { parametersSchema, TodoMoreDetails } from "./tool.ts";

function checklistStatus(status: TodoStatus): "pending" | "active" | "done" | "dropped" | "blocked" {
	switch (status) {
		case "pending":
			return "pending";
		case "in_progress":
			return "active";
		case "completed":
			return "done";
		case "abandoned":
			return "dropped";
		case "blocked":
			return "blocked";
		default: {
			const unreachable: never = status;
			throw new Error(`Unexpected todo status: ${String(unreachable)}`);
		}
	}
}

function checklistPhases(snapshot: TodoMoreSnapshot) {
	return snapshot.phases.map((phase) => ({
		id: phase.name,
		title: phase.name,
		collapsed: false,
		items: phase.items.map((item) => ({
			id: item.title,
			text: item.title,
			status: checklistStatus(item.status),
			note: `${timeEstimateText(item.time)}\nExplanation: ${item.explanation ?? "[explanation missing]"}${item.blocker === undefined ? "" : `\nBlocker: ${item.blocker}`}`,
		})),
	}));
}

/** A presentation of a snapshot only; callers must read the branch before editing. */
export function describeSnapshot(snapshot: TodoMoreSnapshot, editable = false, selectedTitle?: string): NativeChild[] {
	const body: NativeChild[] = [
		node(
			"kv",
			{
				role: "todo-more.goal",
				items: [
					{ k: "Objective", v: snapshot.goal?.objective ?? "[goal missing]" },
					{ k: "Measure", v: snapshot.goal?.measure ?? "[goal missing]" },
					{ k: "Done when", v: snapshot.goal?.doneWhen ?? "[goal missing]" },
				],
			},
			undefined,
			"goal",
		),
		node(
			"checklist",
			{
				role: "todo-more.list",
				mode: "full",
				phases: checklistPhases(snapshot),
			},
			undefined,
			"list",
		),
	];
	if (snapshot.phases.every((phase) => phase.items.length === 0)) body.push(node("text", { text: "Todo list is empty." }));
	if (editable) {
		for (const phase of snapshot.phases) {
			for (const item of phase.items) {
				body.push(
					node(
						"row",
						{
							role: "omp.btn",
							actions: { click: `todo-more.explain:${item.title}` },
							title: `Edit explanation: ${item.title}`,
							tone: selectedTitle === item.title ? "accent" : undefined,
						},
						[node("text", { text: `Edit explanation: ${item.title}` })],
						stableKey(item.title),
					),
				);
			}
		}
	}
	return body;
}

/** Tern owns the native pill, intrinsic size, palette and local disclosure state. */
export function describeTodoHud(snapshot: TodoMoreSnapshot): NativeNode | null {
	if (snapshot.phases.every((phase) => phase.items.length === 0)) return null;
	return node(
		"row",
		{ role: "omp.hud.activity", aria: "Todo More progress", align: "center", gap: "sm" },
		[
			node("checklist", { role: "omp.hud.todo", mode: "hud", phases: checklistPhases(snapshot) }, undefined, "trigger"),
			node(
				"col",
				{ role: "omp.hud.todo", aria: "Todo More popover" },
				[
					node(
						"col",
						{ role: "todo-more.details", gap: "sm" },
						[
							...describeSnapshot(snapshot),
							node(
								"row",
								{ role: "omp.btn", actions: { click: "todo-more.open" } },
								[node("text", { text: "Edit goal / explanations" })],
								"edit",
							),
						],
						"details",
					),
				],
				"popover",
			),
		],
		"todo-more.hud",
	);
}

export const describeTodoCall: NonNullable<ToolDefinition<typeof parametersSchema, TodoMoreDetails>["describeCall"]> = (args) => {
	const call = parseCall(args);
	return {
		tool: {
			title: "Todo More",
			target: [call.op ?? "update", call.task ?? call.phase].filter(Boolean).join(" "),
			meta: call.count > 0 ? [`${call.count} items`] : undefined,
		},
	};
};

export const describeTodoResult: NonNullable<ToolDefinition<typeof parametersSchema, TodoMoreDetails>["describeResult"]> = (result) => {
	const parsed = detailsSchema.safeParse(result.details);
	if (result.isError || !parsed.success) {
		const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
		return { tone: "error", body: [node("text", { text: text || "Invalid todo-more result details", wrap: "word" })] };
	}
	return {
		open: true,
		preview: "children",
		body: [node("col", { role: "todo-more.panel", gap: "sm" }, describeSnapshot(parsed.data.more))],
	};
};
