import Foundation

/// A ship as the server describes it (ios/API.md, "Ship")
struct Ship: Codable, Identifiable, Hashable, Sendable {
    var mmsi: Int
    var name: String
    var imo: Int?
    var callSign: String?
    var shipType: Int?
    var shipTypeName: String?
    var category: ShipCategory?
    var length: Int?
    var width: Int?
    var draught: Double?
    var destination: String?
    var cargo: String?
    var flag: String?
    var position: Position?
    var approach: Approach?
    var passage: Passage?
    /// Only on GET /api/ships/:mmsi, newest first
    var passages: [Passage]?
    var info: VesselInfo?

    var id: Int { mmsi }

    /// The latest passage, whichever endpoint the ship came from
    var lastPassage: Passage? { passage ?? passages?.first }

    /// "Cargo · 225 m"
    var summary: String {
        [shipTypeName, length.map { "\($0) m" }].compactMap { $0 }.joined(separator: " · ")
    }

    var flagEmoji: String? {
        guard let flag, flag.count == 2 else { return nil }
        let scalars = flag.uppercased().unicodeScalars.compactMap { Unicode.Scalar(127_397 + $0.value) }
        return String(String.UnicodeScalarView(scalars))
    }
}

struct Position: Codable, Hashable, Sendable {
    var latitude: Double
    var longitude: Double
    var sog: Double?
    var cog: Double?
    var heading: Int?
    var navStatus: Int?
    var time: Date

    /// Which way the ship points, in degrees true: its heading, or its course
    /// over ground when it sends no heading (AIS uses 511 and 360 for "not available")
    var course: Double? {
        if let heading, heading < 360 { return Double(heading) }
        if let cog, cog < 360 { return cog }
        return nil
    }
}

struct Approach: Codable, Hashable, Sendable {
    var etaMinutes: Double
    var eta: Date
    var distanceNM: Double
    var direction: Direction
}

struct Passage: Codable, Hashable, Sendable {
    var time: Date
    var direction: Direction
}

/// Wikidata details: photo, build year, operator
struct VesselInfo: Codable, Hashable, Sendable {
    var wikidataId: String
    var wikidataUrl: URL
    var name: String?
    var description: String?
    var imageUrl: URL?
    var imagePageUrl: URL?
    var yearBuilt: Int?
    var builder: String?
    var `operator`: String?
    var grossTonnage: Double?
    var wikipediaUrl: URL?
}

enum ShipCategory: String, Codable, CaseIterable, Hashable, Sendable {
    case cargo
    case tanker
    case passenger
    case other

    var label: String {
        switch self {
        case .cargo: "Cargo"
        case .tanker: "Tanker"
        case .passenger: "Passenger"
        case .other: "Other"
        }
    }

    static let defaultAlerts: Set<ShipCategory> = [.cargo, .tanker, .passenger]
}

/// GET /api/bridge
struct BridgeSnapshot: Codable, Sendable {
    var generatedAt: Date
    var shipCamVideoId: String?
    /// Credits for the AIS feeds the server uses, shown near the ship lists
    var attribution: [Attribution]?
    var upcoming: [Ship]
    var recent: [Ship]
}

/// A data credit: `text` linking to `url`. AISHub's terms require its credit near the data.
struct Attribution: Codable, Hashable, Sendable {
    var text: String
    var url: URL
}
