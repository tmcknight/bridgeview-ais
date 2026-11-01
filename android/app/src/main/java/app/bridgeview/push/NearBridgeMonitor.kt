package app.bridgeview.push

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import app.bridgeview.data.Prefs
import app.bridgeview.model.AlertPreferences
import app.bridgeview.model.Bridge
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await

/**
 * Whether this phone is near the bridge, for "only near the bridge" alerts.
 *
 * Watches a circle around the bridge with a geofence, so Android wakes the app
 * (even when it isn't running) when the phone goes in or out. The location never
 * leaves the phone: [PushManager] only turns the device's `enabled` off while it's
 * away. Needs location access "all the time"; without it, or before the first
 * reading, the answer is null and alerts aren't held back. Mirrors NearBridgeMonitor.swift.
 */
class NearBridgeMonitor(private val context: Context, private val prefs: Prefs) {
    enum class Authorization { NotDetermined, Denied, WhenInUse, Always }

    private val _authorization = MutableStateFlow(readAuthorization())
    val authorization: StateFlow<Authorization> = _authorization.asStateFlow()

    private val _isNear = MutableStateFlow(prefs.nearBridge)
    /** Inside the circle, as last reported; null when unknown */
    val isNear: StateFlow<Boolean?> = _isNear.asStateFlow()

    /** Called when [effectiveIsNear] may have changed */
    var onChange: (() -> Unit)? = null

    private val client by lazy { LocationServices.getGeofencingClient(context) }
    /** Each settings change waits for the one before, so a quick off-and-on can't remove the circle after it was added back */
    private val updating = Mutex()

    /** What alerts should go by: null unless location can be watched in the background */
    fun effectiveIsNear(): Boolean? = if (readAuthorization() == Authorization.Always) prefs.nearBridge else null

    /** The user was asked for location access (so "not granted" now means denied) */
    fun markAsked() {
        context.getSharedPreferences("bridgeview", Context.MODE_PRIVATE).edit { putBoolean(ASKED, true) }
    }

    fun readAuthorization(): Authorization {
        fun granted(permission: String) =
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
        val foreground = granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)
        return when {
            foreground && granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION) -> Authorization.Always
            foreground -> Authorization.WhenInUse
            context.getSharedPreferences("bridgeview", Context.MODE_PRIVATE).getBoolean(ASKED, false) -> Authorization.Denied
            else -> Authorization.NotDetermined
        }
    }

    /** Permissions may have changed (back from the permission prompt or system settings) */
    suspend fun refreshAuthorization() {
        val status = readAuthorization()
        if (status == _authorization.value) return
        _authorization.value = status
        onChange?.invoke()
        // A circle can only be added with background access; add it now that it can
        if (status == Authorization.Always) update(prefs.alertPreferences())
    }

    /**
     * Start, move or stop watching to match the alert settings. Called at launch
     * and after a restart too: geofences don't survive a reboot.
     */
    suspend fun update(preferences: AlertPreferences) = updating.withLock { apply(preferences) }

    @SuppressLint("MissingPermission")
    private suspend fun apply(preferences: AlertPreferences) {
        if (!preferences.enabled || !preferences.nearBridgeOnly) {
            runCatching { client.removeGeofences(listOf(REQUEST_ID)).await() }
            setNear(null)
            return
        }
        if (readAuthorization() != Authorization.Always) return
        val radius = preferences.nearBridgeRadius * 1000f
        val geofence = Geofence.Builder()
            .setRequestId(REQUEST_ID)
            .setCircularRegion(Bridge.LATITUDE, Bridge.LONGITUDE, radius)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()
        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(geofence)
            .build()
        try {
            // Adding under the same ID replaces the old circle
            client.addGeofences(request, pendingIntent()).await()
            // The geofence only reports going in at first; work out "away" from where the phone is now
            val location = LocationServices.getFusedLocationProviderClient(context)
                .getCurrentLocation(
                    CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_BALANCED_POWER_ACCURACY).build(),
                    null,
                ).await()
            if (location != null) setNear(distanceToBridge(location) <= radius)
        } catch (e: Exception) {
            Log.e(TAG, "Couldn't watch the area around the bridge", e)
        }
    }

    /** A crossing from [GeofenceReceiver] */
    fun handleTransition(transition: Int) {
        when (transition) {
            Geofence.GEOFENCE_TRANSITION_ENTER, Geofence.GEOFENCE_TRANSITION_DWELL -> setNear(true)
            Geofence.GEOFENCE_TRANSITION_EXIT -> setNear(false)
        }
    }

    private fun setNear(near: Boolean?) {
        if (near == prefs.nearBridge && near == _isNear.value) return
        prefs.nearBridge = near
        _isNear.value = near
        onChange?.invoke()
    }

    private fun distanceToBridge(location: Location): Float {
        val result = FloatArray(1)
        Location.distanceBetween(location.latitude, location.longitude, Bridge.LATITUDE, Bridge.LONGITUDE, result)
        return result[0]
    }

    private fun pendingIntent(): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, GeofenceReceiver::class.java),
        // Mutable: the system adds the geofencing event to it
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )

    private companion object {
        const val TAG = "BridgeViewLocation"
        const val REQUEST_ID = "bridge"
        const val ASKED = "location.asked"
    }
}
