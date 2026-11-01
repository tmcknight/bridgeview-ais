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
import app.bridgeview.model.DeepLink
import app.bridgeview.model.Direction
import app.bridgeview.net.InstantSerializer
import app.bridgeview.ui.Format
import java.time.Duration
import java.time.Instant
import java.util.Locale

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

    private fun openShip(context: Context, mmsi: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW, DeepLink.ship(mmsi).toUri(), context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, mmsi, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

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
        val name = data["name"] ?: return
        val direction = Direction.fromRaw(data["direction"])
        val phase = data["phase"] ?: "approaching"
        val event = data["event"] ?: "update"
        val eta = data["eta"]?.let { runCatching { InstantSerializer.parse(it) }.getOrNull() }
        val now = Instant.now()

        val details = listOfNotNull(
            data["shipTypeName"],
            data["length"]?.let { "$it m" },
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
                    "Now"
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
                val stale = data["staleAt"]?.let { runCatching { InstantSerializer.parse(it) }.getOrNull() }
                    ?: eta?.plus(Duration.ofMinutes(5))
                stale?.let { builder.setTimeoutAfter(Duration.between(now, it.plus(EXPIRE_AFTER_STALE)).toMillis().coerceAtLeast(60_000)) }
            }
            else -> {
                headline = if (phase == "passed") "Went under the bridge" else "No longer heading for the bridge"
                critical = if (phase == "passed") "Passed" else "—"
                data["destination"]?.let { details += "to ${Format.place(it)}" }
                val dismiss = data["dismissAt"]?.let { runCatching { InstantSerializer.parse(it) }.getOrNull() }
                    ?: now.plus(Duration.ofMinutes(15))
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
            if (event == "start") data["body"]?.let(::add)
        }.joinToString("\n")
        builder.setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
        if (event == "start") data["title"]?.let { builder.setTicker(it) }

        post(context, TAG_LIVE, mmsi, builder.build())
    }

    private const val TAG_LIVE = "live"
    private const val TAG_ALERT = "alert"

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
