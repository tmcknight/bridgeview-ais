package app.bridgeview.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Why a photo is reported (REPORT_REASONS in server/photo-reports.js) */
@Serializable
enum class PhotoReportReason(val label: String) {
    @SerialName("wrong-ship") WrongShip("It's not this ship"),
    @SerialName("offensive") Offensive("It's offensive or inappropriate"),
    @SerialName("privacy") Privacy("It shows someone or something private"),
    @SerialName("copyright") Copyright("It's my photo, used without permission"),
    @SerialName("other") Other("Something else"),
}

/** POST /api/ships/:mmsi/photos/report */
@Serializable
data class PhotoReport(val url: String, val reason: PhotoReportReason, val details: String? = null)
