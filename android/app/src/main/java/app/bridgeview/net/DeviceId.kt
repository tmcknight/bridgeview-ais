package app.bridgeview.net

import android.content.Context
import androidx.core.content.edit
import java.util.UUID

/**
 * A random ID for this install, sent with shared photos so a sender can be banned
 * (there are no accounts). It says nothing about the phone or its owner. Kept in
 * preferences, which Android's backup carries over to a new phone or a reinstall.
 */
object DeviceId {
    private const val KEY = "deviceId"

    @Volatile private var cached: String? = null

    fun current(context: Context): String = cached ?: synchronized(this) {
        cached ?: run {
            val store = context.getSharedPreferences("bridgeview.device", Context.MODE_PRIVATE)
            val id = store.getString(KEY, null) ?: UUID.randomUUID().toString().lowercase().also {
                store.edit { putString(KEY, it) }
            }
            cached = id
            id
        }
    }
}
