package app.bridgeview.ui

import android.text.format.DateUtils
import app.bridgeview.model.Direction
import app.bridgeview.model.Ship
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.roundToInt

object Format {
    fun distance(nm: Double): String =
        if (nm < 10) String.format(Locale.US, "%.1f NM", nm) else String.format(Locale.US, "%.0f NM", nm)

    fun speed(knots: Double): String = String.format(Locale.US, "%.1f kn", knots)

    fun minutes(value: Double): String {
        val total = value.roundToInt()
        return when {
            total < 1 -> "now"
            total < 60 -> "$total min"
            else -> "${total / 60} h ${total % 60} min"
        }
    }

    /** AIS destinations are typed in capitals by the crew; show them in title case */
    fun place(text: String): String =
        text.lowercase().split(" ").joinToString(" ") { word ->
            word.replaceFirstChar { it.titlecase(Locale.getDefault()) }
        }

    /** "8:23" or "1:02:05" until `eta`, like SwiftUI's timer text */
    fun countdown(now: Instant, eta: Instant): String {
        val seconds = Duration.between(now, eta).seconds.coerceAtLeast(0)
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s) else String.format(Locale.US, "%d:%02d", m, s)
    }

    /** "2:10 PM" */
    fun time(instant: Instant): String =
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(instant)

    /** "Oct 30, 2026, 2:10 PM" */
    fun dateTime(instant: Instant): String =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(instant)

    /** "5 minutes ago" */
    fun relative(instant: Instant, now: Instant): String =
        DateUtils.getRelativeTimeSpanString(instant.toEpochMilli(), now.toEpochMilli(), DateUtils.MINUTE_IN_MILLIS).toString()

    fun whole(value: Double): String = String.format(Locale.getDefault(), "%,.0f", value)

    // Spoken forms for screen readers, where "1.6 NM", "11.2 kn" and "8:23" read badly

    /** "1.6 nautical miles" */
    fun spokenDistance(nm: Double): String {
        val value = if (nm < 10) String.format(Locale.US, "%.1f", nm) else String.format(Locale.US, "%.0f", nm)
        return "$value nautical ${if (value == "1" || value == "1.0") "mile" else "miles"}"
    }

    /** "11.2 knots" */
    fun spokenSpeed(knots: Double): String = String.format(Locale.US, "%.1f knots", knots)

    /** "now", "8 minutes" or "1 hour 5 minutes" */
    fun spokenMinutes(value: Double): String {
        val total = value.roundToInt()
        return when {
            total < 1 -> "now"
            total < 60 -> plural(total, "minute")
            total % 60 == 0 -> plural(total / 60, "hour")
            else -> "${plural(total / 60, "hour")} ${plural(total % 60, "minute")}"
        }
    }

    /** "reaches the bridge in 8 minutes, at 2:10 PM" */
    fun spokenArrival(etaMinutes: Double, eta: Instant): String {
        val minutes = spokenMinutes(etaMinutes)
        return if (minutes == "now") "at the bridge now" else "reaches the bridge in $minutes, at ${time(eta)}"
    }

    /** "north-northeast", for a course in degrees */
    fun compassPoint(degrees: Double): String {
        val points = listOf(
            "north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
            "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest",
        )
        val normalized = ((degrees % 360) + 360) % 360
        return points[((normalized / 22.5).roundToInt()) % 16]
    }

    /** "Upbound, heading north-northeast" */
    fun spokenHeading(direction: Direction?, course: Double?): String =
        listOfNotNull(direction?.label, course?.let { "heading ${compassPoint(it)}" }).joinToString(", ")

    /** "Cargo, 225 metres" (Ship.summary is "Cargo · 225 m") */
    fun spokenSummary(ship: Ship): String =
        listOfNotNull(ship.shipTypeName, ship.length?.let { "$it metres" }).joinToString(", ")

    /** "Canada", the ship's flag in words */
    fun flagCountry(ship: Ship): String? = ship.flagDescription?.substringAfter(' ')

    private fun plural(count: Int, unit: String) = if (count == 1) "1 $unit" else "$count ${unit}s"
}
