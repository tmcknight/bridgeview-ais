import Foundation

/// What the user wants to be alerted about; stored in UserDefaults
struct AlertPreferences: Equatable, Sendable {
    var enabled: Bool
    var categories: Set<ShipCategory>
    var minLength: Int
    var directions: Set<Direction>
    /// Only alert while this phone is within `nearBridgeRadius` km of the bridge.
    /// Worked out on the phone; the server only sees `enabled` turn off and on.
    var nearBridgeOnly = false
    var nearBridgeRadius = AlertPreferences.defaultRadius
    /// Follow ships with a Live Activity, not just a notification (when iOS allows
    /// them), unless `liveActivityShips` says otherwise for a ship
    var liveActivities = true
    /// MMSI -> Live Activity on or off, for ships the user chose one by one
    var liveActivityShips: [Int: Bool] = [:]

    static let lengthOptions = [0, 100, 150, 200]
    static let radiusOptions = [2, 5, 10, 25]
    static let defaultRadius = 5
}

/// PUT /api/devices/:token body (ios/API.md)
struct DeviceRegistration: Codable, Equatable, Sendable {
    var environment: String
    var enabled: Bool
    var pushToStartToken: String?
    var liveActivities: Bool
    var categories: [ShipCategory]
    var minLength: Int
    var directions: [Direction]
    /// Per-ship choices, by MMSI; nil when there are none or iOS doesn't allow Live Activities
    var liveActivityShips: [String: Bool]?

    /// `nearBridge`: whether the phone is near the bridge, nil when unknown
    /// (location off or not yet worked out), which doesn't hold alerts back.
    /// `liveActivities`: whether iOS allows them; the user can still turn them off
    init(
        environment: String,
        preferences: AlertPreferences,
        nearBridge: Bool? = nil,
        pushToStartToken: String?,
        liveActivities: Bool
    ) {
        self.environment = environment
        enabled = preferences.enabled && (!preferences.nearBridgeOnly || nearBridge != false)
        self.pushToStartToken = pushToStartToken
        self.liveActivities = liveActivities && preferences.liveActivities
        // Sorted so the body is stable and easy to compare
        categories = ShipCategory.allCases.filter(preferences.categories.contains)
        minLength = preferences.minLength
        directions = Direction.allCases.filter(preferences.directions.contains)
        // The server takes only 9-digit MMSIs, refusing the whole registration
        // otherwise, and some transponders send malformed ones
        let ships = preferences.liveActivityShips.filter { (100_000_000...999_999_999).contains($0.key) }
        if liveActivities, !ships.isEmpty {
            // The server takes up to 50; only ships coming up are kept, so this is plenty
            liveActivityShips = Dictionary(
                uniqueKeysWithValues: ships.sorted { $0.key < $1.key }
                    .prefix(50)
                    .map { (String($0.key), $0.value) }
            )
        }
    }
}

extension AlertPreferences {
    enum Key {
        static let enabled = "alerts.enabled"
        static let categories = "alerts.categories"
        static let minLength = "alerts.minLength"
        static let directions = "alerts.directions"
        static let nearBridgeOnly = "alerts.nearBridgeOnly"
        static let nearBridgeRadius = "alerts.nearBridgeRadius"
        static let liveActivities = "alerts.liveActivities"
        static let liveActivityShips = "alerts.liveActivityShips"
    }

    /// Defaults: alerts on, commercial ships of any length, both directions
    static let defaultCategories = encodeSet(ShipCategory.defaultAlerts)
    static let defaultDirections = encodeSet(Set(Direction.allCases))

    static func load(from defaults: UserDefaults = .standard) -> AlertPreferences {
        AlertPreferences(
            enabled: defaults.object(forKey: Key.enabled) as? Bool ?? true,
            categories: decodeSet(defaults.string(forKey: Key.categories) ?? defaultCategories),
            minLength: defaults.integer(forKey: Key.minLength),
            directions: decodeSet(defaults.string(forKey: Key.directions) ?? defaultDirections),
            nearBridgeOnly: defaults.bool(forKey: Key.nearBridgeOnly),
            nearBridgeRadius: defaults.object(forKey: Key.nearBridgeRadius) as? Int ?? defaultRadius,
            liveActivities: defaults.object(forKey: Key.liveActivities) as? Bool ?? true,
            liveActivityShips: decodeShips(defaults.string(forKey: Key.liveActivityShips) ?? "")
        )
    }

    /// Per-ship choices are stored as "mmsi:1,mmsi:0" so @AppStorage can hold them
    static func decodeShips(_ text: String) -> [Int: Bool] {
        var ships: [Int: Bool] = [:]
        for pair in text.split(separator: ",") {
            let parts = pair.split(separator: ":")
            guard parts.count == 2, let mmsi = Int(parts[0]) else { continue }
            ships[mmsi] = parts[1] == "1"
        }
        return ships
    }

    static func encodeShips(_ ships: [Int: Bool]) -> String {
        ships.keys.sorted().map { "\($0):\(ships[$0]! ? 1 : 0)" }.joined(separator: ",")
    }

    /// Sets are stored as comma-separated raw values so @AppStorage can hold them
    static func decodeSet<T: RawRepresentable & Hashable>(_ text: String) -> Set<T> where T.RawValue == String {
        Set(text.split(separator: ",").compactMap { T(rawValue: String($0)) })
    }

    static func encodeSet<T: RawRepresentable & CaseIterable & Hashable>(_ set: Set<T>) -> String where T.RawValue == String {
        T.allCases.filter(set.contains).map(\.rawValue).joined(separator: ",")
    }
}
