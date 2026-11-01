package app.bridgeview.push

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import app.bridgeview.graph
import app.bridgeview.model.DeviceRegistration
import app.bridgeview.net.ApiError
import app.bridgeview.net.ApiJson
import kotlinx.coroutines.CancellationException

/**
 * Sends the device's registration if it changed. Failures (offline, the server
 * restarting) are tried again a few times, so the server isn't left on old
 * settings, such as alerts paused.
 */
class RegistrationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = applicationContext.graph
        val prefs = graph.prefs
        val token = prefs.deviceToken ?: return Result.success()
        val body = DeviceRegistration.from(
            preferences = prefs.alertPreferences(),
            nearBridge = graph.nearBridge.effectiveIsNear(),
            countdownsAllowed = ShipNotifications.countdownsAllowed(applicationContext),
        )
        val signature = "$token\n${ApiJson.encodeToString(DeviceRegistration.serializer(), body)}"
        if (prefs.lastRegistration == signature) return Result.success()
        return try {
            graph.api.register(token, body)
            prefs.lastRegistration = signature
            prefs.lastRegistrationError = null
            Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.e("BridgeViewPush", "Device registration failed", e)
            prefs.lastRegistrationError = ApiError.message(e, graph.isOnline())
            when {
                // The server refused this body: sending it again won't help
                e is ApiError.NotFound -> Result.success()
                e is ApiError.Status && e.code in 400..499 && e.code != 429 -> Result.success()
                runAttemptCount < MAX_ATTEMPTS -> Result.retry()
                else -> Result.failure()
            }
        }
    }

    private companion object {
        const val MAX_ATTEMPTS = 5
    }
}
