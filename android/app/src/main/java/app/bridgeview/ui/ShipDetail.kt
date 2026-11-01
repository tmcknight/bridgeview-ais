package app.bridgeview.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.TravelExplore
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.bridgeview.AppConfig
import app.bridgeview.graph
import app.bridgeview.model.Approach
import app.bridgeview.model.Bridge
import app.bridgeview.model.Coordinate
import app.bridgeview.model.Direction
import app.bridgeview.model.ExternalLink
import app.bridgeview.model.PhotoReport
import app.bridgeview.model.PhotoReportReason
import app.bridgeview.model.Position
import app.bridgeview.model.Ship
import app.bridgeview.model.ShipLinks
import app.bridgeview.model.ShipMotion
import app.bridgeview.model.VesselPhoto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Locale

/** Everything known about one ship, with links to find out more */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShipDetailScreen(mmsi: Int, onBack: () -> Unit, closeIcon: Boolean = false) {
    val graph = LocalContext.current.graph
    val snapshot by graph.store.snapshot.collectAsState()
    var ship by remember(mmsi) { mutableStateOf<Ship?>(null) }
    var error by remember(mmsi) { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // The ship from the list, shown while the full details load
    val cached = snapshot?.let { s -> (s.upcoming + s.recent).firstOrNull { it.mmsi == mmsi } }

    suspend fun load() {
        try {
            ship = graph.api.ship(mmsi)
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = graph.describe(e)
        }
    }
    LaunchedEffect(mmsi) { load() }

    val shown = ship ?: cached
    Box(Modifier.fillMaxSize()) {
        RiverBackground()
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(
                        if (closeIcon) Icons.Filled.Close else Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = if (closeIcon) "Done" else "Back",
                    )
                }
                Text(
                    shown?.name ?: "Ship",
                    style = Theme.hull(Theme.Style.Headline, heavy = false),
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Box(Modifier.size(48.dp))
            }
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = { scope.launch { refreshing = true; load(); refreshing = false } },
                modifier = Modifier.fillMaxSize(),
            ) {
                when {
                    shown != null -> ShipDetailContent(
                        ship = shown,
                        attribution = snapshot?.attribution.orEmpty(),
                        photoSharing = snapshot?.photoSharing ?: false,
                        photoReporting = snapshot?.photoReporting ?: false,
                        shipCam = ShipLinks.shipCam(snapshot?.shipCamVideoId),
                    )
                    error != null -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 72.dp)) {
                        EmptyState(Icons.Filled.DirectionsBoat, "Ship unavailable", error ?: "")
                    }
                    else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                }
            }
        }
    }
}

@Composable
private fun ShipDetailContent(
    ship: Ship,
    attribution: List<app.bridgeview.model.Attribution>,
    photoSharing: Boolean,
    photoReporting: Boolean,
    // Shown under the countdown while the ship is heading for the bridge
    shipCam: String?,
) {
    val context = LocalContext.current
    val graph = context.graph
    val scope = rememberCoroutineScope()
    val photos = ship.info?.allPhotos.orEmpty()
    var photoIndex by remember(ship.mmsi) { mutableIntStateOf(0) }
    var sharingPhoto by remember { mutableStateOf(false) }
    var reportingPhoto by remember { mutableStateOf<VesselPhoto?>(null) }
    var reportResult by remember { mutableStateOf<String?>(null) }
    var mapExpanded by remember { mutableStateOf(false) }
    var photosExpanded by remember { mutableStateOf(false) }
    val currentPhoto = photos.getOrNull(photoIndex.coerceAtMost(photos.size - 1))

    // Asks why the photo is being reported; without reporting on the server, opens
    // the support page, which says how to report one by email
    fun startReport(photo: VesselPhoto) {
        if (photoReporting) reportingPhoto = photo else openUrl(context, AppConfig.page("support.html"))
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.readableWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Header(
                ship = ship,
                photos = photos,
                photoIndex = photoIndex,
                onPhotoIndex = { photoIndex = it },
                currentPhoto = currentPhoto,
                photoSharing = photoSharing,
                onShare = { sharingPhoto = true },
                onReport = ::startReport,
                onExpand = { photosExpanded = true },
            )
            ship.approach?.let {
                ApproachCard(ship, it)
                if (shipCam != null) ShipCamCard(shipCam)
            }
            ship.position?.let { position ->
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    // A still preview; tapping opens it full screen to pan and zoom
                    val shape = RoundedCornerShape(Theme.cornerRadius)
                    Box(
                        Modifier.fillMaxWidth().height(230.dp).clip(shape).border(1.dp, Theme.colors.hairline, shape)
                            .semantics { contentDescription = "Map of ${ship.name}. Opens the map full screen" },
                    ) {
                        ShipPositionMap(ship, position, interactive = false)
                        // Taps go to the box, not the still map
                        Box(Modifier.matchParentSize().clickable { mapExpanded = true })
                        Pill(Modifier.align(Alignment.TopEnd).padding(10.dp).size(28.dp), onDark = true) {
                            Icon(Icons.Filled.OpenInFull, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                        }
                    }
                    val now by rememberNow(30_000)
                    Text(
                        "Last position ${Format.relative(position.time, now)}",
                        style = Theme.text(Theme.Style.Caption),
                        color = Theme.colors.secondaryText,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
                if (mapExpanded) {
                    FullScreenDialog(onDismiss = { mapExpanded = false }, title = ship.name) {
                        ShipPositionMap(ship, position, interactive = true)
                    }
                }
            }
            Facts(ship)
            Passages(ship)
            Links(ship)
            if (attribution.isNotEmpty()) DataCredits(attribution, Modifier.padding(top = 4.dp))
        }
    }

    if (photosExpanded && photos.isNotEmpty()) {
        PhotoViewer(photos, ship.name, photoIndex, { photoIndex = it }) { photosExpanded = false }
    }
    if (sharingPhoto) {
        SharePhotoScreen(ship.mmsi, ship.name) { sharingPhoto = false }
    }
    reportingPhoto?.let { photo ->
        AlertDialog(
            onDismissRequest = { reportingPhoto = null },
            title = { Text("Why are you reporting this photo?") },
            text = {
                Column {
                    Text(
                        "BridgeView checks every report and takes down photos that shouldn't be here.",
                        style = Theme.text(Theme.Style.Subheadline),
                        color = Theme.colors.secondaryText,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                    PhotoReportReason.entries.forEach { reason ->
                        Text(
                            reason.label,
                            modifier = Modifier.fillMaxWidth().clickable {
                                reportingPhoto = null
                                scope.launch {
                                    reportResult = try {
                                        graph.api.reportPhoto(ship.mmsi, PhotoReport(url = photo.url, reason = reason))
                                        "Thanks. We'll take a look at this photo."
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: Exception) {
                                        graph.describe(e)
                                    }
                                }
                            }.padding(vertical = 12.dp),
                            color = Theme.colors.signal,
                        )
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { reportingPhoto = null }) { Text("Cancel") } },
        )
    }
    reportResult?.let { message ->
        AlertDialog(
            onDismissRequest = { reportResult = null },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { reportResult = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun Header(
    ship: Ship,
    photos: List<VesselPhoto>,
    photoIndex: Int,
    onPhotoIndex: (Int) -> Unit,
    currentPhoto: VesselPhoto?,
    photoSharing: Boolean,
    onShare: () -> Unit,
    onReport: (VesselPhoto) -> Unit,
    onExpand: () -> Unit,
) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(Theme.cornerRadius)
    Column(
        Modifier.padding(top = 8.dp).fillMaxWidth().clip(shape).background(colors.surface).border(1.dp, colors.hairline, shape),
    ) {
        Box(Modifier.fillMaxWidth().height(220.dp)) {
            if (photos.isEmpty()) {
                PhotoPlaceholder()
            } else {
                // Swipe through the ship's photos (round from the last to the first); tap to see them full screen
                PhotoPager(photos, photoIndex, onPhotoIndex, Modifier.fillMaxSize()) { photo ->
                    Box(Modifier.fillMaxSize().clickable(onClickLabel = "Open the photos full screen", onClick = onExpand)) {
                        FilledPhoto(photo.url)
                    }
                }
            }
            // Shaded at the top too, so the buttons and credit read on a light photo
            Box(
                Modifier.matchParentSize().background(
                    Brush.verticalGradient(
                        0f to Color.Black.copy(alpha = 0.45f),
                        0.3f to Color.Transparent,
                        0.5f to Color.Transparent,
                        1f to Color.Black.copy(alpha = 0.65f),
                    ),
                ),
            )
            Row(
                Modifier.align(Alignment.BottomStart).padding(16.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(ship.name, style = Theme.hull(Theme.Style.Title), color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                ship.flagEmoji?.let { Text(it, style = Theme.text(Theme.Style.Title2)) }
            }
            // The photo's credit, small along the bottom edge below the name
            currentPhoto?.credit?.let { credit ->
                Text(
                    credit,
                    style = Theme.text(Theme.Style.Caption2).copy(fontSize = 9.sp, fontWeight = FontWeight.Medium),
                    color = Color.White.copy(alpha = 0.8f),
                    maxLines = 1,
                    overflow = TextOverflow.MiddleEllipsis,
                    modifier = Modifier.align(Alignment.BottomEnd).widthIn(max = 240.dp).padding(horizontal = 8.dp, vertical = 3.dp)
                        .semantics { contentDescription = "Photo: $credit" },
                )
            }
            if (photos.size > 1) {
                Text(
                    "${photoIndex + 1} / ${photos.size}",
                    style = Theme.figure(Theme.Style.Caption2, 600),
                    color = Color.White,
                    modifier = Modifier.align(Alignment.TopEnd).padding(10.dp)
                        .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(6.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
            Row(Modifier.align(Alignment.TopStart).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (photoSharing) {
                    Pill(onDark = true, onClick = onShare) {
                        Row(
                            Modifier.padding(horizontal = 10.dp, vertical = 6.dp).semantics(mergeDescendants = true) {
                                contentDescription = "Share a photo of ${ship.name}"
                            },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon(Icons.Filled.CameraAlt, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                            Text("Add photo", style = Theme.text(Theme.Style.Caption, FontWeight.SemiBold), color = Color.White)
                        }
                    }
                }
                if (currentPhoto != null) {
                    var menu by remember { mutableStateOf(false) }
                    Box {
                        Pill(Modifier.size(28.dp), onDark = true, onClick = { menu = true }) {
                            Icon(Icons.Filled.MoreHoriz, contentDescription = "Photo options", tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                        DropdownMenu(menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text("Report this photo") },
                                leadingIcon = { Icon(Icons.Filled.Flag, contentDescription = null) },
                                onClick = { menu = false; onReport(currentPhoto) },
                            )
                        }
                    }
                }
            }
        }
        val description = ship.info?.description
        if (description != null || ship.cargo != null || ship.summary.isNotEmpty()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (ship.summary.isNotEmpty()) {
                    Text(
                        ship.summary.uppercase(),
                        style = Theme.text(Theme.Style.Caption, FontWeight.Bold).copy(letterSpacing = 1.2.sp),
                        color = colors.signal,
                    )
                }
                description?.let { Text(it, color = colors.secondaryText, style = Theme.text(Theme.Style.Body)) }
                ship.cargo?.let { cargo ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Filled.Inventory2, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text(cargo, style = Theme.text(Theme.Style.Subheadline, FontWeight.Medium))
                    }
                }
            }
        }
    }
}

@Composable
private fun ApproachCard(ship: Ship, approach: Approach) {
    val colors = Theme.colors
    val now by rememberNow()
    Card {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionLabel("Heading for the bridge", Modifier.weight(1f))
                Box(Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(colors.color(approach.direction)), contentAlignment = Alignment.Center) {
                    DirectionArrow(approach.direction, ship.position?.course, tint = Color.White, size = 18.dp)
                }
            }
            Text(
                if (approach.eta.isAfter(now)) Format.countdown(now, approach.eta) else "Now",
                style = Theme.figure(Theme.Style.LargeTitle, 900),
                color = colors.signal,
            )
            Row {
                Stat("ETA", Format.time(approach.eta), Modifier.weight(1f))
                Stat("Distance", Format.distance(approach.distanceNM), Modifier.weight(1f))
            }
            Row {
                Stat("Direction", approach.direction.label, Modifier.weight(1f))
                ship.position?.sog?.let { Stat("Speed", Format.speed(it), Modifier.weight(1f)) } ?: Box(Modifier.weight(1f))
            }
            FollowToggle(ship.mmsi, FollowStyle.Pill)
        }
    }
}

@Composable
private fun Facts(ship: Ship) {
    val info = ship.info
    // USCG service type, e.g. "Freight Ship, Self-Discharging"
    val service = info?.uscg?.serviceType?.let { listOfNotNull(it, info.uscg.serviceSubType).joinToString(", ") }
    val size = when {
        ship.length != null && ship.width != null -> "${ship.length} × ${ship.width} m"
        ship.length != null -> "${ship.length} m long"
        else -> null
    }
    val rows = listOf(
        "Type" to ship.shipTypeName,
        "Size" to size,
        "Draught" to ship.draught?.let { String.format(Locale.US, "%.1f m", it) },
        "Destination" to ship.destination?.let(Format::place),
        "Built" to info?.yearBuilt?.toString(),
        "Builder" to info?.builder,
        "Operator" to info?.operator,
        "Service" to service,
        "Gross tonnage" to info?.grossTonnage?.let(Format::whole),
        "Deadweight" to info?.uscg?.deadweight?.let { "${Format.whole(it)} t" },
        "Engine power" to info?.registry?.enginePowerKw?.let { "${Format.whole(it)} kW" },
        "Port of registry" to info?.registry?.portOfRegistry?.let(Format::place),
        "Official number" to (info?.registry?.officialNumber ?: info?.uscg?.officialNumber),
        "Hull number" to info?.registry?.hullNumber,
        "IMO" to ship.imo?.toString(),
        "MMSI" to ship.mmsi.toString(),
        "Call sign" to ship.callSign,
    ).mapNotNull { (title, value) -> value?.takeIf { it.isNotEmpty() }?.let { title to it } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel("Details")
        Card(padding = 0.dp) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 2.dp)) {
                rows.forEachIndexed { index, (title, value) ->
                    if (index > 0) Hairline()
                    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(title, style = Theme.text(Theme.Style.Body))
                        Text(
                            value,
                            style = Theme.text(Theme.Style.Body),
                            color = Theme.colors.secondaryText,
                            textAlign = TextAlign.End,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Passages(ship: Ship) {
    val list = ship.passages ?: listOfNotNull(ship.passage)
    if (list.isEmpty()) return
    val colors = Theme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel("Under the bridge")
        Card(padding = 0.dp) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 2.dp)) {
                list.take(10).forEachIndexed { index, passage ->
                    if (index > 0) Hairline()
                    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(
                            if (passage.direction == Direction.Upbound) Icons.Filled.ArrowUpward else Icons.Filled.ArrowDownward,
                            contentDescription = null,
                            tint = colors.color(passage.direction),
                            modifier = Modifier.width(20.dp),
                        )
                        Text(passage.direction.label, modifier = Modifier.weight(1f))
                        Text(Format.dateTime(passage.time), style = Theme.figure(Theme.Style.Subheadline, 500), color = colors.secondaryText)
                    }
                }
            }
        }
    }
}

@Composable
private fun Links(ship: Ship) {
    val context = LocalContext.current
    val colors = Theme.colors
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel("More about this ship")
        Card(padding = 0.dp) {
            Column(Modifier.padding(vertical = 2.dp)) {
                ShipLinks.forShip(ship).forEachIndexed { index, link ->
                    if (index > 0) Box(Modifier.padding(horizontal = 16.dp)) { Hairline() }
                    Row(
                        Modifier.fillMaxWidth().clickable { openUrl(context, link.url) }.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(link.kind.icon, contentDescription = null, tint = colors.signal, modifier = Modifier.width(24.dp))
                        Text(link.title, modifier = Modifier.weight(1f))
                        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = colors.tertiaryText, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

private val ExternalLink.Kind.icon: ImageVector
    get() = when (this) {
        ExternalLink.Kind.Search -> Icons.Filled.TravelExplore
        ExternalLink.Kind.Map -> Icons.Filled.Map
        ExternalLink.Kind.Book -> Icons.AutoMirrored.Filled.MenuBook
        ExternalLink.Kind.Data -> Icons.AutoMirrored.Filled.ListAlt
        ExternalLink.Kind.Photo -> Icons.Filled.Photo
        ExternalLink.Kind.Registry -> Icons.Filled.AccountBalance
    }

/**
 * The ship and the bridge on a map, the ship drawn as on the live map. Full screen
 * ([interactive]) it pans and zooms, with every other ship heard lately.
 */
@Composable
private fun ShipPositionMap(ship: Ship, position: Position, interactive: Boolean) {
    val graph = LocalContext.current.graph
    val motion = remember { ShipMotion() }
    var version by remember { mutableIntStateOf(0) }
    var others by remember { mutableStateOf<List<Ship>>(emptyList()) }
    var latest by remember { mutableStateOf(position) }
    val followed = ship.copy(position = latest)

    LaunchedEffect(interactive) {
        motion.update(listOf(followed))
        version++
        if (!interactive) return@LaunchedEffect
        // Polls only while full screen; a failed poll just keeps the last ships
        while (true) {
            runCatching { graph.api.map() }.getOrNull()?.let { snapshot ->
                // This ship's position from the map's latest poll when newer than the page's
                snapshot.ships.firstOrNull { it.mmsi == ship.mmsi }?.position
                    ?.takeIf { it.time.isAfter(latest.time) }?.let { latest = it }
                others = snapshot.ships.filter { it.mmsi != ship.mmsi && it.position != null }
                motion.update(others + ship.copy(position = latest))
                version++
            }
            delay(MAP_POLL_INTERVAL_MS)
        }
    }

    ShipMap(
        // This ship last, so it's drawn over the others; picked out when they're shown
        ships = others + followed,
        motion = motion,
        motionVersion = version,
        frame = MapFrame.Fit(Coordinate(position.latitude, position.longitude), Coordinate(Bridge.LATITUDE, Bridge.LONGITUDE)),
        modifier = Modifier.fillMaxSize(),
        interactive = interactive,
        highlighted = ship.mmsi,
    )
}

/** A full-screen page over everything, with a title and Done (iOS: fullScreenCover) */
@Composable
fun FullScreenDialog(onDismiss: () -> Unit, title: String, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        BridgeViewTheme(dark = Theme.colors.isDark) {
            Column(Modifier.fillMaxSize().background(Theme.colors.background)) {
                Row(
                    Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(48.dp))
                    Text(
                        title,
                        style = Theme.hull(Theme.Style.Headline, heavy = false),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    TextButton(onClick = onDismiss) { Text("Done", fontWeight = FontWeight.SemiBold) }
                }
                Box(Modifier.weight(1f)) { content() }
            }
        }
    }
}
