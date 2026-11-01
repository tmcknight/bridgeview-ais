package app.bridgeview

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import app.bridgeview.model.DeepLink
import app.bridgeview.ui.BridgeViewRoot
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { graph.push.refreshAuthorization() }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
        )
        handle(intent)
        // Ask for notification permission (the prompt shows the first time only)
        if (Build.VERSION.SDK_INT >= 33 && savedInstanceState == null) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent { BridgeViewRoot() }

        // Poll only while the app is in front
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                graph.push.refreshAuthorization()
                graph.nearBridge.refreshAuthorization()
                graph.push.appBecameActive()
                graph.store.poll()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        DeepLink.mmsi(intent?.data)?.let { graph.router.open(it) }
    }
}
