package app.bridgeview.model

import android.net.Uri

object DeepLink {
    const val SCHEME = "bridgeview"

    fun ship(mmsi: Int): String = "$SCHEME://ship/$mmsi"

    /** The MMSI in a `bridgeview://ship/<mmsi>` link */
    fun mmsi(uri: Uri?): Int? = mmsi(uri?.scheme, uri?.host, uri?.lastPathSegment)

    fun mmsi(scheme: String?, host: String?, last: String?): Int? {
        if (scheme != SCHEME || host != "ship") return null
        return last?.toIntOrNull()
    }
}
