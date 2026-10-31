import Foundation
import Testing
@testable import BridgeView

struct DeadReckoningTests {
    let reported = Date(timeIntervalSince1970: 1_000_000)

    func position(sog: Double?, cog: Double?, navStatus: Int? = 0) -> Position {
        Position(latitude: 42.95, longitude: -82.42, sog: sog, cog: cog, heading: nil, navStatus: navStatus, time: reported)
    }

    @Test func movesShipsAlongTheirCourse() {
        // 12 kn north for a minute: 0.2 NM, 370.4 m
        let moved = position(sog: 12, cog: 0).coordinate(at: reported.addingTimeInterval(60))
        #expect(abs((moved.latitude - 42.95) * 111_320 - 370.4) < 0.5)
        #expect(moved.longitude == -82.42)
        let east = position(sog: 12, cog: 90).coordinate(at: reported.addingTimeInterval(60))
        #expect(east.longitude > -82.42)
        #expect(abs(east.latitude - 42.95) < 1e-9)
    }

    @Test func stopsAfterThreeMinutes() {
        let atLimit = position(sog: 12, cog: 0).coordinate(at: reported.addingTimeInterval(180))
        let later = position(sog: 12, cog: 0).coordinate(at: reported.addingTimeInterval(600))
        #expect(atLimit.latitude == later.latitude)
    }

    @Test func leavesStoppedShipsWhereTheyAre() {
        let later = reported.addingTimeInterval(60)
        #expect(position(sog: 0.2, cog: 0).coordinate(at: later).latitude == 42.95)
        #expect(position(sog: 12, cog: 360).coordinate(at: later).latitude == 42.95)
        #expect(position(sog: 12, cog: 0, navStatus: 5).coordinate(at: later).latitude == 42.95)
        #expect(position(sog: nil, cog: 0).coordinate(at: later).latitude == 42.95)
        // A report "from the future" (clock skew) isn't moved backwards
        #expect(position(sog: 12, cog: 0).coordinate(at: reported.addingTimeInterval(-30)).latitude == 42.95)
    }
}
