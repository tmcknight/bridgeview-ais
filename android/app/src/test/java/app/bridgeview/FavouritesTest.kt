package app.bridgeview

import app.bridgeview.model.Approach
import app.bridgeview.model.Direction
import app.bridgeview.model.FavouriteShip
import app.bridgeview.model.Favourites
import app.bridgeview.model.ShipSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class FavouritesTest {
    private val now = Instant.parse("2026-11-09T12:00:00Z")

    @Test fun roundTripsThroughJson() {
        val favourites = Favourites.toggle(emptyList(), 316001234, "ALGOMA EQUINOX", now)
        assertEquals(favourites, Favourites.decode(Favourites.encode(favourites)))
    }

    @Test fun skipsMalformedEntries() {
        assertTrue(Favourites.decode("").isEmpty())
        assertTrue(Favourites.decode("not json").isEmpty())
        assertTrue(Favourites.decode("""{"mmsi":1}""").isEmpty())
        val decoded = Favourites.decode(
            """[{"mmsi":1,"name":"ONE","addedAt":"2026-01-01T00:00:00Z"},{"mmsi":"x"},null,""" +
                """{"mmsi":-2,"name":"NO","addedAt":"2026-01-01T00:00:00Z"},{"mmsi":1,"name":"AGAIN","addedAt":"2026-01-01T00:00:00Z"}]""",
        )
        assertEquals(listOf(1), decoded.map { it.mmsi })
        assertEquals("ONE", decoded.single().name)
    }

    @Test fun togglesOnAndOff() {
        val added = Favourites.toggle(emptyList(), 5, "FIVE", now)
        assertEquals(listOf(FavouriteShip(5, "FIVE", now)), added)
        assertTrue(Favourites.toggle(added, 5, "FIVE", now).isEmpty())
    }

    @Test fun listsHeardShipsFirstSoonestFirstThenByName() {
        val favourites = listOf(
            FavouriteShip(1, "ZULU", now),
            FavouriteShip(2, "alpha", now),
            FavouriteShip(3, "HEARD LATER", now),
            FavouriteShip(4, "HEARD SOON", now),
        )
        fun approach(minutes: Double) = Approach(minutes, now, 1.0, Direction.Upbound)
        val summaries = mapOf(
            1 to ShipSummary(1, "ZULU"),
            3 to ShipSummary(3, "HEARD LATER", heard = true),
            4 to ShipSummary(4, "HEARD SOON", heard = true, approach = approach(12.0)),
        )
        assertEquals(listOf(4, 3, 2, 1), Favourites.rows(favourites, summaries).map { it.first.mmsi })
    }
}
