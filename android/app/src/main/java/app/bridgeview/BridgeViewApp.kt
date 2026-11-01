package app.bridgeview

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import app.bridgeview.data.BridgeStore
import app.bridgeview.data.Prefs
import app.bridgeview.data.Router
import app.bridgeview.net.ApiClient
import app.bridgeview.net.ApiError
import app.bridgeview.net.DeviceId
import app.bridgeview.push.NearBridgeMonitor
import app.bridgeview.push.PushManager
import app.bridgeview.sensors.Compass
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** The app's shared objects, made once per process */
class BridgeViewApp : Application() {
    lateinit var prefs: Prefs; private set
    lateinit var api: ApiClient; private set
    lateinit var store: BridgeStore; private set
    lateinit var push: PushManager; private set
    lateinit var nearBridge: NearBridgeMonitor; private set
    lateinit var compass: Compass; private set
    val router = Router()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        api = ApiClient(deviceId = { DeviceId.current(this) })
        store = BridgeStore(api) { describe(it) }
        nearBridge = NearBridgeMonitor(this, prefs)
        push = PushManager(this, prefs)
        compass = Compass(this)
        nearBridge.onChange = { push.nearBridgeChanged() }
        // Android may start the app in the background for a crossing or an alert:
        // pick the geofence back up, and get the token to send the change with
        scope.launch { nearBridge.update(prefs.alertPreferences()) }
        push.start()
    }

    /** Whether the phone has a network at all */
    fun isOnline(): Boolean {
        val manager = getSystemService(ConnectivityManager::class.java) ?: return true
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    fun describe(error: Throwable): String = ApiError.message(error, isOnline())
}

val Context.graph: BridgeViewApp get() = applicationContext as BridgeViewApp
