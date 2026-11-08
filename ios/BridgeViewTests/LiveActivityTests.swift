import Foundation
import Testing
@testable import BridgeView

struct LiveActivityTests {
    /// The server sends `eta` as seconds since 2001-01-01, which is how the system's
    /// default JSONDecoder reads a Date in a Live Activity payload
    @Test func contentStateDecodesServerPayload() throws {
        let json = #"{ "eta": 815090000.0, "distanceNM": 1.6, "sog": 11.2, "phase": "approaching" }"#
        let state = try JSONDecoder().decode(ShipApproachAttributes.ContentState.self, from: Data(json.utf8))
        #expect(state.eta == Date(timeIntervalSinceReferenceDate: 815_090_000))
        #expect(state.phase == .approaching)
        #expect(state.distanceNM == 1.6)
    }

    @Test func contentStateRoundTrips() throws {
        let state = ShipApproachAttributes.ContentState(
            eta: Date(timeIntervalSinceReferenceDate: 815_090_000), distanceNM: 0, sog: 9, phase: .passed
        )
        let data = try JSONEncoder().encode(state)
        let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(object["eta"] as? Double == 815_090_000)
        #expect(object["phase"] as? String == "passed")
        #expect(try JSONDecoder().decode(ShipApproachAttributes.ContentState.self, from: data) == state)
    }

    @Test func attributesDecodeWithoutOptionalFields() throws {
        let json = #"{ "mmsi": 316001234, "name": "ALGOMA EQUINOX", "direction": "downbound" }"#
        let attributes = try JSONDecoder().decode(ShipApproachAttributes.self, from: Data(json.utf8))
        #expect(attributes.direction == .downbound)
        #expect(attributes.length == nil)
    }

    @Test func deepLinkRoundTrips() {
        #expect(DeepLink.mmsi(from: DeepLink.ship(316001234)) == 316001234)
        #expect(DeepLink.mmsi(from: URL(string: "https://example.com/ship/1")!) == nil)
        #expect(DeepLink.target(from: DeepLink.map(316001234)) == .map(316001234))
        #expect(DeepLink.target(from: DeepLink.cam) == .cam)
        #expect(DeepLink.mmsi(from: DeepLink.map(316001234)) == nil)
        #expect(DeepLink.target(from: URL(string: "bridgeview://elsewhere")!) == nil)
    }

    /// A passed end carries when it went under and the next ship, all as Swift dates
    @Test func contentStateDecodesPassedEnd() throws {
        let json = #"""
        { "eta": 815090000.0, "distanceNM": 0, "sog": 11.2, "phase": "passed", "updatedAt": 815090060.0,
          "passedAt": 815090030.0, "nextName": "MANITOULIN", "nextEta": 815091500.0 }
        """#
        let state = try JSONDecoder().decode(ShipApproachAttributes.ContentState.self, from: Data(json.utf8))
        #expect(state.passedAt == Date(timeIntervalSinceReferenceDate: 815_090_030))
        #expect(state.updatedAt == Date(timeIntervalSinceReferenceDate: 815_090_060))
        #expect(state.nextName == "MANITOULIN")
        #expect(state.nextEta == Date(timeIntervalSinceReferenceDate: 815_091_500))
    }

    @Test func attributesDecodeStartTime() throws {
        let json = #"{ "mmsi": 316001234, "name": "ALGOMA EQUINOX", "direction": "upbound", "startedAt": 815089500.0 }"#
        let attributes = try JSONDecoder().decode(ShipApproachAttributes.self, from: Data(json.utf8))
        #expect(attributes.startedAt == Date(timeIntervalSinceReferenceDate: 815_089_500))
    }

    @Test @MainActor func mapLinkOpensTheMapOnTheShip() {
        let router = Router()
        router.open(mmsi: 1)
        router.open(.map(316001234))
        #expect(router.tab == .map)
        #expect(router.mapShip == 316001234)
        #expect(router.openedShip == nil)
        router.open(.cam)
        #expect(router.camRequested)
    }
}
