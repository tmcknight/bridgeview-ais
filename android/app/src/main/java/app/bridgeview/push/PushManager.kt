package app.bridgeview.push

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import app.bridgeview.AppConfig
import app.bridgeview.BuildConfig
import app.bridgeview.data.Prefs
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.TimeUnit

/**
 * Registers this device for bridge alerts: collects the FCM token and sends it
 * with the user's alert preferences to the server ([RegistrationWorker], which
 * tries again when offline). Mirrors PushManager.swift.
 */
class PushManager(private val context: Context, private val prefs: Prefs) {
    private val _notificationsAllowed = MutableStateFlow(ShipNotifications.notificationsAllowed(context))
    /** Whether the app may post notifications (iOS: authorization) */
    val notificationsAllowed: StateFlow<Boolean> = _notificationsAllowed.asStateFlow()

    private val _countdownsAllowed = MutableStateFlow(ShipNotifications.countdownsAllowed(context))
    /** Whether live countdowns can be shown (iOS: liveActivitiesEnabled) */
    val countdownsAllowed: StateFlow<Boolean> = _countdownsAllowed.asStateFlow()

    private val _lastRegistrationError = MutableStateFlow(prefs.lastRegistrationError)
    val lastRegistrationError: StateFlow<String?> = _lastRegistrationError.asStateFlow()

    // Kept as a field: SharedPreferences holds listeners weakly
    private val errorListener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
        _lastRegistrationError.value = prefs.lastRegistrationError
    }

    init {
        ShipNotifications.createChannels(context)
        prefs.raw.registerOnSharedPreferenceChangeListener(errorListener)
    }

    /** Sets up Firebase (from BuildConfig, no google-services.json) and asks for the token */
    fun start() {
        if (!AppConfig.hasFirebase) {
            Log.i(TAG, "No Firebase project in this build: bridge alerts are off")
            return
        }
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        val messaging = FirebaseMessaging.getInstance()
        messaging.isAutoInitEnabled = true
        // The token arrives in MessagingService.onRegistered (and again whenever it changes);
        // the one from last time is sent meanwhile, in case anything changed while closed
        prefs.deviceToken?.let { scheduleRegistration(immediately = true) }
        messaging.register()
            .addOnFailureListener { error ->
                Log.e(TAG, "FCM registration failed", error)
                prefs.lastRegistrationError = error.localizedMessage
            }
    }

    /** FCM dropped this install's token: alerts can't reach it until a new one comes */
    fun didUnregister() {
        prefs.deviceToken = null
        prefs.lastRegistration = null
    }

    fun refreshAuthorization() {
        val notifications = ShipNotifications.notificationsAllowed(context)
        val countdowns = ShipNotifications.countdownsAllowed(context)
        val changed = notifications != _notificationsAllowed.value || countdowns != _countdownsAllowed.value
        _notificationsAllowed.value = notifications
        _countdownsAllowed.value = countdowns
        if (changed) scheduleRegistration(immediately = true)
    }

    fun didRegister(token: String) {
        prefs.deviceToken = token
        scheduleRegistration(immediately = true)
    }

    /** Settings changed; send them after the user stops fiddling */
    fun preferencesChanged() = scheduleRegistration(immediately = false)

    /** The phone came near the bridge or left (alerts pause while it's away) */
    fun nearBridgeChanged() = scheduleRegistration(immediately = true)

    /** The app came to the front: send anything that didn't get through */
    fun appBecameActive() = scheduleRegistration(immediately = true)

    private fun scheduleRegistration(immediately: Boolean) {
        if (prefs.deviceToken == null) return
        val request = OneTimeWorkRequestBuilder<RegistrationWorker>()
            .setInitialDelay(if (immediately) 0 else 1, TimeUnit.SECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .build()
        // A newer change replaces one waiting; it sends the latest settings itself
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
    }

    private companion object {
        const val TAG = "BridgeViewPush"
        const val WORK_NAME = "register-for-alerts"
    }
}
