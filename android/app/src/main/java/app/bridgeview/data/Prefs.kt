package app.bridgeview.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import app.bridgeview.model.AlertPreferences
import app.bridgeview.model.Appearance
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The user's settings, as on iOS (same keys as AlertPreferences.Key). Each is a
 * StateFlow the UI follows; setting one saves it.
 */
class Prefs(context: Context) {
    object Key {
        const val ENABLED = "alerts.enabled"
        const val CATEGORIES = "alerts.categories"
        const val MIN_LENGTH = "alerts.minLength"
        const val DIRECTIONS = "alerts.directions"
        const val NEAR_BRIDGE_ONLY = "alerts.nearBridgeOnly"
        const val NEAR_BRIDGE_RADIUS = "alerts.nearBridgeRadius"
        const val LIVE_ACTIVITIES = "alerts.liveActivities"
        const val LIVE_ACTIVITY_SHIPS = "alerts.liveActivityShips"
        const val APPEARANCE = "appearance"
        const val PHOTO_CREDIT = "photoCreditName"
    }

    private val store: SharedPreferences = context.getSharedPreferences("bridgeview", Context.MODE_PRIVATE)
    private val defaults = AlertPreferences()

    inner class Setting<T>(
        private val key: String,
        read: SharedPreferences.() -> T,
        private val write: SharedPreferences.Editor.(T) -> Unit,
    ) {
        private val state = MutableStateFlow(store.read())
        val flow: StateFlow<T> = state.asStateFlow()
        var value: T
            get() = state.value
            set(newValue) {
                if (newValue == state.value) return
                state.value = newValue
                store.edit { write(newValue) }
            }
    }

    private fun bool(key: String, default: Boolean) =
        Setting(key, { getBoolean(key, default) }, { putBoolean(key, it) })

    private fun int(key: String, default: Int) = Setting(key, { getInt(key, default) }, { putInt(key, it) })

    private fun string(key: String, default: String) =
        Setting(key, { getString(key, default) ?: default }, { putString(key, it) })

    val enabled = bool(Key.ENABLED, defaults.enabled)
    val categories = string(Key.CATEGORIES, AlertPreferences.encodeCategories(defaults.categories))
    val minLength = int(Key.MIN_LENGTH, 0)
    val directions = string(Key.DIRECTIONS, AlertPreferences.encodeDirections(defaults.directions))
    val nearBridgeOnly = bool(Key.NEAR_BRIDGE_ONLY, false)
    val nearBridgeRadius = int(Key.NEAR_BRIDGE_RADIUS, AlertPreferences.DEFAULT_RADIUS)
    val liveActivities = bool(Key.LIVE_ACTIVITIES, true)
    val liveActivityShips = string(Key.LIVE_ACTIVITY_SHIPS, "")
    val appearance = string(Key.APPEARANCE, Appearance.System.raw)
    val photoCredit = string(Key.PHOTO_CREDIT, "")

    fun alertPreferences(): AlertPreferences = AlertPreferences(
        enabled = enabled.value,
        categories = AlertPreferences.decodeCategories(categories.value),
        minLength = minLength.value,
        directions = AlertPreferences.decodeDirections(directions.value),
        nearBridgeOnly = nearBridgeOnly.value,
        nearBridgeRadius = nearBridgeRadius.value,
        liveActivities = liveActivities.value,
        liveActivityShips = AlertPreferences.decodeShips(liveActivityShips.value),
    )

    // Internal state, not settings

    /** Inside the circle around the bridge, as last reported; null when unknown */
    var nearBridge: Boolean?
        get() = if (store.contains(NEAR_BRIDGE)) store.getBoolean(NEAR_BRIDGE, false) else null
        set(value) = store.edit { if (value == null) remove(NEAR_BRIDGE) else putBoolean(NEAR_BRIDGE, value) }

    var deviceToken: String?
        get() = store.getString(DEVICE_TOKEN, null)
        set(value) = store.edit { putString(DEVICE_TOKEN, value) }

    /** "token\nbody" of the last registration the server took, so unchanged ones aren't sent */
    var lastRegistration: String?
        get() = store.getString(LAST_REGISTRATION, null)
        set(value) = store.edit { putString(LAST_REGISTRATION, value) }

    var lastRegistrationError: String?
        get() = store.getString(LAST_REGISTRATION_ERROR, null)
        set(value) = store.edit { putString(LAST_REGISTRATION_ERROR, value) }

    val raw: SharedPreferences get() = store

    private companion object {
        const val NEAR_BRIDGE = "nearBridge.last"
        const val DEVICE_TOKEN = "push.deviceToken"
        const val LAST_REGISTRATION = "push.lastRegistration"
        const val LAST_REGISTRATION_ERROR = "push.lastRegistrationError"
    }
}
