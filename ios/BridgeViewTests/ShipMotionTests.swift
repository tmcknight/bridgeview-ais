import Foundation
import Testing
@testable import BridgeView

struct ShipMotionTests {
    let start = Date(timeIntervalSince1970: 1_000_000)

    func ship(latitude: Double, sog: Double = 12, cog: Double = 0, heading: Int? = nil, time: Date) -> Ship {
        Ship(
            mmsi: 316_001_234, name: "TEST",
            position: Position(latitude: latitude, longitude: -82.42, sog: sog, cog: cog, heading: heading, navStatus: 0, time: time)
        )
    }

    @Test func easesOntoANewReportInsteadOfJumping() throws {
        var motion = ShipMotion()
        motion.update([ship(latitude: 42.95, time: start)], at: start)
        let now = start.addingTimeInterval(5)
        let before = try #require(motion.drawn(ship(latitude: 42.95, time: start), at: now))

        // The new report puts it 100 m further north than it was drawn
        let report = ship(latitude: 42.95 + 100 / 111_320.0 + 5 * 12 * 1852 / 3600 / 111_320.0, time: now)
        motion.update([report], at: now)
        let atLanding = try #require(motion.drawn(report, at: now))
        #expect(abs(atLanding.coordinate.latitude - before.coordinate.latitude) < 1e-9)

        // Part way there after a second, all the way once the blend is over
        let target = report.position!.coordinate(at: now.addingTimeInterval(1))
        let midway = try #require(motion.drawn(report, at: now.addingTimeInterval(1)))
        #expect(midway.coordinate.latitude < target.latitude)
        #expect(midway.coordinate.latitude > before.coordinate.latitude)
        let done = try #require(motion.drawn(report, at: now.addingTimeInterval(ShipMotion.blend)))
        let reckoned = report.position!.coordinate(at: now.addingTimeInterval(ShipMotion.blend))
        #expect(abs(done.coordinate.latitude - reckoned.latitude) < 1e-9)
    }

    @Test func turnsTheShortWayRound() throws {
        var motion = ShipMotion()
        motion.update([ship(latitude: 42.95, heading: 350, time: start)], at: start)
        let now = start.addingTimeInterval(5)
        let report = ship(latitude: 42.95, heading: 10, time: now)
        motion.update([report], at: now)
        let midway = try #require(motion.drawn(report, at: now.addingTimeInterval(ShipMotion.blend / 2)))
        let course = try #require(midway.course)
        #expect(course > 355 || course < 5)
        #expect(motion.drawn(report, at: now.addingTimeInterval(ShipMotion.blend))?.course == 10)
    }

    @Test func ignoresOlderReports() throws {
        var motion = ShipMotion()
        let latest = ship(latitude: 42.96, time: start)
        motion.update([latest], at: start)
        motion.update([ship(latitude: 42.95, time: start.addingTimeInterval(-30))], at: start.addingTimeInterval(5))
        let drawn = try #require(motion.drawn(latest, at: start.addingTimeInterval(5)))
        #expect(drawn.coordinate.latitude > 42.96)
    }

    @Test func jumpsToFarAwayReports() throws {
        var motion = ShipMotion()
        motion.update([ship(latitude: 42.95, time: start)], at: start)
        let now = start.addingTimeInterval(5)
        let report = ship(latitude: 43.0, sog: 0, time: now)
        motion.update([report], at: now)
        #expect(motion.drawn(report, at: now)?.coordinate.latitude == 43.0)
    }

    @Test func settlesOnceShipsStopMoving() {
        var motion = ShipMotion()
        motion.update([ship(latitude: 42.95, sog: 0, time: start)], at: start)
        #expect(motion.isMoving(at: start.addingTimeInterval(1)))
        #expect(!motion.isMoving(at: start.addingTimeInterval(ShipMotion.blend + 1)))
    }
}
