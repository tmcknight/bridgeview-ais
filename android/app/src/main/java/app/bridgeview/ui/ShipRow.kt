package app.bridgeview.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.bridgeview.graph
import app.bridgeview.model.Direction
import app.bridgeview.model.Ship

/** One ship in the "Coming up" or "Recent" list */
enum class ListMode { Upcoming, Recent }

@Composable
fun ShipRow(ship: Ship, mode: ListMode) {
    val colors = Theme.colors
    val now by rememberNow(30_000)
    val direction = if (mode == ListMode.Upcoming) ship.approach?.direction else ship.lastPassage?.direction
    val details = buildList {
        if (ship.summary.isNotEmpty()) add(ship.summary)
        if (mode == ListMode.Upcoming) ship.approach?.let { add(Format.distance(it.distanceNM)) }
    }.joinToString(" · ")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        DirectionBadge(
            direction = direction,
            course = if (mode == ListMode.Upcoming) ship.position?.course else null,
            followsCompass = mode == ListMode.Upcoming,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(ship.name, style = Theme.hull(Theme.Style.Subheadline), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (details.isNotEmpty()) {
                Text(details, style = Theme.text(Theme.Style.Subheadline), color = colors.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        when (mode) {
            ListMode.Upcoming -> ship.approach?.let { approach ->
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(Format.minutes(approach.etaMinutes), style = Theme.figure(Theme.Style.Subheadline), color = colors.signal)
                    Text(Format.time(approach.eta), style = Theme.text(Theme.Style.Caption), color = colors.secondaryText)
                }
            }
            ListMode.Recent -> ship.lastPassage?.let { passage ->
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(Format.relative(passage.time, now), style = Theme.figure(Theme.Style.Subheadline, 600))
                    Text(Format.time(passage.time), style = Theme.text(Theme.Style.Caption), color = colors.secondaryText)
                }
            }
        }
        if (mode == ListMode.Upcoming) FollowToggle(ship.mmsi, FollowStyle.Icon)
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = colors.tertiaryText)
    }
}

/**
 * Arrow for a ship's direction through the river, pointing the way the ship is
 * heading when its course is known (straight up or down otherwise)
 */
@Composable
fun DirectionBadge(direction: Direction?, course: Double?, followsCompass: Boolean = true) {
    val color = Theme.colors.color(direction)
    Box(
        Modifier
            .size(38.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(Brush.verticalGradient(listOf(color.copy(alpha = 0.85f), color)))
            .semantics { contentDescription = direction?.label ?: "Ship" },
        contentAlignment = Alignment.Center,
    ) {
        DirectionArrow(direction, course, followsCompass, tint = Color.White)
    }
}

/**
 * Arrow pointing along a ship's course (or its direction through the river),
 * turned by the phone's compass heading like a compass needle, so it points the
 * way the ship is going as seen by whoever holds the phone (north up without one).
 * Ships that have already gone by keep a plain up or down arrow.
 */
@Composable
fun DirectionArrow(direction: Direction?, course: Double?, followsCompass: Boolean = true, tint: Color, size: androidx.compose.ui.unit.Dp = 22.dp) {
    if (direction == null) {
        Icon(Icons.Filled.DirectionsBoat, contentDescription = null, tint = tint, modifier = Modifier.size(size))
        return
    }
    val compass = LocalContext.current.graph.compass
    if (followsCompass) {
        DisposableEffect(Unit) {
            compass.start()
            onDispose { compass.stop() }
        }
    }
    val heading by compass.heading.collectAsState()
    val target = ((course ?: direction.bearing) - (if (followsCompass) heading ?: 0.0 else 0.0)).toFloat()
    val angle by animateFloatAsState(target, tween(200), label = "arrow")
    Icon(Icons.Filled.ArrowUpward, contentDescription = null, tint = tint, modifier = Modifier.size(size).rotate(angle))
}

