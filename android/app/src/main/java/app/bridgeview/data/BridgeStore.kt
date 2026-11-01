package app.bridgeview.data

import app.bridgeview.model.BridgeSnapshot
import app.bridgeview.net.ApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlin.coroutines.coroutineContext

/**
 * Ships heading for the bridge and ships that went under it lately, polled from
 * the server while the app is on screen
 */
class BridgeStore(private val api: ApiClient, private val describe: (Throwable) -> String) {
    companion object {
        const val POLL_INTERVAL_MS = 30_000L
    }

    private val _snapshot = MutableStateFlow<BridgeSnapshot?>(null)
    val snapshot: StateFlow<BridgeSnapshot?> = _snapshot.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()
    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    /** Poll until the calling coroutine is cancelled */
    suspend fun poll() {
        while (coroutineContext.isActive) {
            refresh()
            delay(POLL_INTERVAL_MS)
        }
    }

    suspend fun refresh() {
        _isLoading.value = true
        try {
            _snapshot.value = api.bridge()
            _error.value = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _error.value = describe(e)
        } finally {
            _isLoading.value = false
        }
    }
}
