package app.bridgeview.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Waves
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.bridgeview.graph
import app.bridgeview.model.Approach
import app.bridgeview.model.Bridge
import app.bridgeview.model.Ship
import app.bridgeview.model.ShipLinks
import kotlinx.coroutines.launch

/** List of ships from the bridge snapshot, with loading, empty and error states */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShipListScreen(
    title: String,
    ships: List<Ship>?,
    mode: ListMode,
    onOpenShip: (Int) -> Unit,
    shipCam: String? = null,
    empty: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val graph = context.graph
    val error by graph.store.error.collectAsState()
    val loading by graph.store.isLoading.collectAsState()
    val snapshot by graph.store.snapshot.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val refresh: () -> Unit = {
        scope.launch {
            refreshing = true
            graph.store.refresh()
            refreshing = false
        }
    }

    Box(Modifier.fillMaxSize()) {
        RiverBackground()
        Column(Modifier.fillMaxSize()) {
            LargeTitleBar(title) {
                if (shipCam != null) {
                    IconButton(onClick = { openUrl(context, shipCam) }) {
                        Icon(Icons.Filled.Videocam, contentDescription = "Port Huron ship cam", tint = Theme.colors.signal)
                    }
                }
            }
            PullToRefreshBox(isRefreshing = refreshing, onRefresh = refresh, modifier = Modifier.fillMaxSize()) {
                when {
                    !ships.isNullOrEmpty() -> LazyColumn(
                        Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 72.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        val first = ships.first()
                        val rest = if (mode == ListMode.Upcoming && first.approach != null) ships.drop(1) else ships
                        if (mode == ListMode.Upcoming && first.approach != null) {
                            item(key = "next-${first.mmsi}") {
                                LongPressMenu(mmsi = first.mmsi, enabled = true, onClick = { onOpenShip(first.mmsi) }) {
                                    NextShipCard(first, first.approach)
                                }
                            }
                            if (shipCam != null) item(key = "cam") { ShipCamCard(shipCam) }
                            if (rest.isNotEmpty()) item(key = "after") { SectionLabel("After that", Modifier.readableWidth().padding(top = 8.dp)) }
                        }
                        items(rest, key = { it.mmsi }) { ship ->
                            LongPressMenu(mmsi = ship.mmsi, enabled = mode == ListMode.Upcoming, onClick = { onOpenShip(ship.mmsi) }) {
                                Card(padding = 12.dp) { ShipRow(ship, mode) }
                            }
                        }
                        // At the end of the list, out of the way but still beside the data
                        snapshot?.attribution?.takeIf { it.isNotEmpty() }?.let { credits ->
                            item(key = "credits") { DataCredits(credits, Modifier.readableWidth().padding(top = 8.dp)) }
                        }
                    }
                    ships == null && error != null -> CenteredScroll {
                        EmptyState(
                            Icons.Filled.WifiOff,
                            "Can't reach BridgeView",
                            error ?: "",
                            action = "Try again" to refresh,
                        )
                    }
                    ships == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        if (loading || error == null) CircularProgressIndicator()
                    }
                    // A little down from the title, not jammed against it
                    else -> CenteredScroll { empty() }
                }
            }
        }
        // A small pill floating over the list when an update failed but ships are still shown
        if (ships != null && error != null) {
            Pill(Modifier.align(Alignment.BottomCenter).padding(16.dp).readableWidth()) {
                Row(
                    Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(Icons.Filled.Warning, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text(error ?: "", style = Theme.text(Theme.Style.Footnote))
                }
            }
        }
    }
}

@Composable
private fun CenteredScroll(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 72.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

/** Tap to open; press and hold for the ship's menu (its live countdown), as on iOS */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LongPressMenu(mmsi: Int, enabled: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val follow = rememberFollowState(mmsi)
    Box(
        Modifier
            .readableWidth()
            .clip(RoundedCornerShape(Theme.cornerRadius + 4.dp))
            .combinedClickable(
                onClick = onClick,
                onLongClick = if (enabled && follow.visible) ({ open = true }) else null,
                onLongClickLabel = "Ship options",
            ),
    ) {
        content()
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            FollowMenuItem(mmsi) { open = false }
        }
    }
}

/** A big title in the bar, beside its buttons (iOS: inline large title) */
@Composable
fun LargeTitleBar(title: String, actions: @Composable () -> Unit = {}) {
    Row(
        Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = Theme.hull(Theme.Style.Title), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        actions()
    }
}

/** The next ship to reach the bridge, big, with a countdown */
@Composable
fun NextShipCard(ship: Ship, approach: Approach) {
    val colors = Theme.colors
    val now by rememberNow()
    val time by rememberAnimationSeconds()
    val shape = RoundedCornerShape(Theme.cornerRadius + 4.dp)
    Box(
        Modifier
            .padding(top = 4.dp)
            .shadow(14.dp, shape, ambientColor = colors.river, spotColor = colors.river)
            .clip(shape)
            .background(Brush.linearGradient(listOf(colors.shallows, colors.river)))
            .semantics(mergeDescendants = true) {},
    ) {
        Canvas(Modifier.matchParentSize()) {
            drawSwells(time.toDouble(), top = size.height - 98.dp.toPx(), height = 90.dp.toPx(), color = Color.White.copy(alpha = 0.1f), width = 1.dp.toPx())
        }
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "NEXT AT THE BRIDGE",
                    style = Theme.text(Theme.Style.Caption, FontWeight.Bold).copy(letterSpacing = 1.4.sp),
                    color = SignalOnRiver,
                    modifier = Modifier.weight(1f),
                )
                FollowToggle(ship.mmsi, FollowStyle.Icon, onDark = true)
                Pill(onDark = true) {
                    Row(
                        Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        DirectionArrow(approach.direction, ship.position?.course, tint = Color.White, size = 14.dp)
                        Text(approach.direction.label, style = Theme.text(Theme.Style.Caption, FontWeight.Bold), color = Color.White)
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(ship.name, style = Theme.hull(Theme.Style.Title2), color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    ship.flagEmoji?.let { Text(it, style = Theme.text(Theme.Style.Title3)) }
                }
                if (ship.summary.isNotEmpty()) {
                    Text(ship.summary, style = Theme.text(Theme.Style.Subheadline), color = Color.White.copy(alpha = 0.75f))
                }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    if (approach.eta.isAfter(now)) Format.countdown(now, approach.eta) else "Now",
                    style = Theme.figure(Theme.Style.LargeTitle, 900),
                    color = Color.White,
                    modifier = Modifier.weight(1f),
                )
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(Format.time(approach.eta), style = Theme.figure(Theme.Style.Headline), color = Color.White)
                    Text(Format.distance(approach.distanceNM), style = Theme.text(Theme.Style.Subheadline), color = Color.White.copy(alpha = 0.75f))
                }
            }
        }
    }
}

/** Link to the Port Huron ship cam, to watch the next ship go under the bridge */
@Composable
fun ShipCamCard(url: String) {
    val context = LocalContext.current
    val colors = Theme.colors
    Card(Modifier.readableWidth(), padding = 12.dp, onClick = { openUrl(context, url) }) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                Modifier.size(38.dp).clip(RoundedCornerShape(11.dp))
                    .background(Brush.verticalGradient(listOf(colors.signal.copy(alpha = 0.85f), colors.signal))),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Videocam, contentDescription = null, tint = Color.White)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Watch it pass", style = Theme.text(Theme.Style.Headline, FontWeight.SemiBold))
                Text("Port Huron ship cam, live", style = Theme.text(Theme.Style.Subheadline), color = colors.secondaryText)
            }
            Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = colors.tertiaryText, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
fun UpcomingScreen(onOpenShip: (Int) -> Unit) {
    val snapshot by LocalContext.current.graph.store.snapshot.collectAsState()
    ShipListScreen(
        title = "Coming up",
        ships = snapshot?.upcoming,
        mode = ListMode.Upcoming,
        onOpenShip = onOpenShip,
        shipCam = ShipLinks.shipCam(snapshot?.shipCamVideoId),
    ) {
        EmptyState(
            Icons.Filled.Waves,
            "No ships heading for the bridge",
            "When a ship is within three hours of the ${Bridge.NAME}, it'll show up here with a countdown.",
        )
    }
}

@Composable
fun RecentScreen(onOpenShip: (Int) -> Unit) {
    val snapshot by LocalContext.current.graph.store.snapshot.collectAsState()
    ShipListScreen(title = "Recently passed", ships = snapshot?.recent, mode = ListMode.Recent, onOpenShip = onOpenShip) {
        EmptyState(
            Icons.Filled.History,
            "No ships in the last day",
            "Ships stay here for a day after they go under the ${Bridge.NAME}.",
        )
    }
}
