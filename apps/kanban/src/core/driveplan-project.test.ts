import { describe, expect, it } from "vitest";
import { isDriveplanManagedCard } from "./api-contract";
import { projectDriveRunToBoard } from "./driveplan-project";
import { addTaskToColumn, updateTask } from "./task-board-mutations";
import type { RuntimeBoardData } from "./api-contract";

function emptyBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

describe("projectDriveRunToBoard", () => {
	it("creates managed cards with autoReviewEnabled false", () => {
		const result = projectDriveRunToBoard(
			emptyBoard(),
			{
				id: "run_1",
				driveTaskId: "task_1",
				spec: {
					workItems: [
						{
							id: "wi_a",
							objective: "Patch retry",
							isolation: "worktree",
							writeClaims: ["src/a.ts"],
							status: "PENDING",
						},
						{
							id: "wi_b",
							objective: "Run tests",
							isolation: "shared",
							writeClaims: [],
							status: "RUNNING",
						},
					],
				},
			},
			"main",
			() => "uuid-1",
			100,
		);

		expect(result.created).toHaveLength(2);
		const backlog = result.board.columns.find((c) => c.id === "backlog");
		const inProgress = result.board.columns.find((c) => c.id === "in_progress");
		expect(backlog?.cards).toHaveLength(1);
		expect(inProgress?.cards).toHaveLength(1);
		const managed = backlog!.cards[0]!;
		expect(isDriveplanManagedCard(managed)).toBe(true);
		expect(managed.autoReviewEnabled).toBe(false);
		expect(managed.externalRef?.workItemId).toBe("wi_a");
	});

	it("is idempotent for the same externalRef", () => {
		const first = projectDriveRunToBoard(
			emptyBoard(),
			{
				id: "run_1",
				driveTaskId: "task_1",
				spec: {
					workItems: [
						{
							id: "wi_a",
							objective: "Patch",
							isolation: "worktree",
							writeClaims: [],
							status: "PENDING",
						},
					],
				},
			},
			"main",
			() => "uuid-1",
			100,
		);
		const second = projectDriveRunToBoard(
			first.board,
			{
				id: "run_1",
				driveTaskId: "task_1",
				spec: {
					workItems: [
						{
							id: "wi_a",
							objective: "Patch",
							isolation: "worktree",
							writeClaims: [],
							status: "PENDING",
						},
					],
				},
			},
			"main",
			() => "uuid-2",
			200,
		);
		expect(second.created).toHaveLength(0);
		expect(second.board.columns.find((c) => c.id === "backlog")?.cards).toHaveLength(1);
	});
});

describe("DrivePlan cards resist re-enabling automation Kanban does not own", () => {
	// DrivePlan's run spec gates admission and review behind waves and
	// receipts Kanban cannot see. Every path that could flip one of those on
	// for a managed card is a way to run work ahead of a gate, so each gets a
	// test rather than relying on the schema re-forcing it on the next parse.
	// The generated id is not the uuid we hand in: createUniqueTaskId strips
	// dashes and truncates to five characters, so "task-managed" becomes
	// "taskm". Return the real id rather than assuming one.
	function boardWithManagedCard(): { board: RuntimeBoardData; taskId: string } {
		const empty: RuntimeBoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};
		const created = addTaskToColumn(
			empty,
			"backlog",
			{
				prompt: "managed work item",
				baseRef: "main",
				autoReviewEnabled: true,
				externalRef: {
					system: "driveplan",
					driveTaskId: "wi-1",
					driveRunId: "run-1",
				},
			},
			() => "task-managed",
			1,
		);
		return { board: created.board, taskId: created.task.id };
	}

	it("creates a managed card with auto-review off even when asked for on", () => {
		const { board } = boardWithManagedCard();
		const card = board.columns[0]?.cards[0];

		expect(card && isDriveplanManagedCard(card)).toBe(true);
		expect(card?.autoReviewEnabled).toBe(false);
	});

	it("keeps auto-review off when a managed card is edited", () => {
		// The regression this pins: `updateTask` wrote `input.autoReviewEnabled`
		// straight through, so an edit persisted `true` on a managed card. It
		// looked fine after any reload because the schema re-forces it on parse,
		// which is precisely what made the window between them easy to miss.
		const { board, taskId } = boardWithManagedCard();

		const updated = updateTask(
			board,
			taskId,
			{
				prompt: "managed work item",
				baseRef: "main",
				autoReviewEnabled: true,
			},
			2,
		);

		expect(updated.updated).toBe(true);
		expect(updated.task?.autoReviewEnabled).toBe(false);
	});

	it("still honours auto-review on an unmanaged card", () => {
		// The guard must be narrow: ordinary cards keep their automation.
		const empty: RuntimeBoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};
		const created = addTaskToColumn(
			empty,
			"backlog",
			{ prompt: "ordinary", baseRef: "main", autoReviewEnabled: false },
			() => "task-plain",
			1,
		);

		const updated = updateTask(
			created.board,
			created.task.id,
			{ prompt: "ordinary", baseRef: "main", autoReviewEnabled: true },
			2,
		);

		expect(updated.task?.autoReviewEnabled).toBe(true);
	});
});
