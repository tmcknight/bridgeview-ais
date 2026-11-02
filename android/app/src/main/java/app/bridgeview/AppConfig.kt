package app.bridgeview

/** Build settings from local.properties or the environment (see android/README.md) */
object AppConfig {
    /** Root of the BridgeView server, e.g. https://bridgeview.example.com (no trailing slash) */
    val apiUrl: String = BuildConfig.API_URL.trimEnd('/')

    fun page(path: String): String = "$apiUrl/$path"

    /** Wikimedia refuses generic user agents (like OkHttp's), so photos need one that says who's asking */
    val userAgent: String = "BridgeViewAndroid/${BuildConfig.VERSION_NAME} (https://github.com/tmcknight/bridgeview-ais)"

    /** Whether this build was given a Firebase project, which bridge alerts need */
    val hasFirebase: Boolean
        get() = BuildConfig.FIREBASE_APP_ID.isNotEmpty() &&
            BuildConfig.FIREBASE_API_KEY.isNotEmpty() &&
            BuildConfig.FIREBASE_PROJECT_ID.isNotEmpty() &&
            BuildConfig.FIREBASE_SENDER_ID.isNotEmpty()
}
