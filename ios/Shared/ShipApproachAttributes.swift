import ActivityKit
import Foundation

/// Live Activity for a ship heading for the Blue Water Bridge.
///
/// The server starts it with a push-to-start notification
/// (`"attributes-type": "ShipApproachAttributes"`) and updates and ends it with
/// broadcast pushes on a channel. The system decodes those payloads with the
/// default `Codable` strategies, so property names and types here must match
/// ios/API.md exactly, and nothing may use a custom coding strategy.
struct ShipApproachAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// When the ship should reach the bridge
        var eta: Date
        var distanceNM: Double
        var sog: Double
        var phase: Phase
        /// When the server sent this; shown once the countdown is out of date
        var updatedAt: Date?
        /// When the ship went under the bridge (on a `passed` end)
        var passedAt: Date?
        /// The ship coming up after it, and when (on a `passed` end)
        var nextName: String?
        var nextEta: Date?
    }

    enum Phase: String, Codable, Hashable {
        /// Heading for the bridge
        case approaching
        /// Gone under the bridge
        case passed
        /// Stopped or turned away
        case lost
    }

    var mmsi: Int
    var name: String
    var direction: Direction
    var shipTypeName: String?
    var length: Int?
    var destination: String?
    /// When the countdown began, for its progress bar (older servers leave it out)
    var startedAt: Date?
}

/// Upbound = northbound into Lake Huron; downbound = southbound
enum Direction: String, Codable, Hashable, CaseIterable, Sendable {
    case upbound
    case downbound

    var label: String {
        switch self {
        case .upbound: "Upbound"
        case .downbound: "Downbound"
        }
    }

    var symbol: String {
        switch self {
        case .upbound: "arrow.up"
        case .downbound: "arrow.down"
        }
    }
}

enum DeepLink {
    static let scheme = "bridgeview"

    /// Where a link goes in the app
    enum Target: Equatable {
        /// The ship's page
        case ship(Int)
        /// The map, on the ship
        case map(Int)
        /// The Port Huron ship cam
        case cam
    }

    static func ship(_ mmsi: Int) -> URL {
        URL(string: "\(scheme)://ship/\(mmsi)")!
    }

    static func map(_ mmsi: Int) -> URL {
        URL(string: "\(scheme)://map/\(mmsi)")!
    }

    static let cam = URL(string: "\(scheme)://cam")!

    /// The MMSI in a `bridgeview://ship/<mmsi>` link
    static func mmsi(from url: URL) -> Int? {
        if case .ship(let mmsi) = target(from: url) { mmsi } else { nil }
    }

    static func target(from url: URL) -> Target? {
        guard url.scheme == scheme else { return nil }
        switch url.host() {
        case "ship": return Int(url.lastPathComponent).map(Target.ship)
        case "map": return Int(url.lastPathComponent).map(Target.map)
        case "cam": return .cam
        default: return nil
        }
    }
}
