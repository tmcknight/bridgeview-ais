package app.bridgeview.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.bridgeview.model.VesselPhoto
import coil3.compose.SubcomposeAsyncImage

/**
 * A ship's photos, swiped one at a time. Swiping on from the last photo comes round
 * to the first, and back from the first to the last (a long run of pages, each
 * showing photo `page % count`, started in the middle).
 */
@Composable
fun PhotoPager(
    photos: List<VesselPhoto>,
    index: Int,
    onIndexChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    /** Stops swiping, e.g. while a photo is zoomed in */
    swipeEnabled: Boolean = true,
    page: @Composable (VesselPhoto) -> Unit,
) {
    val count = photos.size
    if (count == 0) return
    if (count == 1) {
        Box(modifier) { page(photos[0]) }
        return
    }
    val laps = 10_000
    val state = rememberPagerState(initialPage = count * (laps / 2) + index.coerceIn(0, count - 1)) { count * laps }
    LaunchedEffect(state, count) {
        snapshotFlow { state.currentPage }.collect { onIndexChange(it % count) }
    }
    // Set from outside, e.g. by the full-screen viewer
    LaunchedEffect(index, count) {
        val shown = state.currentPage % count
        if (shown != index) state.scrollToPage(state.currentPage - shown + index.coerceIn(0, count - 1))
    }
    HorizontalPager(state, modifier, userScrollEnabled = swipeEnabled, beyondViewportPageCount = 1) { slot ->
        Box(Modifier.fillMaxSize()) { page(photos[slot % count]) }
    }
}

/** A photo filling its box, with a placeholder while it loads or if it can't */
@Composable
fun FilledPhoto(url: String, modifier: Modifier = Modifier) {
    SubcomposeAsyncImage(
        model = url,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier.fillMaxSize(),
        loading = {
            PhotoPlaceholder {
                CircularProgressIndicator(color = Color.White, modifier = Modifier.size(28.dp), strokeWidth = 2.dp)
            }
        },
        error = { PhotoPlaceholder() },
    )
}

/** River blue with a ship, where there's no photo */
@Composable
fun PhotoPlaceholder(content: @Composable () -> Unit = {}) {
    val colors = Theme.colors
    Box(
        Modifier.fillMaxSize().background(
            androidx.compose.ui.graphics.Brush.linearGradient(listOf(colors.shallows, colors.river)),
        ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.DirectionsBoat,
            contentDescription = null,
            tint = Color.White.copy(alpha = 0.18f),
            modifier = Modifier.size(64.dp),
        )
        content()
    }
}

/** A ship's photos full screen: swipe through them, pinch or double-tap to zoom in */
@Composable
fun PhotoViewer(photos: List<VesselPhoto>, title: String, index: Int, onIndexChange: (Int) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var zoomed by remember { mutableStateOf(false) }
    val current = photos.getOrNull(index.coerceIn(0, (photos.size - 1).coerceAtLeast(0)))
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            PhotoPager(photos, index, onIndexChange, Modifier.fillMaxSize(), swipeEnabled = !zoomed) { photo ->
                ZoomablePhoto(photo.url) { zoomed = it }
            }
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().background(Color.Black.copy(alpha = 0.5f)).padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, contentDescription = "Done", tint = Color.White) }
                Text(
                    title,
                    color = Color.White,
                    style = Theme.text(Theme.Style.Headline, FontWeight.SemiBold),
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                val pageUrl = current?.pageUrl
                if (pageUrl != null) {
                    IconButton(onClick = { openUrl(context, pageUrl) }) {
                        Icon(Icons.Outlined.Info, contentDescription = "View on Wikimedia Commons", tint = Color.White)
                    }
                } else {
                    Box(Modifier.size(48.dp))
                }
            }
            AnimatedVisibility(
                !zoomed,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (photos.size > 1) {
                        Text("${index + 1} / ${photos.size}", color = Color.White, style = Theme.figure(Theme.Style.Caption, 600))
                    }
                    current?.credit?.let {
                        Text(it, color = Color.White.copy(alpha = 0.75f), style = Theme.text(Theme.Style.Caption2), textAlign = TextAlign.Center, maxLines = 2)
                    }
                }
            }
        }
    }
}

private const val MAX_SCALE = 5f
private const val DOUBLE_TAP_SCALE = 2.5f

/** One photo, fitted to the screen; pinch or double-tap to zoom in, drag to look around */
@Composable
private fun ZoomablePhoto(url: String, onZoomed: (Boolean) -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    fun reset() {
        scale = 1f
        offset = Offset.Zero
        onZoomed(false)
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val width = constraints.maxWidth.toFloat()
        val height = constraints.maxHeight.toFloat()
        // Keeps the zoomed photo covering the screen as far as it can
        fun clamped(value: Offset): Offset {
            val maxX = width * (scale - 1) / 2
            val maxY = height * (scale - 1) / 2
            return Offset(value.x.coerceIn(-maxX, maxX), value.y.coerceIn(-maxY, maxY))
        }
        SubcomposeAsyncImage(
            model = url,
            contentDescription = "Photo",
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(onDoubleTap = { tap ->
                        if (scale > 1f) {
                            reset()
                        } else {
                            scale = DOUBLE_TAP_SCALE
                            // Zoom in on the spot tapped
                            offset = clamped(Offset((width / 2 - tap.x) * (scale - 1), (height / 2 - tap.y) * (scale - 1)))
                            onZoomed(true)
                        }
                    })
                }
                .pointerInput(Unit) {
                    // Pinch any time; drag only while zoomed in (otherwise the drag swipes to the next photo)
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        do {
                            val event = awaitPointerEvent()
                            if (event.changes.size > 1 || scale > 1f) {
                                scale = (scale * event.calculateZoom()).coerceIn(1f, MAX_SCALE)
                                offset = clamped(offset + event.calculatePan())
                                onZoomed(scale > 1f)
                                event.changes.forEach { if (it.positionChanged()) it.consume() }
                            }
                        } while (event.changes.any { it.pressed })
                        if (scale < 1.05f) reset()
                    }
                }
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                    translationX = offset.x
                    translationY = offset.y
                },
            loading = { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Color.White) } },
            error = {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Image, contentDescription = null, tint = Color.White.copy(alpha = 0.4f), modifier = Modifier.size(48.dp))
                }
            },
        )
    }
}
