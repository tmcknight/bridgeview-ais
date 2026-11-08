import ActivityKit
import AppIntents

/// "Stop following" on a ship's Live Activity: ends it on this phone, and turns
/// Live Activities off for that ship so the server doesn't start another.
///
/// A `LiveActivityIntent` runs in the app's process (launched in the background if
/// need be), not the widget's, so the app's `StopFollowing.handler` can save the
/// choice and send it to the server.
struct StopFollowingIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop Following Ship"
    static let description = IntentDescription("Ends the ship's Live Activity and stops following it.")
    static let isDiscoverable = false

    @Parameter(title: "MMSI")
    var mmsi: Int

    init() {}

    init(mmsi: Int) {
        self.mmsi = mmsi
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        await StopFollowing.handler?(mmsi)
        for activity in Activity<ShipApproachAttributes>.activities where activity.attributes.mmsi == mmsi {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        return .result()
    }
}

@MainActor
enum StopFollowing {
    /// Set by the app at launch: saves "off" for the ship and sends it to the server
    static var handler: ((Int) async -> Void)?
}
