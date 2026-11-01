package app.bridgeview.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.runtime.saveable.listSaver
import app.bridgeview.data.Router
import app.bridgeview.graph
import app.bridgeview.model.AlertPreferences
import app.bridgeview.model.Appearance

private val Router.Tab.label: String
    get() = when (this) {
        Router.Tab.Upcoming -> "Coming up"
        Router.Tab.Map -> "Map"
        Router.Tab.Recent -> "Recent"
        Router.Tab.Settings -> "Settings"
    }

private val Router.Tab.icon
    get() = when (this) {
        Router.Tab.Upcoming -> Icons.Filled.DirectionsBoat
        Router.Tab.Map -> Icons.Filled.Map
        Router.Tab.Recent -> Icons.Filled.History
        Router.Tab.Settings -> Icons.Filled.Settings
    }

@Composable
fun BridgeViewRoot() {
    val graph = LocalContext.current.graph
    val appearance by graph.prefs.appearance.flow.collectAsState()
    val dark = when (Appearance.fromRaw(appearance)) {
        Appearance.System -> isSystemInDarkTheme()
        Appearance.Light -> false
        Appearance.Dark -> true
    }
    BridgeViewTheme(dark = dark) { Tabs() }
}

@Composable
private fun Tabs() {
    val graph = LocalContext.current.graph
    val router = graph.router
    val tab by router.tab.collectAsState()
    val opened by router.openedShip.collectAsState()
    val snapshot by graph.store.snapshot.collectAsState()

    // Each tab keeps its own stack of ship pages, as on iOS
    val stacks = Router.Tab.entries.associateWith { t ->
        rememberSaveable(t, saver = listSaver(save = { it.toList() }, restore = { it.toMutableStateList() })) {
            emptyList<Int>().toMutableStateList()
        }
    }
    val stack = stacks.getValue(tab)

    // Forget per-ship countdown choices once the ship isn't coming up any more
    LaunchedEffect(snapshot?.upcoming?.map { it.mmsi }) {
        val upcoming = snapshot?.upcoming?.map { it.mmsi }?.toSet() ?: return@LaunchedEffect
        val ships = AlertPreferences.decodeShips(graph.prefs.liveActivityShips.value)
        val kept = ships.filterKeys { it in upcoming }
        if (kept.size != ships.size) {
            graph.prefs.liveActivityShips.value = AlertPreferences.encodeShips(kept)
            graph.push.preferencesChanged()
        }
    }

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            Router.Tab.entries.forEach { t ->
                item(
                    selected = t == tab,
                    onClick = {
                        // Tapping the tab you're on goes back to its top
                        if (t == tab) stacks.getValue(t).clear() else router.tab.value = t
                    },
                    icon = { Icon(t.icon, contentDescription = null) },
                    label = { Text(t.label) },
                )
            }
        },
    ) {
        BackHandler(enabled = stack.isNotEmpty()) { stack.removeAt(stack.lastIndex) }
        val open: (Int) -> Unit = { stack.add(it) }
        Box(Modifier.fillMaxSize()) {
            val top = stack.lastOrNull()
            if (top != null) {
                ShipDetailScreen(top, onBack = { stack.removeAt(stack.lastIndex) })
            } else {
                when (tab) {
                    Router.Tab.Upcoming -> UpcomingScreen(open)
                    Router.Tab.Map -> LiveMapScreen(open)
                    Router.Tab.Recent -> RecentScreen(open)
                    Router.Tab.Settings -> SettingsScreen()
                }
            }
        }
    }

    // A ship opened from a notification or a bridgeview:// link (iOS: a sheet)
    opened?.let { mmsi ->
        Dialog(
            onDismissRequest = { router.openedShip.value = null },
            properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
        ) {
            BridgeViewTheme(dark = Theme.colors.isDark) {
                ShipDetailScreen(mmsi, onBack = { router.openedShip.value = null }, closeIcon = true)
            }
        }
    }
}
