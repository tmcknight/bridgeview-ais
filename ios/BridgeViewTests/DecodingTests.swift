import Foundation
import Testing
@testable import BridgeView

struct DecodingTests {
    @Test func decodesBridgeSnapshot() throws {
        let json = """
        {
          "generatedAt": "2026-10-30T14:02:11.000Z",
          "shipCamVideoId": "AwP_Q6IGwFs",
          "upcoming": [{
            "mmsi": 316001234, "name": "ALGOMA EQUINOX", "imo": 9613927, "callSign": "CFK9876",
            "shipType": 70, "shipTypeName": "Cargo", "category": "cargo",
            "length": 225, "width": 24, "draught": 8.1, "destination": "THUNDER BAY",
            "cargo": "Likely going to load grain", "flag": "CA",
            "position": { "latitude": 42.95, "longitude": -82.42, "sog": 11.2, "cog": 2.5,
                          "heading": 3, "navStatus": 0, "time": "2026-10-30T14:01:50Z" },
            "approach": { "etaMinutes": 8.4, "eta": "2026-10-30T14:10:35.000Z",
                          "distanceNM": 1.6, "direction": "upbound" },
            "info": { "wikidataId": "Q123", "wikidataUrl": "https://www.wikidata.org/wiki/Q123",
                      "yearBuilt": 2013, "operator": "Algoma Central", "grossTonnage": 24300,
                      "imageUrl": "https://commons.wikimedia.org/x.jpg" }
          }],
          "recent": [{
            "mmsi": 366999000, "name": "AMERICAN SPIRIT",
            "passage": { "time": "2026-10-30T12:44:00.000Z", "direction": "downbound" }
          }]
        }
        """
        let snapshot = try JSONDecoder.api.decode(BridgeSnapshot.self, from: Data(json.utf8))

        #expect(snapshot.shipCamVideoId == "AwP_Q6IGwFs")
        let ship = try #require(snapshot.upcoming.first)
        #expect(ship.name == "ALGOMA EQUINOX")
        #expect(ship.category == .cargo)
        #expect(ship.flagEmoji == "🇨🇦")
        #expect(ship.summary == "Cargo · 225 m")
        #expect(ship.approach?.direction == .upbound)
        #expect(ship.approach?.eta == Date(timeIntervalSince1970: 1_793_369_435))
        // Dates without fractional seconds decode too
        #expect(ship.position?.time == Date(timeIntervalSince1970: 1_793_368_910))
        #expect(ship.info?.operator == "Algoma Central")

        let passed = try #require(snapshot.recent.first)
        #expect(passed.lastPassage?.direction == .downbound)
        #expect(passed.position == nil)
        #expect(passed.info == nil)
    }

    @Test func decodesAttributionAndShipsWithoutPositions() throws {
        let json = """
        {
          "generatedAt": "2026-10-30T14:02:11.000Z",
          "attribution": [
            { "text": "Data: AISHub contributors", "url": "https://www.aishub.net" },
            { "text": "AISStream.io", "url": "https://aisstream.io" }
          ],
          "upcoming": [{
            "mmsi": 316001234, "name": "ALGOMA EQUINOX", "category": "cargo",
            "approach": { "etaMinutes": 8.4, "eta": "2026-10-30T14:10:35.000Z",
                          "distanceNM": 1.6, "direction": "upbound" }
          }],
          "recent": []
        }
        """
        let snapshot = try JSONDecoder.api.decode(BridgeSnapshot.self, from: Data(json.utf8))

        #expect(snapshot.attribution == [
            Attribution(text: "Data: AISHub contributors", url: URL(string: "https://www.aishub.net")!),
            Attribution(text: "AISStream.io", url: URL(string: "https://aisstream.io")!),
        ])
        // A ship whose position came from AISHub: an approach, but no position
        let ship = try #require(snapshot.upcoming.first)
        #expect(ship.position == nil)
        #expect(ship.approach?.distanceNM == 1.6)
    }

    @Test func toleratesServersWithoutAttribution() throws {
        let json = #"{ "generatedAt": "2026-10-30T14:02:11Z", "upcoming": [], "recent": [] }"#
        let snapshot = try JSONDecoder.api.decode(BridgeSnapshot.self, from: Data(json.utf8))
        #expect(snapshot.attribution == nil)
    }

    @Test func decodesShipWithPassages() throws {
        let json = """
        {
          "mmsi": 316001234, "name": "ALGOMA EQUINOX",
          "passages": [
            { "time": "2026-10-30T12:44:00.000Z", "direction": "downbound" },
            { "time": "2026-10-28T09:10:00.000Z", "direction": "upbound" }
          ]
        }
        """
        let ship = try JSONDecoder.api.decode(Ship.self, from: Data(json.utf8))
        #expect(ship.passages?.count == 2)
        #expect(ship.lastPassage?.direction == .downbound)
        #expect(ship.approach == nil)
    }

    @Test func decodesRegisterDetailsWithoutWikidata() throws {
        let json = """
        {
          "mmsi": 316001234, "name": "ALGOMA EQUINOX",
          "info": {
            "yearBuilt": 2012, "grossTonnage": 24451,
            "photos": [
              { "url": "https://upload.wikimedia.org/a.jpg", "pageUrl": "https://commons.wikimedia.org/wiki/File:A.jpg",
                "artist": "Pete Markham", "license": "CC BY-SA 2.0", "year": 2012 },
              { "url": "https://upload.wikimedia.org/b.jpg" }
            ],
            "registry": { "source": "transport-canada", "officialNumber": "837491", "hullNumber": "MD-149-GB-01",
                          "portOfRegistry": "ST. CATHARINES", "enginePowerKw": 6929 },
            "uscg": { "source": "uscg", "vesselId": 1225032, "serviceType": "Freight Ship",
                      "serviceSubType": "General", "deadweight": 36480 }
          }
        }
        """
        let ship = try JSONDecoder.api.decode(Ship.self, from: Data(json.utf8))
        #expect(ship.info?.wikidataId == nil)
        #expect(ship.info?.yearBuilt == 2012)
        #expect(ship.info?.registry?.portOfRegistry == "ST. CATHARINES")
        #expect(ship.info?.uscg?.deadweight == 36480)
        #expect(ship.info?.registry?.hullNumber == "MD-149-GB-01")
        #expect(ship.info?.allPhotos.count == 2)
        #expect(ship.info?.allPhotos.first?.credit == "Pete Markham · CC BY-SA 2.0")
        let titles = ShipLinks.for(ship).map(\.title)
        #expect(titles.contains("USCG vessel records"))
        #expect(titles.contains("Transport Canada vessel register"))
        #expect(!titles.contains("Wikidata"))
    }

    @Test func rejectsBadDates() {
        let json = #"{ "time": "yesterday", "direction": "upbound" }"#
        #expect(throws: DecodingError.self) {
            try JSONDecoder.api.decode(Passage.self, from: Data(json.utf8))
        }
    }

    @Test func linksToVesselPages() throws {
        let ship = Ship(mmsi: 316001234, name: "ALGOMA EQUINOX")
        let links = ShipLinks.for(ship)
        let urls = links.map(\.url.absoluteString)
        #expect(urls.contains("https://www.vesselfinder.com/vessels/details/316001234"))
        #expect(urls.contains("https://www.marinetraffic.com/en/ais/details/ships/mmsi:316001234"))
        #expect(!links.contains { $0.title == "Wikipedia" })
    }

    @Test func linksToShipCam() {
        #expect(ShipLinks.shipCam(videoId: "abc")?.absoluteString == "https://www.youtube.com/watch?v=abc")
        #expect(ShipLinks.shipCam(videoId: nil) == nil)
    }
}

extension Ship {
    init(mmsi: Int, name: String) {
        self.init(
            mmsi: mmsi, name: name, imo: nil, callSign: nil, shipType: nil, shipTypeName: nil,
            category: nil, length: nil, width: nil, draught: nil, destination: nil, cargo: nil,
            flag: nil, position: nil, approach: nil, passage: nil, passages: nil, info: nil
        )
    }
}
