package app.bridgeview.push

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.bridgeview.graph
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Geofences are cleared when the phone restarts or the app is updated; add the bridge's back */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val pending = goAsync()
        val graph = context.graph
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try {
                graph.nearBridge.update(graph.prefs.alertPreferences())
            } finally {
                pending.finish()
            }
        }
    }
}
