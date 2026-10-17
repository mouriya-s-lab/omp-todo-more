import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { type NativeChild, type NativeNode, node, stableKey } from "@oh-my-pi/pi-tui";
import type { parametersSchema } from "./protocol.ts";
import { callPreviewLines, compactTodoLabel, detailsSchema, isClosed, parseCall, progressCounts } from "./render.ts";
import { commitRecordText, type TodoMoreSnapshot, type TodoStatus, timeEstimateText } from "./state.ts";
import type { TodoMoreDetails } from "./tool.ts";

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
			note: `${timeEstimateText(item.time)}\nExplanation: ${item.explanation ?? "[explanation missing]"}${item.blocker === undefined ? "" : `\nBlocker: ${item.blocker}`}${item.commit === undefined ? "" : `\nCommit: ${commitRecordText(item.commit)}`}`,
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

/** Tern draws the pill; the plugin owns its accessible trigger and anchored rich disclosure. */
export function describeTodoHud(snapshot: TodoMoreSnapshot, expanded = false): NativeNode | null {
	let total = 0;
	let closed = 0;
	let active: string | undefined;
	let pending: string | undefined;
	for (const phase of snapshot.phases) {
		for (const item of phase.items) {
			total++;
			switch (item.status) {
				case "completed":
				case "abandoned":
					closed++;
					break;
				case "in_progress":
					active ??= item.title;
					break;
				case "pending":
					pending ??= item.title;
					break;
				case "blocked":
					break;
				default: {
					const unreachable: never = item.status;
					throw new Error(`Unexpected todo status: ${String(unreachable)}`);
				}
			}
		}
	}
	if (total === 0) return null;
	const label = active ?? pending ?? (closed === total ? "All done" : "Todos");
	return node(
		"row",
		{ role: "omp.hud.activity", aria: "Todo More progress", align: "center", gap: "sm" },
		[
			node(
				"col",
				{ role: "omp.hud.todo", aria: "Todo More pill", gap: "none" },
				[
					node(
						"card",
						{
							aria: "Todo More disclosure",
							head: `${label} ${closed}/${total}`,
							variant: "bare",
							collapsible: true,
							collapsed: !expanded,
						},
						[node("checklist", { role: "todo-more.visual", mode: "hud", phases: checklistPhases(snapshot) }, undefined, "visual")],
						"control",
					),
					...(expanded
						? [
								node(
									"col",
									{ role: "todo-more.popover", aria: "Todo More popover" },
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
							]
						: []),
				],
				"pill",
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
			target: "preview — not committed",
			meta: [`${call.commands.length} complete command${call.commands.length === 1 ? "" : "s"}`],
		},
		open: true,
		preview: "children",
		body: [
			node(
				"col",
				{ role: "todo-more.preview", gap: "sm" },
				callPreviewLines(call).map((text, index) => node("text", { text, wrap: "word" }, undefined, `line-${index}`)),
			),
		],
	};
};

export const describeTodoResult: NonNullable<ToolDefinition<typeof parametersSchema, TodoMoreDetails>["describeResult"]> = (
	result,
	options,
) => {
	const parsed = detailsSchema.safeParse(result.details);
	if (result.isError || !parsed.success) {
		const text = result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
		return {
			tool: { title: "Todo" },
			tone: "error",
			body: [node("text", { text: text || "Invalid todo-more result details", wrap: "word" })],
		};
	}
	const { closed, total } = progressCounts(parsed.data.more);
	return {
		tool: total === 0 ? { title: "Todo" } : { title: "Todo", target: `${closed}/${total}`, targetKind: "text" },
		open: true,
		preview: "none",
		body: [node("col", { role: "todo-more.panel", gap: "sm" }, resultPanel(parsed.data.more, options.expanded))],
	};
};

/** Native-shaped result card: objective alone when collapsed, closed phases folded, one row per task with estimate and blocker inline; expanding restores goal fields and explanations. */
function resultPanel(more: TodoMoreSnapshot, expanded: boolean): NativeChild[] {
	const phases = more.phases.filter((phase) => phase.items.length > 0);
	if (phases.length === 0) return [node("text", { text: "Todo list is empty.", wrap: "word" }, undefined, "empty")];
	const goal = expanded
		? node(
				"kv",
				{
					role: "todo-more.goal",
					items: [
						{ k: "Objective", v: more.goal?.objective ?? "[goal missing]" },
						{ k: "Measure", v: more.goal?.measure ?? "[goal missing]" },
						{ k: "Done when", v: more.goal?.doneWhen ?? "[goal missing]" },
					],
				},
				undefined,
				"goal",
			)
		: node("text", { text: `Objective: ${more.goal?.objective ?? "[goal missing]"}`, wrap: "word" }, undefined, "goal");
	const checklistPhases = phases.map((phase, p) => ({
		id: `p${p}`,
		title: phase.name,
		collapsed: phase.items.every(isClosed),
		items: phase.items.map((item, t) => ({
			id: `p${p}.${t}`,
			text: compactTodoLabel(item),
			status: checklistStatus(item.status),
			...(expanded
				? {
						note: `Explanation: ${item.explanation ?? "[explanation missing]"}${item.commit === undefined ? "" : `\nCommit: ${commitRecordText(item.commit)}`}`,
					}
				: {}),
		})),
	}));
	return [goal, node("checklist", { role: "todo-more.list", mode: "full", phases: checklistPhases }, undefined, "list")];
}
