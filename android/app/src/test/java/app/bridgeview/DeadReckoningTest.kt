package app.bridgeview

import app.bridgeview.model.Position
import app.bridgeview.model.coordinateAt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import kotlin.math.abs

class DeadReckoningTest {
    private val reported = Instant.ofEpochSecond(1_000_000)

    private fun position(sog: Double?, cog: Double?, navStatus: Int? = 0) =
        Position(42.95, -82.42, sog, cog, null, navStatus, reported)

    @Test fun movesShipsAlongTheirCourse() {
        // 12 kn north for a minute: 0.2 NM, 370.4 m
        val moved = position(12.0, 0.0).coordinateAt(reported.plusSeconds(60))
        assertTrue(abs((moved.latitude - 42.95) * 111_320 - 370.4) < 0.5)
        assertEquals(-82.42, moved.longitude, 1e-12)
        val east = position(12.0, 90.0).coordinateAt(reported.plusSeconds(60))
        assertTrue(east.longitude > -82.42)
        assertEquals(42.95, east.latitude, 1e-9)
    }

    @Test fun stopsAfterThreeMinutes() {
        val atLimit = position(12.0, 0.0).coordinateAt(reported.plusSeconds(180))
        val later = position(12.0, 0.0).coordinateAt(reported.plusSeconds(600))
        assertEquals(atLimit.latitude, later.latitude, 0.0)
    }

    @Test fun leavesStoppedShipsWhereTheyAre() {
        val later = reported.plusSeconds(60)
        assertEquals(42.95, position(0.2, 0.0).coordinateAt(later).latitude, 0.0)
        assertEquals(42.95, position(12.0, 360.0).coordinateAt(later).latitude, 0.0)
        assertEquals(42.95, position(12.0, 0.0, navStatus = 5).coordinateAt(later).latitude, 0.0)
        assertEquals(42.95, position(null, 0.0).coordinateAt(later).latitude, 0.0)
        // A report "from the future" (clock skew) isn't moved backwards
        assertEquals(42.95, position(12.0, 0.0).coordinateAt(reported.minusSeconds(30)).latitude, 0.0)
    }

    @Test fun pointsAlongHeadingElseCourse() {
        assertEquals(3.0, Position(0.0, 0.0, 1.0, 90.0, 3, 0, reported).course!!, 0.0)
        assertEquals(90.0, Position(0.0, 0.0, 1.0, 90.0, 511, 0, reported).course!!, 0.0)
        assertEquals(null, Position(0.0, 0.0, 1.0, 360.0, 511, 0, reported).course)
    }
}
