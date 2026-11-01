package app.bridgeview.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.outlined.NotificationAdd
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.bridgeview.graph
import app.bridgeview.model.AlertPreferences

/**
 * Live countdown on or off for one ship coming up (iOS: the Live Activity toggle);
 * starts out as the user's default from Settings. Hidden while alerts or
 * countdowns are off. A capsule reading "Follow" or "Following", or just the icon.
 */
enum class FollowStyle {
    /** "Follow" / "Following" in a capsule, centred, for the ship's page */
    Pill,
    /** Just the icon in a circle, for list rows and cards */
    Icon,
}

/** Whether the follow toggle shows, and the ship's current choice */
class FollowState(val visible: Boolean, val on: Boolean, val set: (Boolean) -> Unit)

@Composable
fun rememberFollowState(mmsi: Int): FollowState {
    val graph = LocalContext.current.graph
    val alertsEnabled by graph.prefs.enabled.flow.collectAsState()
    val byDefault by graph.prefs.liveActivities.flow.collectAsState()
    val choices by graph.prefs.liveActivityShips.flow.collectAsState()
    val allowed by graph.push.countdownsAllowed.collectAsState()
    val on = AlertPreferences.decodeShips(choices)[mmsi] ?: byDefault
    return FollowState(alertsEnabled && allowed, on) { value ->
        val ships = AlertPreferences.decodeShips(graph.prefs.liveActivityShips.value).toMutableMap()
        ships[mmsi] = value
        graph.prefs.liveActivityShips.value = AlertPreferences.encodeShips(ships)
        graph.push.preferencesChanged()
    }
}

@Composable
fun FollowToggle(mmsi: Int, style: FollowStyle, modifier: Modifier = Modifier, onDark: Boolean = false) {
    val state = rememberFollowState(mmsi)
    if (!state.visible) return
    val haptics = LocalHapticFeedback.current
    val colors = Theme.colors
    val toggle = {
        haptics.performHapticFeedback(HapticFeedbackType.ToggleOn)
        state.set(!state.on)
    }
    val description = Modifier.semantics {
        role = Role.Switch
        contentDescription = "Live countdown"
        stateDescription = if (state.on) "On" else "Off"
    }
    val tint = if (state.on) colors.signal else if (onDark) androidx.compose.ui.graphics.Color.White else colors.primaryText
    val icon = if (state.on) Icons.Filled.NotificationsActive else Icons.Outlined.NotificationAdd
    when (style) {
        FollowStyle.Pill -> Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            Pill(description, onDark = onDark, onClick = toggle) {
                Row(
                    Modifier.padding(horizontal = 22.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(icon, contentDescription = null, tint = tint)
                    AnimatedContent(state.on, label = "follow") { on ->
                        Text(if (on) "Following" else "Follow", style = Theme.text(Theme.Style.Headline, FontWeight.SemiBold))
                    }
                }
            }
        }
        FollowStyle.Icon -> Pill(modifier.size(34.dp).then(description), onDark = onDark, onClick = toggle) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
        }
    }
}

/** The toggle as a menu item, for a ship's long-press menu */
@Composable
fun FollowMenuItem(mmsi: Int, dismiss: () -> Unit) {
    val state = rememberFollowState(mmsi)
    if (!state.visible) return
    DropdownMenuItem(
        text = { Text("Live countdown") },
        leadingIcon = { Icon(Icons.Filled.NotificationsActive, contentDescription = null) },
        trailingIcon = { Checkbox(checked = state.on, onCheckedChange = null) },
        onClick = {
            state.set(!state.on)
            dismiss()
        },
    )
}
