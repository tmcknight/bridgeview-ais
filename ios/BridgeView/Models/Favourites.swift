import Foundation
import Observation

/// A ship the user starred. The name is the one it had then, shown until the
/// server answers (or when it doesn't know the ship any more).
struct FavouriteShip: Codable, Hashable, Sendable, Identifiable {
    var mmsi: Int
    var name: String
    var addedAt: Date

    var id: Int { mmsi }
}

/// Starred ships, kept on the phone in UserDefaults; the server never sees them
@MainActor
@Observable
final class Favourites {
    static let key = "favourites.ships"

    /// Oldest first, as added
    private(set) var ships: [FavouriteShip]

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        ships = Self.decode(defaults.data(forKey: Self.key))
    }

    var mmsis: [Int] { ships.map(\.mmsi) }

    func contains(_ mmsi: Int) -> Bool {
        ships.contains { $0.mmsi == mmsi }
    }

    /// Stars the ship, or unstars it if it's starred
    func toggle(mmsi: Int, name: String, now: Date = .now) {
        ships = Self.toggled(ships, mmsi: mmsi, name: name, now: now)
        defaults.set(Self.encode(ships), forKey: Self.key)
    }

    static func toggled(_ ships: [FavouriteShip], mmsi: Int, name: String, now: Date) -> [FavouriteShip] {
        if ships.contains(where: { $0.mmsi == mmsi }) {
            return ships.filter { $0.mmsi != mmsi }
        }
        return ships + [FavouriteShip(mmsi: mmsi, name: name, addedAt: now)]
    }

    /// Stored favourites; anything unreadable is dropped rather than losing the rest
    static func decode(_ data: Data?) -> [FavouriteShip] {
        guard let data, let items = try? JSONDecoder.api.decode([Lenient].self, from: data) else { return [] }
        var seen = Set<Int>()
        return items.compactMap(\.ship).filter { seen.insert($0.mmsi).inserted }
    }

    static func encode(_ ships: [FavouriteShip]) -> Data? {
        try? encoder.encode(ships)
    }

    /// ISO 8601 dates, which JSONDecoder.api reads back
    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    /// One stored favourite, or nil when it can't be read
    private struct Lenient: Decodable {
        var ship: FavouriteShip?

        init(from decoder: Decoder) throws {
            ship = try? FavouriteShip(from: decoder)
            if let mmsi = ship?.mmsi, mmsi <= 0 { ship = nil }
        }
    }
}
