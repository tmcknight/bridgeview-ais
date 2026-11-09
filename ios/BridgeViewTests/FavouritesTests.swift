import Foundation
import Testing
@testable import BridgeView

@MainActor
struct FavouritesTests {
    private let now = Date(timeIntervalSince1970: 1_793_369_435)

    private func freshDefaults() -> UserDefaults {
        let name = "FavouritesTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func togglesAndSaves() {
        let defaults = freshDefaults()
        let favourites = Favourites(defaults: defaults)
        favourites.toggle(mmsi: 316001234, name: "ALGOMA EQUINOX", now: now)
        favourites.toggle(mmsi: 366999000, name: "AMERICAN SPIRIT", now: now)
        #expect(favourites.contains(316001234))
        #expect(favourites.mmsis == [316001234, 366999000])

        // Read back as a new launch would
        let reloaded = Favourites(defaults: defaults)
        #expect(reloaded.ships == favourites.ships)
        #expect(reloaded.ships.first?.addedAt == now)

        reloaded.toggle(mmsi: 316001234, name: "ALGOMA EQUINOX")
        #expect(!reloaded.contains(316001234))
        #expect(Favourites(defaults: defaults).mmsis == [366999000])
    }

    @Test func skipsWhatItCantRead() {
        let json = """
        [{"mmsi": 1, "name": "ONE", "addedAt": "2026-11-01T00:00:00Z"},
         {"mmsi": "x"}, {"mmsi": -5, "name": "NO", "addedAt": "2026-11-01T00:00:00Z"},
         {"mmsi": 1, "name": "AGAIN", "addedAt": "2026-11-01T00:00:00Z"}]
        """
        #expect(Favourites.decode(Data(json.utf8)).map(\.name) == ["ONE"])
        #expect(Favourites.decode(Data("nonsense".utf8)).isEmpty)
        #expect(Favourites.decode(nil).isEmpty)
    }

    @Test func describesWhereAShipIsAt() {
        var ship = Ship(mmsi: 1, name: "LAKER")
        #expect(ship.status(now: now) == "Not heard lately")
        ship.passage = Passage(time: now.addingTimeInterval(-3 * 86_400), direction: .downbound)
        #expect(ship.status(now: now).hasPrefix("Passed downbound "))
        ship.heard = true
        #expect(ship.status(now: now) == "Heard now")
        ship.approach = Approach(etaMinutes: 12, eta: now, distanceNM: 2, direction: .upbound)
        #expect(ship.status(now: now) == "Upbound · at the bridge in 12 min")
        #expect(ship.status(now: now, spoken: true) == "Upbound · at the bridge in 12 minutes")
    }

    @Test func decodesShipSummaries() throws {
        let json = """
        {"ships": [{"mmsi": 316001234, "name": "ALGOMA EQUINOX", "shipTypeName": "Cargo", "length": 225,
                    "destination": "THUNDER BAY", "flag": "CA", "heard": true,
                    "photoUrl": "https://upload.wikimedia.org/x.jpg"}],
         "more": true}
        """
        let list = try JSONDecoder.api.decode(ShipList.self, from: Data(json.utf8))
        let ship = try #require(list.ships.first)
        #expect(list.more == true)
        #expect(ship.heard == true)
        #expect(ship.photoUrl?.host() == "upload.wikimedia.org")
        #expect(ship.searchDetails == "Cargo · 225 m · To Thunder Bay")
    }
}
