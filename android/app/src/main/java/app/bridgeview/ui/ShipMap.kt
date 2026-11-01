package app.bridgeview.ui

import android.graphics.PointF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.bridgeview.model.Bridge
import app.bridgeview.model.Coordinate
import app.bridgeview.model.METRES_PER_DEGREE_LATITUDE
import app.bridgeview.model.Ship
import app.bridgeview.model.ShipMotion
import app.bridgeview.model.isUnderWay
import kotlinx.coroutines.delay
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import java.time.Instant
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max

/** Where a map is looking, kept so it comes back where it was (e.g. after switching tabs) */
class MapCamera(var target: LatLng, var zoom: Double)

/** How a map first frames its ships */
sealed interface MapFrame {
    data class Camera(val camera: MapCamera) : MapFrame
    /** Fit both points with some margin (the ship and the bridge) */
    data class Fit(val a: Coordinate, val b: Coordinate) : MapFrame
}

private const val LIGHT_STYLE = "https://tiles.openfreemap.org/styles/bright"
private const val DARK_STYLE = "https://tiles.openfreemap.org/styles/fiord"

/**
 * A map of the river with the bridge and ships on it. Ships are drawn over the map
 * (not as map symbols) so they can glide between reports: each frame while any
 * ship moves, every ship is placed where [motion] says it is now.
 */
@Composable
fun ShipMap(
    ships: List<Ship>,
    motion: ShipMotion,
    /** Bumped whenever [motion] takes in new reports, so the map redraws */
    motionVersion: Int,
    frame: MapFrame,
    modifier: Modifier = Modifier,
    interactive: Boolean = true,
    selected: Int? = null,
    onSelect: (Int) -> Unit = {},
    /** Drawn over the others and picked out (the ship whose page this is) */
    highlighted: Int? = null,
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val dark = Theme.colors.isDark
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var map by remember { mutableStateOf<MapLibreMap?>(null) }
    var cameraTick by remember { mutableIntStateOf(0) }
    var frameTime by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val currentShips by rememberUpdatedState(ships)
    val currentSelect by rememberUpdatedState(onSelect)

    val mapView = remember {
        MapLibre.getInstance(context)
        MapView(context, MapLibreMapOptions.createFromAttributes(context).textureMode(true)).apply { onCreate(null) }
    }

    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> mapView.onStart()
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                Lifecycle.Event.ON_STOP -> mapView.onStop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) mapView.onStart()
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) mapView.onResume()
        onDispose {
            lifecycle.removeObserver(observer)
            (frame as? MapFrame.Camera)?.camera?.let { saved ->
                map?.cameraPosition?.let { position ->
                    position.target?.let { saved.target = it }
                    saved.zoom = position.zoom
                }
            }
            mapView.onPause()
            mapView.onStop()
            mapView.onDestroy()
        }
    }

    LaunchedEffect(mapView) {
        mapView.getMapAsync { m ->
            m.uiSettings.apply {
                // No rotating: the ship markers point north-up
                isRotateGesturesEnabled = false
                isTiltGesturesEnabled = false
                isCompassEnabled = false
                isLogoEnabled = false
                isAttributionEnabled = true
                setAllGesturesEnabled(interactive)
                isRotateGesturesEnabled = false
                isTiltGesturesEnabled = false
            }
            when (frame) {
                is MapFrame.Camera -> m.cameraPosition = CameraPosition.Builder()
                    .target(frame.camera.target).zoom(frame.camera.zoom).build()
                is MapFrame.Fit -> mapView.post {
                    m.moveCamera(CameraUpdateFactory.newLatLngBounds(fitBounds(frame.a, frame.b), 0))
                    cameraTick++
                }
            }
            m.addOnCameraMoveListener { cameraTick++ }
            m.addOnCameraIdleListener { cameraTick++ }
            if (interactive) {
                m.addOnMapClickListener { point ->
                    val tap = m.projection.toScreenLocation(point)
                    val hit = with(density) { 24.dp.toPx() }
                    val now = Instant.now()
                    val nearest = currentShips.mapNotNull { ship ->
                        val drawn = motion.drawn(ship, now) ?: return@mapNotNull null
                        val p = m.projection.toScreenLocation(LatLng(drawn.coordinate.latitude, drawn.coordinate.longitude))
                        ship to hypot((p.x - tap.x).toDouble(), (p.y - tap.y).toDouble())
                    }.filter { it.second <= hit }.minByOrNull { it.second }
                    nearest?.let { currentSelect(it.first.mmsi) }
                    nearest != null
                }
            }
            map = m
        }
    }

    LaunchedEffect(map, dark) {
        map?.setStyle(if (dark) DARK_STYLE else LIGHT_STYLE)
    }

    // Redrawn every frame while ships move, so they glide between reports
    LaunchedEffect(motion, motionVersion) {
        while (true) {
            if (motion.isMoving(Instant.now())) {
                withFrameMillis { frameTime = System.currentTimeMillis() }
            } else {
                frameTime = System.currentTimeMillis()
                delay(500)
            }
        }
    }

    val measurer = rememberTextMeasurer()
    val colors = Theme.colors
    Box(modifier) {
        AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())
        Canvas(Modifier.fillMaxSize()) {
            @Suppress("UNUSED_EXPRESSION") cameraTick
            val m = map ?: return@Canvas
            val now = Instant.ofEpochMilli(frameTime)
            val projection = m.projection
            fun screen(c: Coordinate): Offset =
                projection.toScreenLocation(LatLng(c.latitude, c.longitude)).let { Offset(it.x, it.y) }

            // Ground metres across one pixel, so hulls are drawn to scale
            val centre = PointF(size.width / 2, size.height / 2)
            val a = projection.fromScreenLocation(centre)
            val b = projection.fromScreenLocation(PointF(centre.x, centre.y + 100f))
            val metresPerPx = abs(a.latitude - b.latitude) * METRES_PER_DEGREE_LATITUDE / 100

            drawBridge(screen(Coordinate(Bridge.LATITUDE, Bridge.LONGITUDE)), measurer)

            val ordered = ships.sortedBy { (it.mmsi == highlighted || it.mmsi == selected) }
            for (ship in ordered) {
                val drawn = motion.drawn(ship, now) ?: continue
                val isSelected = ship.mmsi == selected || (ship.mmsi == highlighted && interactive)
                val point = screen(drawn.coordinate)
                if (point.x < -100 || point.y < -100 || point.x > size.width + 100 || point.y > size.height + 100) continue
                drawShip(ship, point, drawn.course, isSelected, metresPerPx, colors)
                if (ship.mmsi == selected) drawLabel(ship.name, point + Offset(0f, 22.dp.toPx()), measurer)
            }
            if (interactive && metresPerPx > 0) drawScale(metresPerPx, measurer, colors.isDark)
        }
    }
}

/** A box around both points with some margin */
private fun fitBounds(a: Coordinate, b: Coordinate): LatLngBounds {
    val north = max(a.latitude, b.latitude)
    val south = minOf(a.latitude, b.latitude)
    val east = max(a.longitude, b.longitude)
    val west = minOf(a.longitude, b.longitude)
    val heightM = (north - south) * METRES_PER_DEGREE_LATITUDE
    val widthM = (east - west) * METRES_PER_DEGREE_LATITUDE * cos(Math.toRadians(a.latitude))
    val marginM = max(max(heightM, widthM) * 0.3, 3000.0)
    val dLat = marginM / METRES_PER_DEGREE_LATITUDE
    val dLon = marginM / (METRES_PER_DEGREE_LATITUDE * cos(Math.toRadians(a.latitude)))
    return LatLngBounds.Builder()
        .include(LatLng(north + dLat, east + dLon))
        .include(LatLng(south - dLat, west - dLon))
        .build()
}

// The smallest a hull is drawn, in dp
private const val MIN_LENGTH = 18f
private const val MIN_BEAM = 6f
// Pleasure craft stay smaller than the ships they share the river with
private const val MIN_LENGTH_CLASS_B = 10f
private const val MIN_BEAM_CLASS_B = 4f

/**
 * A ship on the map. Ships that send their size are drawn as a hull to scale
 * (square stern, pointed bow), turned to their heading and kept big enough to see
 * when zoomed out; others are an arrow along their course when under way, a dot
 * when not. Ships heading for the bridge take their direction's colour.
 */
private fun DrawScope.drawShip(ship: Ship, at: Offset, course: Double?, selected: Boolean, metresPerPx: Double, colors: Palette) {
    val color = ship.approach?.direction?.let(colors::color) ?: if (ship.classB == true) Color.Gray else colors.signal
    val small = ship.classB == true
    val heading = course ?: ship.position?.course
    val length = ship.length?.takeIf { it > 0 }
    if (length != null && heading != null && metresPerPx > 0) {
        // Servers before the map sent widths: a typical laker's proportions
        val beam = ship.width?.takeIf { it > 0 }?.toDouble() ?: (length * 0.14)
        val minLength = (if (small) MIN_LENGTH_CLASS_B else MIN_LENGTH).dp.toPx()
        val minBeam = (if (small) MIN_BEAM_CLASS_B else MIN_BEAM).dp.toPx()
        // Blown up evenly to the minimum length, then widened further if still too thin
        val scale = max(1 / metresPerPx, minLength / length.toDouble())
        val hullLength = (length * scale).toFloat()
        val hullBeam = max((beam * scale).toFloat(), minBeam)
        val path = hullPath(hullBeam, hullLength)
        translate(at.x, at.y) {
            rotate(heading.toFloat(), pivot = Offset.Zero) {
                drawPath(path, Color.Black.copy(alpha = if (selected) 0.45f else 0.25f), style = Stroke((if (selected) 5 else 3).dp.toPx()))
                drawPath(path, color)
                drawPath(path, if (selected) Color.White else Color.White.copy(alpha = 0.85f), style = Stroke((if (selected) 2.5f else 1f).dp.toPx()))
            }
        }
        return
    }
    if (selected) drawCircle(Color.White.copy(alpha = 0.85f), radius = (if (small) 12 else 17).dp.toPx(), center = at)
    val position = ship.position
    if (position != null && position.isUnderWay && heading != null) {
        val s = (if (small) 7f else 11f).dp.toPx()
        val arrow = Path().apply {
            moveTo(0f, -s)
            lineTo(s * 0.75f, s)
            lineTo(0f, s * 0.5f)
            lineTo(-s * 0.75f, s)
            close()
        }
        translate(at.x, at.y) {
            rotate(heading.toFloat(), pivot = Offset.Zero) {
                drawPath(arrow, Color.Black.copy(alpha = 0.3f), style = Stroke(2.dp.toPx()))
                drawPath(arrow, color)
            }
        }
    } else {
        val r = (if (small) 3.5f else 6f).dp.toPx()
        drawCircle(Color.Black.copy(alpha = 0.3f), radius = r + 1.dp.toPx(), center = at)
        drawCircle(color, radius = r, center = at)
    }
}

/** A hull seen from above, centred on the origin, bow up: square stern, straight sides, pointed bow */
private fun hullPath(width: Float, height: Float): Path {
    val bow = minOf(width, height * 0.2f)
    val left = -width / 2
    val right = width / 2
    val top = -height / 2
    val bottom = height / 2
    return Path().apply {
        moveTo(left, bottom)
        lineTo(right, bottom)
        lineTo(right, top + bow)
        lineTo(0f, top)
        lineTo(left, top + bow)
        close()
    }
}

/** The bridge: a grey pin with an arch, and its name */
private fun DrawScope.drawBridge(at: Offset, measurer: androidx.compose.ui.text.TextMeasurer) {
    val r = 13.dp.toPx()
    drawCircle(Color.Black.copy(alpha = 0.25f), radius = r + 1.5.dp.toPx(), center = at)
    drawCircle(Color(0xFF7A8794), radius = r, center = at)
    val arch = Path().apply {
        moveTo(at.x - r * 0.6f, at.y + r * 0.25f)
        quadraticTo(at.x, at.y - r * 0.85f, at.x + r * 0.6f, at.y + r * 0.25f)
    }
    drawPath(arch, Color.White, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
    drawLine(Color.White, Offset(at.x - r * 0.7f, at.y + r * 0.1f), Offset(at.x + r * 0.7f, at.y + r * 0.1f), 1.6.dp.toPx(), StrokeCap.Round)
    drawLabel(Bridge.NAME, at + Offset(0f, r + 10.dp.toPx()), measurer, Color(0xFF55606B))
}

/** A name under a marker, with a white halo so it reads on the map */
private fun DrawScope.drawLabel(text: String, at: Offset, measurer: androidx.compose.ui.text.TextMeasurer, color: Color = Color(0xFF0B1A26)) {
    val style = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    val layout = measurer.measure(text, style, constraints = Constraints(maxWidth = 220.dp.roundToPx()))
    val topLeft = Offset(at.x - layout.size.width / 2f, at.y - layout.size.height / 2f)
    drawRoundRect(
        Color.White.copy(alpha = 0.8f),
        topLeft = topLeft - Offset(4.dp.toPx(), 1.dp.toPx()),
        size = Size(layout.size.width + 8.dp.toPx(), layout.size.height + 2.dp.toPx()),
        cornerRadius = CornerRadius(4.dp.toPx()),
    )
    drawText(layout, color = color, topLeft = topLeft)
}

/** A scale bar in the bottom-left corner (iOS: MapScaleView) */
private fun DrawScope.drawScale(metresPerPx: Double, measurer: androidx.compose.ui.text.TextMeasurer, dark: Boolean) {
    val target = 90.dp.toPx() * metresPerPx
    val steps = listOf(50.0, 100.0, 200.0, 500.0, 1000.0, 2000.0, 5000.0, 10_000.0, 20_000.0, 50_000.0)
    val metres = steps.lastOrNull { it <= target } ?: steps.first()
    val length = (metres / metresPerPx).toFloat()
    val label = if (metres >= 1000) "${(metres / 1000).toInt()} km" else "${metres.toInt()} m"
    val color = if (dark) Color.White else Color(0xFF0B1A26)
    val x = 16.dp.toPx()
    val y = size.height - 28.dp.toPx()
    drawLine(color, Offset(x, y), Offset(x + length, y), 2.dp.toPx())
    drawLine(color, Offset(x, y - 4.dp.toPx()), Offset(x, y + 1.dp.toPx()), 2.dp.toPx())
    drawLine(color, Offset(x + length, y - 4.dp.toPx()), Offset(x + length, y + 1.dp.toPx()), 2.dp.toPx())
    val layout = measurer.measure(label, TextStyle(fontSize = 10.sp, fontWeight = FontWeight.SemiBold))
    drawText(layout, color = color, topLeft = Offset(x, y - 6.dp.toPx() - layout.size.height))
}
