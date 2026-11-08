package app.bridgeview.model

import android.net.Uri

object DeepLink {
    const val SCHEME = "bridgeview"

    /** Where a link goes in the app */
    sealed interface Target {
        /** The ship's page */
        data class Ship(val mmsi: Int) : Target

        /** The map, on the ship */
        data class Map(val mmsi: Int) : Target

        /** The Port Huron ship cam */
        data object Cam : Target
    }

    fun ship(mmsi: Int): String = "$SCHEME://ship/$mmsi"

    fun map(mmsi: Int): String = "$SCHEME://map/$mmsi"

    const val CAM = "$SCHEME://cam"

    /** The MMSI in a `bridgeview://ship/<mmsi>` link */
    fun mmsi(uri: Uri?): Int? = mmsi(uri?.scheme, uri?.host, uri?.lastPathSegment)

    fun mmsi(scheme: String?, host: String?, last: String?): Int? =
        (target(scheme, host, last) as? Target.Ship)?.mmsi

    fun target(uri: Uri?): Target? = target(uri?.scheme, uri?.host, uri?.lastPathSegment)

    fun target(scheme: String?, host: String?, last: String?): Target? {
        if (scheme != SCHEME) return null
        return when (host) {
            "ship" -> last?.toIntOrNull()?.let { Target.Ship(it) }
            "map" -> last?.toIntOrNull()?.let { Target.Map(it) }
            "cam" -> Target.Cam
            else -> null
        }
    }
}
