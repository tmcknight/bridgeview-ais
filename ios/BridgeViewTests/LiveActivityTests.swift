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
    }
}
