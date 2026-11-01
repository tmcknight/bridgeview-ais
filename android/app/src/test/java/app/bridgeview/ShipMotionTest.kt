package app.bridgeview

import app.bridgeview.model.Position
import app.bridgeview.model.Ship
import app.bridgeview.model.ShipMotion
import app.bridgeview.model.coordinateAt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class ShipMotionTest {
    private val start = Instant.ofEpochSecond(1_000_000)

    private fun ship(latitude: Double, sog: Double = 12.0, cog: Double = 0.0, heading: Int? = null, time: Instant) = Ship(
        mmsi = 316_001_234,
        name = "TEST",
        position = Position(latitude, -82.42, sog, cog, heading, 0, time),
    )

    @Test fun easesOntoANewReportInsteadOfJumping() {
        val motion = ShipMotion()
        motion.update(listOf(ship(42.95, time = start)), start)
        val now = start.plusSeconds(5)
        val before = motion.drawn(ship(42.95, time = start), now)!!
        // The new report puts it 100 m further north than it was drawn
        val report = ship(42.95 + 100 / 111_320.0 + 5 * 12 * 1852 / 3600 / 111_320.0, time = now)
        motion.update(listOf(report), now)
        val atLanding = motion.drawn(report, now)!!
        assertEquals(before.coordinate.latitude, atLanding.coordinate.latitude, 1e-9)
        // Part way there after a second, all the way once the blend is over
        val target = report.position!!.coordinateAt(now.plusSeconds(1))
        val midway = motion.drawn(report, now.plusSeconds(1))!!
        assertTrue(midway.coordinate.latitude < target.latitude)
        assertTrue(midway.coordinate.latitude > before.coordinate.latitude)
        val end = now.plus(ShipMotion.BLEND)
        assertEquals(report.position.coordinateAt(end).latitude, motion.drawn(report, end)!!.coordinate.latitude, 1e-9)
    }

    @Test fun turnsTheShortWayRound() {
        val motion = ShipMotion()
        motion.update(listOf(ship(42.95, heading = 350, time = start)), start)
        val now = start.plusSeconds(5)
        val report = ship(42.95, heading = 10, time = now)
        motion.update(listOf(report), now)
        val course = motion.drawn(report, now.plusMillis(ShipMotion.BLEND.toMillis() / 2))!!.course!!
        assertTrue(course > 355 || course < 5)
        assertEquals(10.0, motion.drawn(report, now.plus(ShipMotion.BLEND))!!.course!!, 1e-9)
    }

    @Test fun ignoresOlderReports() {
        val motion = ShipMotion()
        val latest = ship(42.96, time = start)
        motion.update(listOf(latest), start)
        motion.update(listOf(ship(42.95, time = start.minusSeconds(30))), start.plusSeconds(5))
        assertTrue(motion.drawn(latest, start.plusSeconds(5))!!.coordinate.latitude > 42.96)
    }

    @Test fun jumpsToFarAwayReports() {
        val motion = ShipMotion()
        motion.update(listOf(ship(42.95, time = start)), start)
        val now = start.plusSeconds(5)
        val report = ship(43.0, sog = 0.0, time = now)
        motion.update(listOf(report), now)
        assertEquals(43.0, motion.drawn(report, now)!!.coordinate.latitude, 0.0)
    }

    @Test fun settlesOnceShipsStopMoving() {
        val motion = ShipMotion()
        motion.update(listOf(ship(42.95, sog = 0.0, time = start)), start)
        assertTrue(motion.isMoving(start.plusSeconds(1)))
        assertFalse(motion.isMoving(start.plus(ShipMotion.BLEND).plusSeconds(1)))
    }

    @Test fun turnsBetweenHeadings() {
        assertEquals(20.0, ShipMotion.turn(350.0, 10.0), 1e-9)
        assertEquals(-20.0, ShipMotion.turn(10.0, 350.0), 1e-9)
    }
}
