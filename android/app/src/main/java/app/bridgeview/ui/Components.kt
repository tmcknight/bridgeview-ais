package app.bridgeview.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import android.provider.Settings
import androidx.compose.animation.core.withInfiniteAnimationFrameMillis
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.bridgeview.model.Attribution
import kotlinx.coroutines.delay
import java.time.Instant
import kotlin.math.PI
import kotlin.math.sin

/** Keeps cards and text to a comfortable width, centred, on wide screens (foldables, tablets, landscape) */
fun Modifier.readableWidth(): Modifier = this.widthIn(max = 640.dp)

/** The current time, ticking every `intervalMs` while on screen (for countdowns and "5 min ago") */
@Composable
fun rememberNow(intervalMs: Long = 1_000): State<Instant> = produceState(Instant.now(), intervalMs) {
    while (true) {
        value = Instant.now()
        delay(intervalMs - System.currentTimeMillis() % intervalMs)
    }
}

/** Seconds since start, advanced every frame (paused when the system turns animations off) */
@Composable
fun rememberAnimationSeconds(): State<Float> {
    val time = remember { mutableFloatStateOf(0f) }
    val context = LocalContext.current
    val reduceMotion = remember {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
    LaunchedEffect(reduceMotion) {
        if (reduceMotion) return@LaunchedEffect
        val start = withInfiniteAnimationFrameMillis { it }
        while (true) {
            withInfiniteAnimationFrameMillis { time.floatValue = (it - start) / 1000f }
        }
    }
    return time
}

/**
 * The screen background: the river's blue at the top, fading into fog (or night
 * water) with a few faint swells that drift slowly
 */
@Composable
fun RiverBackground(modifier: Modifier = Modifier) {
    val colors = Theme.colors
    val time by rememberAnimationSeconds()
    Canvas(modifier.fillMaxSize()) {
        drawRect(colors.background)
        drawRect(
            Brush.verticalGradient(listOf(colors.river.copy(alpha = 0.22f), colors.river.copy(alpha = 0f)), endY = 360.dp.toPx()),
            size = size.copy(height = 360.dp.toPx()),
        )
        drawSwells(time.toDouble(), top = 70.dp.toPx(), height = 140.dp.toPx(), color = colors.shallows.copy(alpha = 0.12f), width = 1.2.dp.toPx())
    }
}

/**
 * Three gentle, offset waves across the width, each drifting at its own pace and
 * swelling a little as `time` (seconds) moves on
 */
fun DrawScope.drawSwells(time: Double, top: Float, height: Float, color: Color, width: Float) {
    val path = Path()
    val drifts = doubleArrayOf(0.35, -0.25, 0.5)
    for (line in 0 until 3) {
        val y = top + line * height / 3 + 12.dp.toPx()
        val swell = 1 + 0.2 * sin(time * (0.4 + line * 0.13) + line)
        val amplitude = ((6 - line * 1.5) * swell).dp.toPx()
        val wavelength = size.width / (1.6f + line * 0.4f)
        val phase = line * 0.9 + (time * drifts[line]) % (2 * PI)
        path.moveTo(0f, (y + sin(phase) * amplitude).toFloat())
        var x = 0f
        while (x <= size.width) {
            path.lineTo(x, (y + sin(x / wavelength * 2 * PI + phase) * amplitude).toFloat())
            x += 4.dp.toPx()
        }
    }
    drawPath(path, color, style = Stroke(width))
}

/** A rounded surface with a hairline edge */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(Theme.cornerRadius)
    Column(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(colors.surface)
            .border(1.dp, colors.hairline, shape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

/** A thin rule between rows in a card */
@Composable
fun Hairline() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Theme.colors.hairline))
}

/** Small caps label above a group of cards */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = Theme.text(Theme.Style.Caption, FontWeight.Bold).copy(letterSpacing = 1.4.sp),
        color = Theme.colors.secondaryText,
        modifier = modifier.fillMaxWidth().padding(horizontal = 4.dp).semantics { heading() },
    )
}

/** A figure with a label under it, for the ship page */
@Composable
fun Stat(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(value, style = Theme.figure(Theme.Style.Title3), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            label.uppercase(),
            style = Theme.text(Theme.Style.Caption2, FontWeight.SemiBold).copy(letterSpacing = 0.8.sp),
            color = Theme.colors.secondaryText,
        )
    }
}

/** A capsule for small controls floating over content (iOS: Liquid Glass) */
@Composable
fun Pill(
    modifier: Modifier = Modifier,
    onDark: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable BoxScope.() -> Unit,
) {
    val colors = Theme.colors
    val background = when {
        onDark -> Color.Black.copy(alpha = 0.35f)
        else -> colors.surface.copy(alpha = 0.92f)
    }
    Box(
        modifier
            .clip(CircleShape)
            .background(background)
            .border(1.dp, if (onDark) Color.White.copy(alpha = 0.18f) else colors.hairline, CircleShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
        content = content,
    )
}

/**
 * The AIS feeds' credits from the server, each a link to its site. AISHub's terms
 * ask for "Data: AISHub contributors" clearly visible near the data.
 */
@Composable
fun DataCredits(attribution: List<Attribution>, modifier: Modifier = Modifier, alignStart: Boolean = false) {
    val context = LocalContext.current
    val colors = Theme.colors
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = if (alignStart) Arrangement.spacedBy(6.dp) else Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        attribution.forEachIndexed { index, credit ->
            if (index > 0) Text("·", style = Theme.text(Theme.Style.Caption2), color = colors.secondaryText)
            Text(
                credit.text,
                style = Theme.text(Theme.Style.Caption2),
                color = colors.secondaryText,
                maxLines = 1,
                modifier = Modifier.clickable { openUrl(context, credit.url) },
            )
        }
    }
}

/** Big icon, title, text and an optional button, for empty and error states (iOS: ContentUnavailableView) */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    action: Pair<String, () -> Unit>? = null,
) {
    val colors = Theme.colors
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = colors.secondaryText, modifier = Modifier.size(48.dp))
        Text(title, style = Theme.text(Theme.Style.Title3, FontWeight.Bold), textAlign = TextAlign.Center)
        Text(description, style = Theme.text(Theme.Style.Subheadline), color = colors.secondaryText, textAlign = TextAlign.Center)
        if (action != null) {
            Button(onClick = action.second, modifier = Modifier.padding(top = 6.dp)) { Text(action.first) }
        }
    }
}

/** Opens a web page or another app's link */
fun openUrl(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        // Nothing to open it with
    }
}

/** The app's page in system settings */
fun openAppSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}

/** The app's notification settings, or one channel's */
fun openNotificationSettings(context: Context, channel: String? = null) {
    val intent = if (channel != null) {
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_CHANNEL_ID, channel)
    } else {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
    }
    context.startActivity(intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
