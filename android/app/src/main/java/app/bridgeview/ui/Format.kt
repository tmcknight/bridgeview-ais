package app.bridgeview.ui

import android.text.format.DateUtils
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
}
