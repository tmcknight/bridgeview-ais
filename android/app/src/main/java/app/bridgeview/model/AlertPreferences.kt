package app.bridgeview.model

import kotlinx.serialization.Serializable

/** What the user wants to be alerted about; stored in preferences ([app.bridgeview.data.Prefs]) */
data class AlertPreferences(
    val enabled: Boolean = true,
    val categories: Set<ShipCategory> = ShipCategory.defaultAlerts,
    val minLength: Int = 0,
    val directions: Set<Direction> = Direction.entries.toSet(),
    /**
     * Only alert while this phone is within [nearBridgeRadius] km of the bridge.
     * Worked out on the phone; the server only sees `enabled` turn off and on.
     */
    val nearBridgeOnly: Boolean = false,
    val nearBridgeRadius: Int = DEFAULT_RADIUS,
    /**
     * Follow ships with a live countdown notification, not just an alert, unless
     * [liveActivityShips] says otherwise for a ship (iOS: Live Activities)
     */
    val liveActivities: Boolean = true,
    /** MMSI -> live countdown on or off, for ships the user chose one by one */
    val liveActivityShips: Map<Int, Boolean> = emptyMap(),
) {
    companion object {
        val lengthOptions = listOf(0, 100, 150, 200)
        val radiusOptions = listOf(2, 5, 10, 25)
        const val DEFAULT_RADIUS = 5

        /** Per-ship choices are stored as "mmsi:1,mmsi:0", as on iOS */
        fun decodeShips(text: String): Map<Int, Boolean> = buildMap {
            for (pair in text.split(",")) {
                val parts = pair.split(":")
                if (parts.size != 2) continue
                val mmsi = parts[0].toIntOrNull() ?: continue
                put(mmsi, parts[1] == "1")
            }
        }

        fun encodeShips(ships: Map<Int, Boolean>): String =
            ships.keys.sorted().joinToString(",") { "$it:${if (ships[it] == true) 1 else 0}" }

        fun encodeCategories(set: Set<ShipCategory>): String =
            ShipCategory.entries.filter { it in set }.joinToString(",") { it.raw }

        fun decodeCategories(text: String): Set<ShipCategory> =
            text.split(",").mapNotNull(ShipCategory::fromRaw).toSet()

        fun encodeDirections(set: Set<Direction>): String =
            Direction.entries.filter { it in set }.joinToString(",") { it.raw }

        fun decodeDirections(text: String): Set<Direction> =
            text.split(",").mapNotNull(Direction::fromRaw).toSet()
    }
}

/** PUT /api/devices/:token body (ios/API.md, "Android") */
@Serializable
data class DeviceRegistration(
    val platform: String = "android",
    /** Checked by the server, ignored by FCM */
    val environment: String = "production",
    val enabled: Boolean,
    val liveActivities: Boolean,
    val categories: List<ShipCategory>,
    val minLength: Int,
    val directions: List<Direction>,
    /** Per-ship choices, by MMSI; null when there are none or countdowns can't be shown */
    val liveActivityShips: Map<String, Boolean>? = null,
) {
    companion object {
        /**
         * `nearBridge`: whether the phone is near the bridge, null when unknown
         * (location off or not yet worked out), which doesn't hold alerts back.
         * `countdownsAllowed`: whether Android lets the app post live countdowns
         * (notifications and their channel on); the user can still turn them off.
         */
        fun from(
            preferences: AlertPreferences,
            nearBridge: Boolean? = null,
            countdownsAllowed: Boolean,
        ): DeviceRegistration {
            // The server takes only 9-digit MMSIs, refusing the whole registration
            // otherwise, and some transponders send malformed ones
            val ships = preferences.liveActivityShips.filterKeys { it in 100_000_000..999_999_999 }
            return DeviceRegistration(
                enabled = preferences.enabled && (!preferences.nearBridgeOnly || nearBridge != false),
                liveActivities = countdownsAllowed && preferences.liveActivities,
                // Sorted so the body is stable and easy to compare
                categories = ShipCategory.entries.filter { it in preferences.categories },
                minLength = preferences.minLength,
                directions = Direction.entries.filter { it in preferences.directions },
                // The server takes up to 50; only ships coming up are kept, so this is plenty
                liveActivityShips = if (countdownsAllowed && ships.isNotEmpty()) {
                    ships.toSortedMap().entries.take(50).associate { (mmsi, on) -> mmsi.toString() to on }
                } else {
                    null
                },
            )
        }
    }
}
