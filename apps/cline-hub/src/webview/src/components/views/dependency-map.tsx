/**
 * Status Hub · Dependency map — the spatial lens over `buildDependencyMap`.
 *
 * A layered graph in a pan/zoom viewport, replacing the two-column card grid
 * that could show prerequisite order but never topology. Composition and the
 * fit ladder come from
 * `docs/drivecode/plans/cline-drivemode/initiatives/status-dependency-graph/UX.md`;
 * positions and the camera come wholesale from `dependency-graph-layout.ts`
 * (pure, tested) so "Fit frames every task" stays one guarantee rather than
 * two implementations that can disagree.
 *
 * Nodes stay real `<button>` elements under a CSS-transform camera instead of
 * paint on a canvas. That is what keeps the card grid's accessibility
 * contracts intact — roving focus, a `role="alert"` integrity banner, a polite
 * live region for selection — and it is why this is hand-rolled rather than
 * handed to the flow library the repo already installs: that library owns its
 * pane's key handling, and the only things it uniquely adds here (node
 * dragging, user-drawn edges) are anti-goals for a read-only projection.
 */

import type { TeamTask } from "@cline/shared";
import { MaximizeIcon, MinusIcon, PlusIcon } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import {
	type Camera,
	type GraphOrientation,
	layoutDependencyGraph,
	levelOfDetail,
	type NodeBox,
	panCamera,
	toScreenRect,
	type ViewportSize,
	ZOOM_STEP,
	zoomCameraAt,
} from "./dependency-graph-layout";
import {
	buildDependencyMap,
	type DependencyNode,
} from "./dependency-map-model";
import {
	panIntoView,
	resolveDependencyNavAction,
	rovingAnchor,
} from "./dependency-map-nav";

type Team = { teamId: string; teamName: string; tasks: TeamTask[] };

/** Wheel notches are finer than the button step so trackpads stay usable. */
const WHEEL_ZOOM_STEP = 1.08;
/** Pointer travel past which a viewport press is a pan, not a background click. */
const DRAG_SLOP_PX = 4;

const STATUS_TEXT: Record<TeamTask["status"], string> = {
	pending: "text-muted-foreground",
	in_progress: "text-primary",
	blocked: "text-amber-600 dark:text-amber-400",
	completed: "text-emerald-600 dark:text-emerald-400",
};

const CONTROL_CLASS =
	"rounded-md border px-2 py-1 text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		if (
			typeof window === "undefined" ||
			typeof window.matchMedia !== "function"
		)
			return;
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		setReduced(query.matches);
		const onChange = () => setReduced(query.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);
	return reduced;
}

/**
 * Live viewport box, so the layout targets the rectangle it will actually
 * fill. Takes the element rather than a ref: the graph mounts only after the
 * loading and empty states clear, and a ref object's identity never changes,
 * so an effect keyed on it would observe nothing and leave the layout at 0×0.
 */
function useMeasuredSize(element: HTMLElement | null): ViewportSize {
	const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
	useLayoutEffect(() => {
		if (!element) return;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			setSize((current) =>
				current.width === rect.width && current.height === rect.height
					? current
					: { width: rect.width, height: rect.height },
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return size;
}

const centreOf = (box: NodeBox) => ({
	x: box.x + box.width / 2,
	y: box.y + box.height / 2,
});

/**
 * Prerequisite → dependent, bowing along the layout axis so the strands of a
 * fan-in stay tellable apart.
 */
function edgePath(
	from: NodeBox,
	to: NodeBox,
	orientation: GraphOrientation,
): string {
	if (orientation === "td") {
		const x1 = centreOf(from).x;
		const y1 = from.y + from.height;
		const x2 = centreOf(to).x;
		const y2 = to.y;
		const bow = Math.max(28, (y2 - y1) * 0.45);
		return `M ${x1} ${y1} C ${x1} ${y1 + bow}, ${x2} ${y2 - bow}, ${x2} ${y2}`;
	}
	const x1 = from.x + from.width;
	const y1 = centreOf(from).y;
	const x2 = to.x;
	const y2 = centreOf(to).y;
	const bow = Math.max(40, (x2 - x1) * 0.45);
	return `M ${x1} ${y1} C ${x1 + bow} ${y1}, ${x2 - bow} ${y2}, ${x2} ${y2}`;
}

/**
 * Node keys embed raw task ids, so the joiner has to be a character neither
 * can hold. NUL is the only one guaranteed of that.
 */
const edgeId = (from: string, to: string) => `${from}\u0000${to}`;

const statusLabel = (node: DependencyNode) => node.status.replace("_", " ");

function stateNote(node: DependencyNode): string {
	if (node.inCycle) return "in a cycle";
	if (node.isReady) return "ready";
	if (node.isWaiting) return "waiting on prerequisites";
	return `layer ${node.layer}`;
}

export function DependencyMap({
	teams,
	loading,
}: {
	teams: Team[];
	loading: boolean;
}) {
	const graph = useMemo(() => buildDependencyMap(teams), [teams]);
	const [selected, setSelected] = useState<string | null>(null);
	const [camera, setCamera] = useState<Camera | null>(null);
	const [animate, setAnimate] = useState(false);
	const [viewportEl, setViewportEl] = useState<HTMLElement | null>(null);
	const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
	const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
	const viewport = useMeasuredSize(viewportEl);
	const reducedMotion = useReducedMotion();

	const keys = useMemo(() => graph.nodes.map((node) => node.key), [graph]);
	const byKey = useMemo(
		() => new Map(graph.nodes.map((node) => [node.key, node])),
		[graph],
	);
	const layout = useMemo(
		() =>
			layoutDependencyGraph(
				graph.nodes.map((node) => ({
					key: node.key,
					title: node.title,
					layer: node.layer,
				})),
				viewport,
			),
		[graph, viewport],
	);
	const boxes = useMemo(
		() => new Map(layout.positions.map((box) => [box.key, box])),
		[layout],
	);

	/**
	 * Tier 0 of the fit ladder. `null` means "no camera of the user's own", so
	 * the fitted camera shows through — on first paint, and again whenever the
	 * layout underneath changes (new snapshot, resized viewport), because the
	 * offsets of a hand-panned camera stop meaning anything at that point.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the layout identity is the trigger, not a value the body reads.
	useEffect(() => {
		setCamera(null);
	}, [layout]);
	const activeCamera = camera ?? layout.camera;
	const lod = levelOfDetail(activeCamera.scale);

	const fit = useCallback(() => {
		setAnimate(true);
		setCamera(null);
	}, []);

	const zoomBy = useCallback(
		(factor: number, focus?: { x: number; y: number }) => {
			const at = focus ?? { x: viewport.width / 2, y: viewport.height / 2 };
			setAnimate(!focus);
			setCamera((current) =>
				zoomCameraAt(current ?? layout.camera, at, factor),
			);
		},
		[layout, viewport.height, viewport.width],
	);

	/**
	 * React registers `wheel` passively at the root, so `preventDefault` from an
	 * `onWheel` prop is ignored and the page scrolls out from under the zoom.
	 * The listener has to be native and explicitly non-passive.
	 */
	useEffect(() => {
		if (!viewportEl) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = viewportEl.getBoundingClientRect();
			zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			});
		};
		viewportEl.addEventListener("wheel", onWheel, { passive: false });
		return () => viewportEl.removeEventListener("wheel", onWheel);
	}, [viewportEl, zoomBy]);

	/**
	 * Focus never scrolls. The viewport clips, so letting the browser scroll a
	 * node into view would slide the content out from under the camera and
	 * break the mapping `toScreenRect` assumes. The camera moves instead, which
	 * is also what keeps arrow-key selection visible once the user has zoomed
	 * in past the fit.
	 */
	const revealNode = useCallback(
		(key: string) => {
			nodeRefs.current.get(key)?.focus({ preventScroll: true });
			const box = boxes.get(key);
			if (!box || viewport.width <= 0) return;
			setAnimate(true);
			setCamera((current) => {
				const base = current ?? layout.camera;
				const { dx, dy } = panIntoView(toScreenRect(box, base), viewport);
				return dx === 0 && dy === 0 ? current : panCamera(base, dx, dy);
			});
		},
		[boxes, layout, viewport],
	);

	const selectNode = useCallback(
		(key: string) => {
			setSelected(key);
			revealNode(key);
		},
		[revealNode],
	);

	if (loading)
		return (
			<p className="text-sm text-muted-foreground" role="status">
				Loading dependency map…
			</p>
		);
	if (!graph.nodes.length)
		return (
			<div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
				No active team tasks are available. Dependency maps appear when a team
				session is active.
			</div>
		);

	const selectedNode = selected ? byKey.get(selected) : undefined;
	const anchor = rovingAnchor(keys, selected);
	const readyCount = graph.nodes.filter((node) => node.isReady).length;
	const incident = selectedNode
		? new Set([
				...selectedNode.dependsOnKeys.map((from) =>
					edgeId(from, selectedNode.key),
				),
				...selectedNode.dependentKeys.map((to) => edgeId(selectedNode.key, to)),
			])
		: null;
	const titleOf = (key: string) => byKey.get(key)?.title ?? key;
	const displayName = (node: DependencyNode) =>
		node.displayId ? `${node.displayId} · ${node.title}` : node.title;

	return (
		<section aria-labelledby="dependency-map-heading" className="space-y-3">
			<div>
				<h2 className="text-base font-semibold" id="dependency-map-heading">
					Dependency map
				</h2>
				<p className="text-xs text-muted-foreground">
					{graph.nodes.length} tasks; {graph.counts.blocked} blocked;{" "}
					{readyCount} ready. Drag to pan, wheel to zoom, Fit reframes every
					task. Use Tab, then arrow keys to review tasks; Enter or Space shows
					details; Escape clears.
				</p>
			</div>

			{graph.cycles.length || graph.missingReferences.length ? (
				<div
					className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm"
					role="alert"
				>
					<strong>Dependency integrity warning.</strong>
					{graph.cycles.length
						? ` ${graph.cycles.length} cycle${graph.cycles.length === 1 ? "" : "s"} detected.`
						: ""}
					{graph.missingReferences.length
						? ` ${graph.missingReferences.length} missing reference${graph.missingReferences.length === 1 ? "" : "s"} detected.`
						: ""}
				</div>
			) : null}

			<div className="overflow-hidden rounded-lg border bg-card">
				<div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
					<span className="text-xs text-muted-foreground">
						{layout.orientation === "lr" ? "Left to right" : "Top down"} ·{" "}
						{Math.round(activeCamera.scale * 100)}%
					</span>
					<span className="flex-1" />
					<button
						aria-label="Zoom out"
						className={CONTROL_CLASS}
						onClick={() => zoomBy(1 / ZOOM_STEP)}
						type="button"
					>
						<MinusIcon aria-hidden className="size-3.5" />
					</button>
					<button
						aria-label="Zoom in"
						className={CONTROL_CLASS}
						onClick={() => zoomBy(ZOOM_STEP)}
						type="button"
					>
						<PlusIcon aria-hidden className="size-3.5" />
					</button>
					<button
						className={cn(CONTROL_CLASS, "flex items-center gap-1")}
						onClick={fit}
						type="button"
					>
						<MaximizeIcon aria-hidden className="size-3.5" />
						Fit
					</button>
				</div>

				{/*
				 * The viewport is the camera surface: pointer panning and the
				 * arrow-key contract belong to it, while everything selectable
				 * inside it is a real button. A named `<section>` gives it an
				 * implicit `region` role without claiming `application`, which would
				 * strip browse mode off a subtree made entirely of buttons.
				 * `tabIndex={-1}` only lets a background click park focus so the
				 * arrow keys keep arriving here.
				 */}
				<section
					aria-label="Task dependency graph. Drag to pan, wheel to zoom."
					className="relative h-[min(70vh,640px)] cursor-grab touch-none overflow-hidden bg-muted/20 active:cursor-grabbing"
					onKeyDown={(event) => {
						const action = resolveDependencyNavAction(
							event.nativeEvent,
							keys,
							selected,
						);
						if (action.kind === "none") return;
						event.preventDefault();
						if (action.kind === "clear") setSelected(null);
						else selectNode(action.key);
					}}
					onPointerCancel={() => {
						dragRef.current = null;
					}}
					onPointerDown={(event) => {
						if (event.button !== 0) return;
						if ((event.target as HTMLElement).closest("button")) return;
						dragRef.current = {
							x: event.clientX,
							y: event.clientY,
							moved: false,
						};
						setAnimate(false);
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						const drag = dragRef.current;
						if (!drag) return;
						const dx = event.clientX - drag.x;
						const dy = event.clientY - drag.y;
						if (
							!drag.moved &&
							Math.abs(dx) < DRAG_SLOP_PX &&
							Math.abs(dy) < DRAG_SLOP_PX
						)
							return;
						drag.moved = true;
						drag.x = event.clientX;
						drag.y = event.clientY;
						setCamera((current) => panCamera(current ?? layout.camera, dx, dy));
					}}
					onPointerUp={(event) => {
						const drag = dragRef.current;
						dragRef.current = null;
						if (event.currentTarget.hasPointerCapture(event.pointerId))
							event.currentTarget.releasePointerCapture(event.pointerId);
						if (drag && !drag.moved) setSelected(null);
					}}
					ref={setViewportEl}
					tabIndex={-1}
				>
					<div
						className="absolute left-0 top-0"
						style={{
							transform: `translate(${activeCamera.x}px, ${activeCamera.y}px) scale(${activeCamera.scale})`,
							transformOrigin: "0 0",
							transition:
								animate && !reducedMotion ? "transform 160ms ease-out" : "none",
							willChange: "transform",
						}}
					>
						<svg
							aria-hidden
							className="pointer-events-none absolute left-0 top-0 overflow-visible"
							height={Math.max(1, Math.ceil(layout.bounds.maxY))}
							width={Math.max(1, Math.ceil(layout.bounds.maxX))}
						>
							<title>Dependency edges</title>
							<defs>
								<marker
									id="dependency-arrow"
									markerHeight="6"
									markerWidth="6"
									orient="auto-start-reverse"
									refX="9"
									refY="5"
									viewBox="0 0 10 10"
								>
									<path
										className="fill-muted-foreground/60"
										d="M 0 0 L 10 5 L 0 10 z"
									/>
								</marker>
							</defs>
							{graph.edges.map((edge) => {
								const from = boxes.get(edge.from);
								const to = boxes.get(edge.to);
								if (!from || !to) return null;
								const hot = incident?.has(edgeId(edge.from, edge.to)) ?? false;
								const cyclic = Boolean(
									byKey.get(edge.from)?.inCycle && byKey.get(edge.to)?.inCycle,
								);
								return (
									<path
										className={cn(
											"fill-none",
											hot
												? "stroke-primary"
												: cyclic
													? "stroke-destructive/70"
													: "stroke-muted-foreground/30",
											incident && !hot && "opacity-40",
										)}
										d={edgePath(from, to, layout.orientation)}
										key={edgeId(edge.from, edge.to)}
										markerEnd="url(#dependency-arrow)"
										strokeDasharray={cyclic ? "4 3" : undefined}
										strokeWidth={hot ? 2.25 : 1.5}
										// A fitted deep graph sits near a third of full
										// size, where a scaled 1.5px stroke thins to
										// half a pixel and the topology greys out. Edges
										// hold their screen weight at every zoom.
										vectorEffect="non-scaling-stroke"
									/>
								);
							})}
						</svg>

						{/* Tier 2: artifact labels are the first thing to go at overview
						    scale, and the projection never invents one. */}
						{lod === "detail"
							? graph.edges.map((edge) => {
									const from = boxes.get(edge.from);
									const to = boxes.get(edge.to);
									if (!from || !to || !edge.artifactLabel) return null;
									const a = centreOf(from);
									const b = centreOf(to);
									return (
										<span
											className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border bg-card/90 px-1.5 py-px text-[10px] text-muted-foreground"
											key={edgeId(edge.from, edge.to)}
											style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}
										>
											{edge.artifactLabel}
										</span>
									);
								})
							: null}

						{graph.nodes.map((node) => {
							const box = boxes.get(node.key);
							if (!box) return null;
							const isSelected = selected === node.key;
							return (
								<button
									aria-pressed={isSelected}
									className={cn(
										"absolute flex flex-col justify-center overflow-hidden rounded-lg border bg-card px-2.5 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
										isSelected
											? "border-primary bg-accent"
											: "hover:border-foreground/25",
										node.inCycle && !isSelected && "border-destructive/50",
									)}
									id={`dependency-${node.key}`}
									key={node.key}
									onClick={(event) => {
										event.stopPropagation();
										selectNode(node.key);
									}}
									ref={(element) => {
										if (element) nodeRefs.current.set(node.key, element);
										else nodeRefs.current.delete(node.key);
									}}
									style={{
										height: box.height,
										left: box.x,
										top: box.y,
										width: box.width,
									}}
									tabIndex={node.key === anchor ? 0 : -1}
									title={displayName(node)}
									type="button"
								>
									{node.displayId ? (
										<span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
											{node.displayId}
										</span>
									) : null}
									<span className="block truncate text-xs font-semibold">
										{node.title}
									</span>
									<span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
										<span className={STATUS_TEXT[node.status]}>
											{statusLabel(node)}
										</span>
										{lod === "detail" ? ` · ${stateNote(node)}` : ""}
									</span>
								</button>
							);
						})}
					</div>
				</section>
			</div>

			<aside
				aria-label="Selected task"
				aria-live="polite"
				className="rounded-lg border bg-card p-3"
			>
				{selectedNode ? (
					<>
						<h3 className="font-medium">{displayName(selectedNode)}</h3>
						<p className="text-sm text-muted-foreground">
							{statusLabel(selectedNode)} · {stateNote(selectedNode)}
							{selectedNode.assignee ? ` · ${selectedNode.assignee}` : ""}.
							Blocked by:{" "}
							{selectedNode.dependsOnKeys.length
								? selectedNode.dependsOnKeys.map(titleOf).join(", ")
								: "Nothing"}
							. Unblocks:{" "}
							{selectedNode.dependentKeys.length
								? selectedNode.dependentKeys.map(titleOf).join(", ")
								: "Nothing"}
							.
						</p>
						{selectedNode.description ? (
							<p className="mt-2 text-xs text-muted-foreground">
								{selectedNode.description}
							</p>
						) : null}
						{selectedNode.dependsOnKeys.length +
							selectedNode.dependentKeys.length >
						0 ? (
							<div className="mt-2 flex flex-wrap gap-1.5">
								{[
									...selectedNode.dependsOnKeys.map((key) => ({
										key,
										prefix: "Blocked by",
									})),
									...selectedNode.dependentKeys.map((key) => ({
										key,
										prefix: "Unblocks",
									})),
								].map(({ key, prefix }) => (
									<button
										className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
										key={`${prefix}-${key}`}
										onClick={() => selectNode(key)}
										type="button"
									>
										{prefix} · {titleOf(key)}
									</button>
								))}
							</div>
						) : null}
					</>
				) : (
					<>
						<h3 className="font-medium">Select a task</h3>
						<p className="text-sm text-muted-foreground">
							Activate a node to inspect its status, prerequisites, and
							dependents.
						</p>
					</>
				)}
			</aside>
		</section>
	);
}
