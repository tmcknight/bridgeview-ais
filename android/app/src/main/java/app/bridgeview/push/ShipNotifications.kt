package app.bridgeview.push

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import app.bridgeview.MainActivity
import app.bridgeview.R
import app.bridgeview.graph
import app.bridgeview.model.AlertPreferences
import app.bridgeview.model.DeepLink
import app.bridgeview.model.Direction
import app.bridgeview.model.Lengths
import app.bridgeview.net.InstantSerializer
import app.bridgeview.ui.Format
import java.time.Duration
import java.time.Instant
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Bridge alerts, and the live countdown that stands in for the iOS Live Activity:
 * an ongoing notification counting down to the ship reaching the bridge (a Live
 * Update on Android 16), updated as the ETA moves and finished when it has passed.
 * The server sends the data (ios/API.md, "Android"); this builds the notifications.
 */
object ShipNotifications {
    const val CHANNEL_ALERTS = "bridge_alerts"
    const val CHANNEL_LIVE = "live_countdowns"

    /** A countdown nothing has ended this long after its ETA is taken down (the server gives up at 30 min) */
    private val EXPIRE_AFTER_STALE: Duration = Duration.ofMinutes(25)

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ALERTS, context.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH).apply {
                description = context.getString(R.string.channel_alerts_description)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_LIVE, context.getString(R.string.channel_live), NotificationManager.IMPORTANCE_HIGH).apply {
                description = context.getString(R.string.channel_live_description)
            },
        )
    }

    /** Whether the app may post notifications at all */
    fun notificationsAllowed(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            // A runtime permission from Android 13; before that, the switch in settings is all there is
            (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    /** Whether live countdowns can be shown (iOS: `areActivitiesEnabled`) */
    fun countdownsAllowed(context: Context): Boolean {
        if (!notificationsAllowed(context)) return false
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL_LIVE)
        return channel == null || channel.importance != NotificationManager.IMPORTANCE_NONE
    }

    /** Handles one FCM data message; false when it isn't one of ours */
    fun handle(context: Context, data: Map<String, String>): Boolean = when (data["type"]) {
        "alert" -> { alert(context, data); true }
        "activity" -> { countdown(context, data); true }
        else -> false
    }

    private fun openShip(context: Context, mmsi: Int): PendingIntent = openLink(context, DeepLink.ship(mmsi), mmsi)

    /** Opens a bridgeview:// link in the app; `requestCode` keeps each ship's links apart */
    private fun openLink(context: Context, link: String, requestCode: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, link.toUri(), context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun stopFollowing(context: Context, mmsi: Int): PendingIntent {
        val intent = Intent(context, StopFollowingReceiver::class.java)
            .putExtra(StopFollowingReceiver.EXTRA_MMSI, mmsi)
        return PendingIntent.getBroadcast(context, mmsi, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun instant(value: String?): Instant? = value?.let { runCatching { InstantSerializer.parse(it) }.getOrNull() }

    private fun base(context: Context, channel: String, mmsi: Int) =
        NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_ship)
            .setColor(ContextCompat.getColor(context, R.color.signal))
            .setContentIntent(openShip(context, mmsi))
            .setAutoCancel(true)

    /** A plain bridge alert: "ALGOMA EQUINOX in ~8 min" */
    private fun alert(context: Context, data: Map<String, String>) {
        val mmsi = data["mmsi"]?.toIntOrNull() ?: return
        val title = data["title"] ?: return
        val subtitle = data["subtitle"]
        val body = data["body"]
        val text = listOfNotNull(subtitle, body).joinToString("\n")
        val notification = base(context, CHANNEL_ALERTS, mmsi)
            .setContentTitle(title)
            .setContentText(subtitle ?: body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setGroup("bridge")
            .build()
        post(context, TAG_ALERT, mmsi, notification)
        // A plain alert replaces any countdown still showing for the ship
        NotificationManagerCompat.from(context).cancel(TAG_LIVE, mmsi)
    }

    private fun countdown(context: Context, data: Map<String, String>) {
        val mmsi = data["mmsi"]?.toIntOrNull() ?: return
        // The user stopped following this ship; the server keeps sending to phones that
        // were following until the countdown ends, which would put it back
        if (AlertPreferences.decodeShips(context.graph.prefs.liveActivityShips.value)[mmsi] == false) {
            NotificationManagerCompat.from(context).cancel(TAG_LIVE, mmsi)
            return
        }
        val name = data["name"] ?: return
        val direction = Direction.fromRaw(data["direction"])
        val phase = data["phase"] ?: "approaching"
        val event = data["event"] ?: "update"
        val eta = instant(data["eta"])
        val now = Instant.now()
        var footer: String? = null

        val details = listOfNotNull(
            data["shipTypeName"],
            data["length"]?.toDoubleOrNull()?.let { Lengths.current(context).length(it.roundToInt()) },
        ).toMutableList()
        val headline: String
        val critical: String
        val builder = base(context, CHANNEL_LIVE, mmsi)
            .setContentTitle(name)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setOnlyAlertOnce(event != "start")

        when (phase) {
            "approaching" -> {
                headline = "${direction?.label ?: "Heading"} to the Blue Water Bridge"
                data["distanceNM"]?.toDoubleOrNull()?.let { details += String.format(Locale.US, "%.1f NM", it) }
                data["sog"]?.toDoubleOrNull()?.let { details += String.format(Locale.US, "%.1f kn", it) }
                critical = if (eta != null && eta.isAfter(now)) {
                    Format.minutes(Duration.between(now, eta).toMillis() / 60_000.0)
                } else {
                    // Past the ETA and not yet logged as through: it's at the bridge
                    "Any moment"
                }
                builder.setOngoing(true)
                    .setAutoCancel(false)
                    .setRequestPromotedOngoing(true)
                if (eta != null && eta.isAfter(now)) {
                    builder.setWhen(eta.toEpochMilli())
                        .setShowWhen(true)
                        .setUsesChronometer(true)
                        .setChronometerCountDown(true)
                }
                // How far along the countdown is, as of this message
                val startedAt = instant(data["startedAt"])
                if (startedAt != null && eta != null && startedAt.isBefore(eta)) {
                    val total = Duration.between(startedAt, eta).toMillis()
                    val done = Duration.between(startedAt, now).toMillis().coerceIn(0, total)
                    builder.setProgress(PROGRESS_MAX, (done * PROGRESS_MAX / total).toInt(), false)
                }
                builder.addAction(0, "Map", openLink(context, DeepLink.map(mmsi), mmsi + MAP_REQUEST_OFFSET))
                    .addAction(0, "Ship cam", openLink(context, DeepLink.CAM, CAM_REQUEST_CODE))
                    .addAction(0, "Stop following", stopFollowing(context, mmsi))
                val stale = instant(data["staleAt"]) ?: eta?.plus(Duration.ofMinutes(5))
                stale?.let { builder.setTimeoutAfter(Duration.between(now, it.plus(EXPIRE_AFTER_STALE)).toMillis().coerceAtLeast(60_000)) }
            }
            else -> {
                val passedAt = instant(data["passedAt"])
                headline = when {
                    phase != "passed" -> "No longer heading for the bridge"
                    passedAt != null -> "Went under the bridge at ${Format.time(passedAt)}"
                    else -> "Went under the bridge"
                }
                // Words, not a dash: the status bar chip is read out by screen readers
                critical = if (phase == "passed") "Passed" else "Ended"
                data["destination"]?.let { details += "to ${Format.place(it)}" }
                val nextName = data["nextName"]
                val nextEta = instant(data["nextEta"])
                if (phase == "passed" && nextName != null && nextEta != null) {
                    footer = "Next: $nextName at ${Format.time(nextEta)}"
                }
                val dismiss = instant(data["dismissAt"]) ?: now.plus(Duration.ofMinutes(15))
                builder.setOngoing(false)
                    .setShowWhen(false)
                    .setTimeoutAfter(Duration.between(now, dismiss).toMillis().coerceAtLeast(1_000))
            }
        }

        val detailLine = details.joinToString(" · ")
        builder.setContentText(headline)
            .setSubText(detailLine.ifEmpty { null })
            .setShortCriticalText(critical)
        val bigText = buildList {
            add(headline)
            if (detailLine.isNotEmpty()) add(detailLine)
            footer?.let(::add)
            if (event == "start") data["body"]?.let(::add)
        }.joinToString("\n")
        builder.setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
        if (event == "start") data["title"]?.let { builder.setTicker(it) }

        post(context, TAG_LIVE, mmsi, builder.build())
    }

    const val TAG_LIVE = "live"
    private const val TAG_ALERT = "alert"
    private const val PROGRESS_MAX = 1000
    // PendingIntent request codes: the ship page uses the MMSI (9 digits), so the
    // map link adds this to stay apart from it, and the cam has one of its own
    private const val MAP_REQUEST_OFFSET = 1_000_000_000
    private const val CAM_REQUEST_CODE = -1

    @SuppressLint("MissingPermission")
    private fun post(context: Context, tag: String, id: Int, notification: android.app.Notification) {
        if (!notificationsAllowed(context)) return
        try {
            NotificationManagerCompat.from(context).notify(tag, id, notification)
        } catch (_: SecurityException) {
            // Permission taken away since the check
        }
    }
}
