package app.bridgeview.model

import app.bridgeview.net.ApiJson
import app.bridgeview.net.InstantSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.decodeFromJsonElement
import java.time.Instant

/**
 * A ship the user starred. Kept on the phone only: the server doesn't know them.
 * The name is the one when it was added, shown until the server's comes back.
 */
@Serializable
data class FavouriteShip(
    val mmsi: Int,
    val name: String,
    @Serializable(with = InstantSerializer::class) val addedAt: Instant,
)

/** Favourites, oldest first, stored as JSON in the app's preferences */
object Favourites {
    fun decode(text: String): List<FavouriteShip> {
        if (text.isBlank()) return emptyList()
        val array = runCatching { ApiJson.parseToJsonElement(text) as? JsonArray }.getOrNull() ?: return emptyList()
        // Anything malformed is skipped rather than losing the rest
        return array
            .mapNotNull { runCatching { ApiJson.decodeFromJsonElement<FavouriteShip>(it) }.getOrNull() }
            .filter { it.mmsi > 0 }
            .distinctBy { it.mmsi }
    }

    fun encode(favourites: List<FavouriteShip>): String =
        ApiJson.encodeToString(kotlinx.serialization.builtins.ListSerializer(FavouriteShip.serializer()), favourites)

    /** Adds the ship if it isn't a favourite, takes it off if it is */
    fun toggle(favourites: List<FavouriteShip>, mmsi: Int, name: String, now: Instant = Instant.now()): List<FavouriteShip> =
        if (favourites.any { it.mmsi == mmsi }) favourites.filter { it.mmsi != mmsi }
        else favourites + FavouriteShip(mmsi, name, now)

    /**
     * Each favourite with what the server says about it (null when it didn't
     * answer or doesn't know the ship): heard ships first, soonest at the bridge
     * first, then the rest by name
     */
    fun rows(favourites: List<FavouriteShip>, summaries: Map<Int, ShipSummary>): List<Pair<FavouriteShip, ShipSummary?>> =
        favourites.map { it to summaries[it.mmsi] }.sortedWith(
            compareBy<Pair<FavouriteShip, ShipSummary?>> { if (it.second?.heard == true) 0 else 1 }
                .thenBy { it.second?.approach?.etaMinutes ?: Double.MAX_VALUE }
                .thenBy { (it.second?.name ?: it.first.name).lowercase() },
        )
}
