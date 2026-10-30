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

    static func ship(_ mmsi: Int) -> URL {
        URL(string: "\(scheme)://ship/\(mmsi)")!
    }

    /// The MMSI in a `bridgeview://ship/<mmsi>` link
    static func mmsi(from url: URL) -> Int? {
        guard url.scheme == scheme, url.host() == "ship" else { return nil }
        return Int(url.lastPathComponent)
    }
}
