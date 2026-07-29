/**
 * Process-wide pause-after-tool flags for Drive raise-hand (DRV-INTERRUPT).
 *
 * Hub `call_raise_hand` sets these for sessions linked to the room;
 * SessionRuntime consults them via `AgentRuntimeHooks.shouldPauseAfterTool`.
 */

const pauseBySessionId = new Map<string, boolean>();

export function setDrivePauseAfterTool(
	sessionId: string,
	pause: boolean,
): void {
	if (pause) {
		pauseBySessionId.set(sessionId, true);
	} else {
		pauseBySessionId.delete(sessionId);
	}
}

export function shouldDrivePauseAfterTool(sessionId: string): boolean {
	return pauseBySessionId.get(sessionId) === true;
}

export function clearDrivePauseAfterTool(sessionId: string): void {
	pauseBySessionId.delete(sessionId);
}

/** Clear flags for every session currently linked to a room. */
export function clearDrivePauseAfterToolForSessions(
	sessionIds: Iterable<string>,
): void {
	for (const sessionId of sessionIds) {
		pauseBySessionId.delete(sessionId);
	}
}

export function resetDrivePauseAfterToolForTests(): void {
	pauseBySessionId.clear();
}
