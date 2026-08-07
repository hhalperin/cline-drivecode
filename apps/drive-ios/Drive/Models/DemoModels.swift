import Combine
import Foundation

enum AppRoute: Hashable {
	case open
	case home
	case call
	case settings
}

/// Raise-hand interrupt phases — mirrors hub `agencyChrome` (NOW-RAISE-HAND).
enum InterruptPhase: Hashable {
	case idle
	case finishing
	case paused

	var title: String? {
		switch self {
		case .idle: return nil
		case .finishing: return "Finishing current step"
		case .paused: return "Paused — waiting on you"
		}
	}

	var hint: String? {
		switch self {
		case .idle: return nil
		case .finishing:
			return "Hand raised — finishing current step. Hard cancel stays one tap away."
		case .paused:
			return "Hand raised — paused on you. Lower hand to resume."
		}
	}
}

struct LiveCallSummary: Identifiable, Hashable {
	let id: String
	let title: String
	let people: Int
	let agents: Int
	let elapsed: String
	let isLive: Bool
}

struct RecentItem: Identifiable, Hashable {
	let id: String
	let title: String
	let subtitle: String
	let badge: String?
}

struct Participant: Identifiable, Hashable {
	let id: String
	let initials: String
	let name: String
	let role: String
	let speaking: Bool
}

struct DiffLine: Identifiable, Hashable {
	enum Kind { case context, add, remove }
	let id: String
	let kind: Kind
	let text: String
}

/// In-memory demo director for the full consumer loop (fixtures only).
@MainActor
final class DemoSession: ObservableObject {
	@Published var route: AppRoute = .open
	@Published var isPreview = true
	@Published var showApproval = false
	@Published var handRaised = false
	@Published var turnInFlight = true
	@Published var captionsVisible = true
	@Published var holding = false
	@Published var leaveNote: String?

	/// Keep in sync with hub `PREVIEW_CHIP_LABEL`.
	static let previewChipLabel = "Preview · demo call"
	static let leaveKeepRunning = "Room keeps running · rejoin anytime"

	var interruptPhase: InterruptPhase {
		guard handRaised else { return .idle }
		return turnInFlight ? .finishing : .paused
	}

	func watchLive() {
		isPreview = true
		resetCallChrome()
		route = .call
	}

	func continueHome() {
		route = .home
	}

	func joinCall() {
		resetCallChrome()
		route = .call
	}

	func openSettings() {
		route = .settings
	}

	func backHome() {
		route = .home
	}

	func toggleHold() {
		holding.toggle()
		if holding {
			// Demo: holding implies a spoken steer will land — keep turn warm.
			turnInFlight = true
		}
	}

	func toggleHand() {
		handRaised.toggle()
		if handRaised {
			turnInFlight = true
			// After a beat the demo “finishes” the tool step → paused.
			Task { @MainActor in
				try? await Task.sleep(nanoseconds: 1_400_000_000)
				guard handRaised else { return }
				turnInFlight = false
			}
		} else {
			turnInFlight = true
		}
	}

	func toggleCaptions() {
		captionsVisible.toggle()
	}

	func requestApproval() {
		showApproval = true
	}

	func leaveCall() {
		leaveNote = Self.leaveKeepRunning
		resetCallChrome()
		route = .home
	}

	func denyApproval() {
		showApproval = false
	}

	func allowApproval() {
		showApproval = false
		turnInFlight = false
	}

	func consumeLeaveNote() -> String? {
		defer { leaveNote = nil }
		return leaveNote
	}

	private func resetCallChrome() {
		handRaised = false
		turnInFlight = true
		holding = false
		captionsVisible = true
		showApproval = false
	}
}

enum DemoData {
	static let liveCall = LiveCallSummary(
		id: "auth",
		title: "Ship auth middleware",
		people: 3,
		agents: 2,
		elapsed: "12m",
		isLive: true
	)

	static let recent: [RecentItem] = [
		.init(id: "pay", title: "Payments refactor", subtitle: "Yesterday · Plan ready", badge: "Review"),
		.init(id: "status", title: "Status board sync", subtitle: "Mon · Completed", badge: nil),
	]

	static let participants: [Participant] = [
		.init(id: "m", initials: "M", name: "Maya", role: "You", speaking: true),
		.init(id: "a", initials: "A", name: "Alex", role: "Muted", speaking: false),
		.init(id: "c", initials: "◈", name: "Coder", role: "Agent", speaking: false),
	]

	static let spotlightDiff: [DiffLine] = [
		.init(id: "1", kind: .context, text: "export async function middleware(req) {"),
		.init(id: "2", kind: .remove, text: "if (!user) return null"),
		.init(id: "3", kind: .add, text: "const token = await verifyJwt(req)"),
		.init(id: "4", kind: .add, text: "if (!token) return unauthorized()"),
		.init(id: "5", kind: .context, text: "  return next()"),
		.init(id: "6", kind: .context, text: "}"),
	]

	static let approvalDiff: [DiffLine] = [
		.init(id: "a1", kind: .add, text: "export function requireAuth()"),
		.init(id: "a2", kind: .add, text: "  verifyJwt(req)"),
		.init(id: "a3", kind: .add, text: "  next()"),
	]

	static let caption = "Maya — Gate JWT refresh before we merge."
	static let activityTitle = "Maya is speaking"
	static let activityDetail = "Drafting requireAuth · waiting for you"
}
