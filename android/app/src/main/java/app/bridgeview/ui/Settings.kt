package app.bridgeview.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.LocationOff
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.bridgeview.AppConfig
import app.bridgeview.graph
import app.bridgeview.model.AlertPreferences
import app.bridgeview.model.Appearance
import app.bridgeview.model.Bridge
import app.bridgeview.model.Direction
import app.bridgeview.model.ShipCategory
import app.bridgeview.push.NearBridgeMonitor
import app.bridgeview.push.ShipNotifications
import kotlinx.coroutines.launch

/** Which ships to be alerted about, and the state of notifications and live countdowns */
@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    val graph = context.graph
    val prefs = graph.prefs
    val push = graph.push
    val scope = rememberCoroutineScope()

    val enabled by prefs.enabled.flow.collectAsState()
    val categories by prefs.categories.flow.collectAsState()
    val minLength by prefs.minLength.flow.collectAsState()
    val directions by prefs.directions.flow.collectAsState()
    val nearBridgeOnly by prefs.nearBridgeOnly.flow.collectAsState()
    val radius by prefs.nearBridgeRadius.flow.collectAsState()
    val liveActivities by prefs.liveActivities.flow.collectAsState()
    val appearance by prefs.appearance.flow.collectAsState()
    val notificationsAllowed by push.notificationsAllowed.collectAsState()
    val countdownsAllowed by push.countdownsAllowed.collectAsState()
    val registrationError by push.lastRegistrationError.collectAsState()
    val snapshot by graph.store.snapshot.collectAsState()

    fun locationSettingsChanged() {
        scope.launch { graph.nearBridge.update(prefs.alertPreferences()) }
        push.preferencesChanged()
    }

    val foregroundLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        scope.launch {
            graph.nearBridge.refreshAuthorization()
            locationSettingsChanged()
        }
    }
    val backgroundLocation = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        scope.launch {
            graph.nearBridge.refreshAuthorization()
            locationSettingsChanged()
        }
    }
    fun askForLocation() {
        graph.nearBridge.markAsked()
        val permissions = buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            // Android 10 asks for "all the time" in the same prompt; later versions send people to settings for it
            if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        }
        foregroundLocation.launch(permissions.toTypedArray())
    }

    Box(Modifier.fillMaxSize()) {
        RiverBackground()
        Column(Modifier.fillMaxSize()) {
            LargeTitleBar("Settings")
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(Modifier.readableWidth(), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    Section(footer = "Get notified when a ship is 5–10 minutes from the ${Bridge.NAME}.") {
                        SwitchRow("Bridge alerts", enabled) {
                            prefs.enabled.value = it
                            locationSettingsChanged()
                        }
                    }
                    if (!notificationsAllowed) {
                        Section(footer = "Notifications are off for BridgeView.") {
                            ButtonRow("Turn on notifications in Settings") { openNotificationSettings(context) }
                        }
                    }
                    if (enabled) {
                        val categorySet = AlertPreferences.decodeCategories(categories)
                        Section(header = "Ships") {
                            ShipCategory.entries.forEachIndexed { index, category ->
                                if (index > 0) Hairline()
                                SwitchRow(category.label, category in categorySet) { on ->
                                    prefs.categories.value = AlertPreferences.encodeCategories(if (on) categorySet + category else categorySet - category)
                                    push.preferencesChanged()
                                }
                            }
                            Hairline()
                            PickerRow(
                                "Length",
                                AlertPreferences.lengthOptions,
                                minLength,
                                label = { if (it == 0) "Any" else "$it m or more" },
                            ) {
                                prefs.minLength.value = it
                                push.preferencesChanged()
                            }
                        }
                        val directionSet = AlertPreferences.decodeDirections(directions)
                        Section(header = "Direction") {
                            Direction.entries.forEachIndexed { index, direction ->
                                if (index > 0) Hairline()
                                SwitchRow(
                                    if (direction == Direction.Upbound) "Upbound (to Lake Huron)" else "Downbound (to Lake St. Clair)",
                                    direction in directionSet,
                                    icon = if (direction == Direction.Upbound) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
                                    iconTint = Theme.colors.color(direction),
                                ) { on ->
                                    prefs.directions.value = AlertPreferences.encodeDirections(if (on) directionSet + direction else directionSet - direction)
                                    push.preferencesChanged()
                                }
                            }
                        }
                        Section(header = "Where you are", footer = "Alerts pause while you're away. Your location stays on this phone.") {
                            SwitchRow("Only when I'm near the bridge", nearBridgeOnly) { on ->
                                prefs.nearBridgeOnly.value = on
                                locationSettingsChanged()
                                val status = graph.nearBridge.readAuthorization()
                                if (on && (status == NearBridgeMonitor.Authorization.NotDetermined)) askForLocation()
                            }
                            if (nearBridgeOnly) {
                                Hairline()
                                PickerRow("Within", AlertPreferences.radiusOptions, radius, label = { "$it km" }) {
                                    prefs.nearBridgeRadius.value = it
                                    locationSettingsChanged()
                                }
                                NearBridgeStatus(
                                    askForeground = ::askForLocation,
                                    askBackground = { backgroundLocation.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) },
                                )
                            }
                        }
                        Section(footer = "Keeps a countdown in your notifications and on the lock screen until the ship has passed. To change it for one ship, open the ship or press and hold it in Coming up.") {
                            if (countdownsAllowed) {
                                SwitchRow("Live countdowns by default", liveActivities) {
                                    prefs.liveActivities.value = it
                                    push.preferencesChanged()
                                }
                            } else {
                                ValueRow("Live countdowns", "Off")
                                Hairline()
                                ButtonRow("Turn on in Settings") {
                                    if (notificationsAllowed) openNotificationSettings(context, ShipNotifications.CHANNEL_LIVE)
                                    else openNotificationSettings(context)
                                }
                            }
                        }
                    }
                    Section(header = "Appearance", footer = "System matches your phone.", card = false) {
                        val current = Appearance.fromRaw(appearance)
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                            Appearance.entries.forEachIndexed { index, option ->
                                SegmentedButton(
                                    selected = option == current,
                                    onClick = { prefs.appearance.value = option.raw },
                                    shape = SegmentedButtonDefaults.itemShape(index, Appearance.entries.size),
                                ) { Text(option.label) }
                            }
                        }
                    }
                    registrationError?.let { error ->
                        Section(header = "Couldn't register for alerts") {
                            Row(Modifier.padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Filled.Warning, contentDescription = null, modifier = Modifier.size(18.dp))
                                Text(error, style = Theme.text(Theme.Style.Footnote))
                            }
                        }
                    }
                    if (!AppConfig.hasFirebase) {
                        Section(header = "Bridge alerts") {
                            Text(
                                "This build of BridgeView wasn't set up for alerts (no Firebase project), so none will arrive.",
                                style = Theme.text(Theme.Style.Footnote),
                                modifier = Modifier.padding(vertical = 12.dp),
                            )
                        }
                    }
                    Section(header = "About", footer = "BridgeView is for watching ships, not for navigation or safety.") {
                        Column(Modifier.padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(
                                "BridgeView is a gift to the Sarnia and Port Huron communities, for everyone who loves watching the ships go by.",
                                style = Theme.text(Theme.Style.Footnote),
                            )
                            Text(
                                "Photos and details come from Wikidata, Wikimedia Commons and public vessel registers, and from people who share their photos in the app.",
                                style = Theme.text(Theme.Style.Footnote),
                                color = Theme.colors.secondaryText,
                            )
                            Text(
                                "Ship positions come from the AIS radio signals ships broadcast, picked up by a local antenna and the feeds below. Arrival times are estimates from each ship's speed and course.",
                                style = Theme.text(Theme.Style.Footnote),
                                color = Theme.colors.secondaryText,
                            )
                            snapshot?.attribution?.takeIf { it.isNotEmpty() }?.let { DataCredits(it, alignStart = true) }
                        }
                        Hairline()
                        ButtonRow("More about BridgeView") { openUrl(context, AppConfig.page("about.html")) }
                        Hairline()
                        ButtonRow("Terms") { openUrl(context, AppConfig.page("terms.html")) }
                        Hairline()
                        ButtonRow("Privacy") { openUrl(context, AppConfig.page("privacy.html")) }
                    }
                }
            }
        }
    }
}

@Composable
private fun NearBridgeStatus(askForeground: () -> Unit, askBackground: () -> Unit) {
    val context = LocalContext.current
    val monitor = context.graph.nearBridge
    val authorization by monitor.authorization.collectAsState()
    val isNear by monitor.isNear.collectAsState()
    val colors = Theme.colors
    when (authorization) {
        NearBridgeMonitor.Authorization.Denied -> {
            Hairline()
            StatusRow(Icons.Filled.LocationOff, "Location is off, so alerts won't pause", colors.secondaryText)
            Hairline()
            ButtonRow("Turn on in Settings") { openAppSettings(context) }
        }
        NearBridgeMonitor.Authorization.NotDetermined -> {
            Hairline()
            ButtonRow("Allow location") { askForeground() }
        }
        NearBridgeMonitor.Authorization.WhenInUse -> {
            Hairline()
            StatusRow(Icons.Outlined.LocationOn, "Allow location “all the time” to pause alerts when you leave", colors.secondaryText)
            Hairline()
            ButtonRow("Change in Settings") { askBackground() }
        }
        NearBridgeMonitor.Authorization.Always -> {
            Hairline()
            when (isNear) {
                true -> StatusRow(Icons.Filled.LocationOn, "You're near the bridge", colors.upbound)
                false -> StatusRow(Icons.Filled.PauseCircle, "You're away. Alerts paused", colors.secondaryText)
                null -> StatusRow(Icons.Outlined.LocationOn, "Finding where you are…", colors.secondaryText)
            }
        }
    }
}

/** A group of rows in a card, with an optional header and footer (iOS: Form section) */
@Composable
private fun Section(header: String? = null, footer: String? = null, card: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        header?.let { SectionLabel(it, Modifier.padding(horizontal = 12.dp)) }
        if (card) {
            Card(padding = 0.dp) { Column(Modifier.padding(horizontal = 16.dp), content = content) }
        } else {
            Column(content = content)
        }
        footer?.let {
            Text(it, style = Theme.text(Theme.Style.Footnote), color = Theme.colors.secondaryText, modifier = Modifier.padding(horizontal = 16.dp))
        }
    }
}

@Composable
private fun SwitchRow(title: String, checked: Boolean, icon: ImageVector? = null, iconTint: Color = Color.Unspecified, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }.padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        icon?.let { Icon(it, contentDescription = null, tint = iconTint) }
        Text(title, style = Theme.text(Theme.Style.Body), modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = null)
    }
}

@Composable
private fun <T> PickerRow(title: String, options: List<T>, selected: T, label: (T) -> String, onSelect: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable { open = true }.padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = Theme.text(Theme.Style.Body), modifier = Modifier.weight(1f))
        Box {
            Text(label(selected), style = Theme.text(Theme.Style.Body), color = Theme.colors.signal)
            DropdownMenu(open, onDismissRequest = { open = false }) {
                options.forEach { option ->
                    DropdownMenuItem(text = { Text(label(option)) }, onClick = { open = false; onSelect(option) })
                }
            }
        }
    }
}

@Composable
private fun ValueRow(title: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 14.dp)) {
        Text(title, style = Theme.text(Theme.Style.Body), modifier = Modifier.weight(1f))
        Text(value, style = Theme.text(Theme.Style.Body), color = Theme.colors.secondaryText)
    }
}

@Composable
private fun ButtonRow(title: String, onClick: () -> Unit) {
    Text(
        title,
        style = Theme.text(Theme.Style.Body, FontWeight.Medium),
        color = Theme.colors.signal,
        modifier = Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(vertical = 14.dp),
    )
}

@Composable
private fun StatusRow(icon: ImageVector, text: String, tint: Color) {
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, contentDescription = null, tint = tint)
        Text(text, style = Theme.text(Theme.Style.Body), color = tint)
    }
}
