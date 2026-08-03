/**
 * Artifacts — everything the director produced, sortable and filterable.
 *
 * One card per entry in the durable artifact corpus (DRV-ARTIFACTS). The corpus
 * spans rooms on purpose: a diagram produced in a room that has since stopped is
 * still listed, which is why artifacts were given their own log family instead
 * of living in the room log the way they used to.
 *
 * The corpus is bytes-free and stays that way. There is no thumbnail here and
 * there must not be one — the entry carries the produce recipe, never the
 * rendered image, so a card that wanted a preview would push a base64 render
 * back onto the event log. The card is built from kind, title, presenter and
 * status instead, matching the surface mock.
 *
 * Filtering is entirely local: the hub returns the corpus, the page narrows it.
 * The kind facets are groups spanning several `ShowArtifactKind` members, which
 * the hub's single-`kind` facet cannot express, and holding the corpus makes
 * every facet count instant and honest. All of it lives in `artifact-filters.ts`
 * so it can be tested.
 */

import type { DriveArtifactDirectoryEntry } from "@cline/drive";
import { LayersIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DriveArtifactsSource } from "../../artifacts/drive-artifacts-source";
import {
	type ArtifactKindFacetId,
	artifactKindFacetCounts,
	artifactTagFacetCounts,
	filterArtifacts,
	hasActiveArtifactFilters,
	matchesArtifactKindFacet,
	matchesArtifactQuery,
	matchesArtifactTag,
} from "./artifact-filters";
import { PageEmptyState, PageFrame, PageHeader } from "./page-layout";

/** `shown` had its moment; `planned` is still waiting for the stage. */
const STATUS_STYLES: Record<string, string> = {
	shown: "border-primary/40 text-primary",
	showing: "border-primary/40 text-primary",
	ready: "border-amber-500/50 text-amber-600 dark:text-amber-400",
	planned: "border-border text-muted-foreground",
	cancelled: "border-border text-muted-foreground line-through",
};

function FacetChip({
	active,
	count,
	label,
	onClick,
}: {
	active: boolean;
	count: number;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			aria-pressed={active}
			onClick={onClick}
			size="sm"
			type="button"
			variant={active ? "default" : "outline"}
		>
			<span className="truncate">{label}</span>
			<span className="rounded bg-background/30 px-1.5 py-0.5 text-xs">
				{count}
			</span>
		</Button>
	);
}

function ArtifactCard({ entry }: { entry: DriveArtifactDirectoryEntry }) {
	return (
		<li className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-4 py-3">
			<div className="flex min-w-0 items-center justify-between gap-2">
				<span className="truncate font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
					{entry.artifactKind}
				</span>
				<Badge
					className={cn(
						"shrink-0 text-[10px]",
						STATUS_STYLES[entry.status] ?? STATUS_STYLES.planned,
					)}
					variant="outline"
				>
					{entry.status}
				</Badge>
			</div>
			<div
				className="truncate text-sm font-semibold text-foreground"
				title={entry.title}
			>
				{entry.title}
			</div>
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
				<span className="truncate">{entry.ownerParticipantId}</span>
				<span aria-hidden="true">·</span>
				<span className="truncate">{entry.roomId}</span>
				<span aria-hidden="true">·</span>
				<span className="truncate">{entry.mediaClass}</span>
			</div>
			{entry.tags.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{entry.tags.map((tag) => (
						<span
							className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
							key={tag}
						>
							{tag}
						</span>
					))}
				</div>
			) : null}
		</li>
	);
}

export function ArtifactsView({
	artifactsSource,
	workspaceRoot,
}: {
	artifactsSource: DriveArtifactsSource;
	/**
	 * Where the durable corpus lives. The hub reports it asynchronously and
	 * refuses to read any other root's corpus, so listing waits for it rather
	 * than firing a request that is guaranteed to come back an error.
	 */
	workspaceRoot?: string;
}) {
	const [entries, setEntries] = useState<DriveArtifactDirectoryEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [kindFacet, setKindFacet] = useState<ArtifactKindFacetId | null>(null);
	const [tag, setTag] = useState<string | null>(null);
	/** Workspace the artifacts on screen were listed for. */
	const loadedRootRef = useRef<string | undefined>(undefined);
	/**
	 * Newest list request. A list issued for one workspace can still be in
	 * flight when the workspace changes, and its late reply would otherwise
	 * paint the previous project's artifacts over the current one.
	 */
	const requestSeqRef = useRef(0);

	const refresh = useCallback(async () => {
		const seq = ++requestSeqRef.current;
		const requestedRoot = workspaceRoot?.trim();
		// Artifacts belong to the workspace they were listed for. Drop them the
		// moment the workspace changes, so a slow or failing list can never leave
		// another project's artifacts on screen.
		if (loadedRootRef.current !== requestedRoot) {
			setEntries([]);
		}
		if (!requestedRoot) {
			loadedRootRef.current = undefined;
			setLoading(true);
			return;
		}
		setLoading(true);
		try {
			const listed = await artifactsSource.listArtifacts(requestedRoot);
			if (seq !== requestSeqRef.current) {
				return;
			}
			loadedRootRef.current = requestedRoot;
			setEntries(listed);
			setError(null);
		} catch (cause) {
			if (seq !== requestSeqRef.current) {
				return;
			}
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			// A superseded request must not clear the newer one's spinner.
			if (seq === requestSeqRef.current) {
				setLoading(false);
			}
		}
	}, [artifactsSource, workspaceRoot]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const filters = useMemo(
		() => ({ query, kindFacet, tag }),
		[kindFacet, query, tag],
	);
	const filtersActive = hasActiveArtifactFilters(filters);

	const queryFiltered = useMemo(
		() => entries.filter((entry) => matchesArtifactQuery(entry, query)),
		[entries, query],
	);
	/**
	 * Each facet row counts over the set the *other* row has already narrowed,
	 * so a count says how many cards that chip would leave on screen — not how
	 * many exist somewhere in the corpus.
	 */
	const kindFacets = useMemo(
		() =>
			artifactKindFacetCounts(
				queryFiltered.filter((entry) => matchesArtifactTag(entry, tag)),
			),
		[queryFiltered, tag],
	);
	const tagFacets = useMemo(
		() =>
			artifactTagFacetCounts(
				queryFiltered.filter((entry) =>
					matchesArtifactKindFacet(entry, kindFacet),
				),
			),
		[kindFacet, queryFiltered],
	);
	const visible = useMemo(
		() => filterArtifacts(entries, filters),
		[entries, filters],
	);

	const clearFilters = () => {
		setQuery("");
		setKindFacet(null);
		setTag(null);
	};

	const waitingForWorkspace = !workspaceRoot?.trim();

	return (
		<PageFrame>
			<PageHeader
				description="Everything the director produced — plans, diagrams, walkthroughs, captures — kept across every room. Filter by kind or by the tags a producer attached."
				icon={LayersIcon}
				meta={
					entries.length > 0 ? (
						<Badge className="text-[10px]" variant="outline">
							{entries.length}
						</Badge>
					) : null
				}
				title="Artifacts"
				actions={
					<Button
						disabled={loading || waitingForWorkspace}
						onClick={() => {
							void refresh();
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCwIcon
							className={cn("size-3.5", loading && "animate-spin")}
						/>
						Refresh
					</Button>
				}
			/>

			{error ? (
				<PageEmptyState className="mb-4 border-destructive/40 text-destructive">
					Could not load artifacts: {error}
				</PageEmptyState>
			) : null}

			{entries.length > 0 ? (
				<div className="mb-5 grid gap-3">
					<div className="relative block">
						<SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							aria-label="Search artifacts"
							className="h-10 pl-8"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search artifacts"
							value={query}
						/>
					</div>

					{kindFacets.length > 0 ? (
						<fieldset className="flex min-w-0 gap-2 overflow-x-auto pb-1">
							<legend className="sr-only">Filter by kind</legend>
							{kindFacets.map((facet) => (
								<FacetChip
									active={kindFacet === facet.id}
									count={facet.count}
									key={facet.id}
									label={facet.label}
									onClick={() =>
										setKindFacet((current) =>
											current === facet.id ? null : facet.id,
										)
									}
								/>
							))}
						</fieldset>
					) : null}

					{tagFacets.length > 0 ? (
						<fieldset className="flex min-w-0 gap-2 overflow-x-auto pb-1">
							<legend className="sr-only">Filter by tag</legend>
							{tagFacets.map((facet) => (
								<FacetChip
									active={tag === facet.tag}
									count={facet.count}
									key={facet.tag}
									label={facet.tag}
									onClick={() =>
										setTag((current) =>
											current === facet.tag ? null : facet.tag,
										)
									}
								/>
							))}
						</fieldset>
					) : null}

					<div className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
						<span className="font-medium text-foreground">
							{visible.length}
						</span>
						<span>{visible.length === 1 ? "result" : "results"}</span>
						{filtersActive ? (
							<Button
								onClick={clearFilters}
								size="sm"
								type="button"
								variant="ghost"
							>
								Clear filters
							</Button>
						) : null}
					</div>
				</div>
			) : null}

			{waitingForWorkspace ? (
				<PageEmptyState>
					Waiting for the hub to report a workspace. The artifact corpus belongs
					to a workspace, so there is nothing to list until one is bound.
				</PageEmptyState>
			) : null}

			{!waitingForWorkspace && entries.length === 0 && !loading && !error ? (
				<PageEmptyState>
					No artifacts yet. Present a plan, diagram or walkthrough in a Drive
					call and it will show up here — and stay here after the room stops.
				</PageEmptyState>
			) : null}

			{entries.length > 0 && visible.length === 0 ? (
				<PageEmptyState>No artifacts match these filters.</PageEmptyState>
			) : null}

			{visible.length > 0 ? (
				// 20rem keeps kind + title + meta line readable; below that the grid
				// drops to a single column rather than truncating everything.
				<ul className="grid list-none gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
					{visible.map((entry) => (
						<ArtifactCard
							entry={entry}
							key={`${entry.roomId} ${entry.showItemId}`}
						/>
					))}
				</ul>
			) : null}
		</PageFrame>
	);
}
