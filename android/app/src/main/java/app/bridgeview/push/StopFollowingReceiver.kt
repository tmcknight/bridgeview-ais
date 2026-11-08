package app.bridgeview.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import app.bridgeview.graph
import app.bridgeview.model.AlertPreferences

/**
 * "Stop following" on a live countdown: takes it down, and turns countdowns off
 * for that ship so the server doesn't start another (iOS: StopFollowingIntent)
 */
class StopFollowingReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val mmsi = intent.getIntExtra(EXTRA_MMSI, 0).takeIf { it != 0 } ?: return
        val prefs = context.graph.prefs
        val ships = AlertPreferences.decodeShips(prefs.liveActivityShips.value).toMutableMap()
        ships[mmsi] = false
        prefs.liveActivityShips.value = AlertPreferences.encodeShips(ships)
        // Sent by WorkManager, which carries on after this returns
        context.graph.push.preferencesChanged()
        NotificationManagerCompat.from(context).cancel(ShipNotifications.TAG_LIVE, mmsi)
    }

    companion object {
        const val EXTRA_MMSI = "mmsi"
    }
}
