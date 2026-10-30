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

    /// `nearBridge`: whether the phone is near the bridge, nil when unknown
    /// (location off or not yet worked out), which doesn't hold alerts back
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
        self.liveActivities = liveActivities
        // Sorted so the body is stable and easy to compare
        categories = ShipCategory.allCases.filter(preferences.categories.contains)
        minLength = preferences.minLength
        directions = Direction.allCases.filter(preferences.directions.contains)
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
            nearBridgeRadius: defaults.object(forKey: Key.nearBridgeRadius) as? Int ?? defaultRadius
        )
    }

    /// Sets are stored as comma-separated raw values so @AppStorage can hold them
    static func decodeSet<T: RawRepresentable & Hashable>(_ text: String) -> Set<T> where T.RawValue == String {
        Set(text.split(separator: ",").compactMap { T(rawValue: String($0)) })
    }

    static func encodeSet<T: RawRepresentable & CaseIterable & Hashable>(_ set: Set<T>) -> String where T.RawValue == String {
        T.allCases.filter(set.contains).map(\.rawValue).joined(separator: ",")
    }
}
