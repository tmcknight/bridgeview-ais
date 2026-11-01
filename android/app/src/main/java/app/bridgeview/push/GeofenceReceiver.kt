package app.bridgeview.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.bridgeview.graph
import com.google.android.gms.location.GeofencingEvent

/** The phone went into or out of the circle around the bridge */
class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) return
        context.graph.nearBridge.handleTransition(event.geofenceTransition)
    }
}
