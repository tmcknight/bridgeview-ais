package app.bridgeview.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.bridgeview.graph
import app.bridgeview.model.MapSnapshot
import app.bridgeview.model.Ship
import app.bridgeview.model.ShipMotion
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.maplibre.android.geometry.LatLng

const val MAP_POLL_INTERVAL_MS = 5_000L

/** The live map's camera, kept while the app runs so switching tabs doesn't reset it */
val liveMapCamera = MapCamera(LatLng(app.bridgeview.model.Bridge.LATITUDE, app.bridgeview.model.Bridge.LONGITUDE), 11.8)

/** Every ship near the bridge on a map, moved along its course between updates */
@Composable
fun LiveMapScreen(onOpenShip: (Int) -> Unit) {
    val graph = LocalContext.current.graph
    var snapshot by remember { mutableStateOf<MapSnapshot?>(null) }
    val motion = remember { ShipMotion() }
    var motionVersion by remember { mutableIntStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }
    var selected by rememberSaveable { mutableStateOf<Int?>(null) }

    // Polls only while the map is on screen
    LaunchedEffect(Unit) {
        while (true) {
            try {
                val latest = graph.api.map()
                motion.update(latest.ships)
                motionVersion++
                snapshot = latest
                error = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = graph.describe(e)
            }
            delay(MAP_POLL_INTERVAL_MS)
        }
    }

    val ships = snapshot?.ships?.filter { it.position != null }.orEmpty()
    val selectedShip = selected?.let { mmsi -> ships.firstOrNull { it.mmsi == mmsi } }

    Box(Modifier.fillMaxSize()) {
        ShipMap(
            ships = ships,
            motion = motion,
            motionVersion = motionVersion,
            frame = MapFrame.Camera(liveMapCamera),
            modifier = Modifier.fillMaxSize(),
            selected = selected,
            onSelect = { selected = it },
        )
        Column(
            Modifier.align(Alignment.BottomCenter).padding(horizontal = 16.dp, vertical = 8.dp).readableWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            selectedShip?.let { ship -> SelectedShipCard(ship, open = { onOpenShip(ship.mmsi) }, close = { selected = null }) }
            error?.let {
                Pill {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(Icons.Filled.Warning, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text(it, style = Theme.text(Theme.Style.Footnote))
                    }
                }
            }
            snapshot?.attribution?.takeIf { it.isNotEmpty() }?.let { credits ->
                Pill { DataCredits(credits, Modifier.padding(horizontal = 10.dp, vertical = 4.dp)) }
            }
        }
    }
}

/** The tapped ship: name, type and speed, opening its details */
@Composable
private fun SelectedShipCard(ship: Ship, open: () -> Unit, close: () -> Unit) {
    val colors = Theme.colors
    // "Cargo · 225 m · 11.2 kn", or "At anchor"/"Moored" when stopped
    val details = buildList {
        if (ship.summary.isNotEmpty()) add(ship.summary)
        ship.position?.let { position ->
            when (position.navStatus) {
                1 -> add("At anchor")
                5 -> add("Moored")
                else -> position.sog?.let { add(Format.speed(it)) }
            }
        }
    }.joinToString(" · ")
    Card(padding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(
                    Modifier.weight(1f).clickableNoRipple(open),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(ship.name, style = Theme.hull(Theme.Style.Subheadline), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        ship.flagEmoji?.let { Text(it) }
                    }
                    Text(details, style = Theme.text(Theme.Style.Subheadline), color = colors.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                ship.approach?.let {
                    Text(Format.minutes(it.etaMinutes), style = Theme.figure(Theme.Style.Subheadline), color = colors.signal)
                }
                Icon(
                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = "Show ${ship.name}",
                    tint = colors.tertiaryText,
                    modifier = Modifier.clickableNoRipple(open),
                )
            }
            IconButton(onClick = close, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Close, contentDescription = "Close", tint = colors.secondaryText, modifier = Modifier.size(18.dp))
            }
        }
    }
}

private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier = this.clickable(onClick = onClick)
