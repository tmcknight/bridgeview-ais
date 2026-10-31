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
    /// Class B transponder (pleasure craft, small workboats)
    var classB: Bool?
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

/// Ship details: photo, builder and operator from Wikidata; build year, tonnage,
/// service type and registry from the USCG and Transport Canada registers
struct VesselInfo: Codable, Hashable, Sendable {
    var wikidataId: String?
    var wikidataUrl: URL?
    var name: String?
    var description: String?
    var imageUrl: URL?
    var imagePageUrl: URL?
    var yearBuilt: Int?
    var builder: String?
    var `operator`: String?
    var grossTonnage: Double?
    var wikipediaUrl: URL?
    var photos: [VesselPhoto]?
    var registry: RegistryRecord?
    var uscg: UscgRecord?

    /// Every photo, best first: the server's list, else Wikidata's one photo
    var allPhotos: [VesselPhoto] {
        if let photos, !photos.isEmpty { return photos }
        return imageUrl.map { [VesselPhoto(url: $0, pageUrl: imagePageUrl)] } ?? []
    }
}

/// A photo on Wikimedia Commons, with the credit its licence asks for
struct VesselPhoto: Codable, Hashable, Sendable {
    var url: URL
    var pageUrl: URL?
    var artist: String?
    var license: String?
    var year: Int?

    /// "Pete Markham · CC BY-SA 2.0"
    var credit: String? {
        let parts = [artist, license].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// The ship's entry in Transport Canada's register of large vessels
struct RegistryRecord: Codable, Hashable, Sendable {
    var officialNumber: String?
    var hullNumber: String?
    var portOfRegistry: String?
    var enginePowerKw: Double?
}

/// The ship's record in the USCG's Port State Information Exchange
struct UscgRecord: Codable, Hashable, Sendable {
    var vesselId: Int
    var officialNumber: String?
    var serviceType: String?
    var serviceSubType: String?
    var deadweight: Double?
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
    /// Whether the server takes photos shared from the app
    var photoSharing: Bool?
    /// Whether the server takes photo reports from the app
    var photoReporting: Bool?
    var upcoming: [Ship]
    var recent: [Ship]
}

/// GET /api/map: every ship heard lately, each with a position
struct MapSnapshot: Codable, Sendable {
    var generatedAt: Date
    var attribution: [Attribution]?
    var ships: [Ship]
}

/// A data credit: `text` linking to `url`. AISHub's terms require its credit near the data.
struct Attribution: Codable, Hashable, Sendable {
    var text: String
    var url: URL
}
