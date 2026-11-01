package app.bridgeview.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.bridgeview.R
import app.bridgeview.model.Direction

/**
 * BridgeView's look: river navy, international-orange signal accent, and ship
 * names set wide like hull lettering. Colours from ios/Shared/Theme.swift.
 */
@Immutable
data class Palette(
    val isDark: Boolean,
    /** Screen background: harbour fog by day, the river at night */
    val background: Color,
    /** Cards and grouped rows */
    val surface: Color,
    /** Dividers and card outlines */
    val hairline: Color,
    /** Deep river blue for headers and the hero card */
    val river: Color,
    /** Lighter blue the river fades to */
    val shallows: Color,
    /** International orange, like the paint on navigation marks; the app's tint */
    val signal: Color,
    val upbound: Color,
    val downbound: Color,
    val primaryText: Color,
    val secondaryText: Color,
    val tertiaryText: Color,
) {
    fun color(direction: Direction?): Color = when (direction) {
        Direction.Upbound -> upbound
        Direction.Downbound -> downbound
        null -> Color.Gray
    }
}

private fun hex(value: Long, alpha: Float = 1f) = Color(
    red = ((value shr 16) and 0xFF) / 255f,
    green = ((value shr 8) and 0xFF) / 255f,
    blue = (value and 0xFF) / 255f,
    alpha = alpha,
)

val LightPalette = Palette(
    isDark = false,
    background = hex(0xEDF2F5),
    surface = hex(0xFFFFFF),
    hairline = hex(0x0A3C61, 0.10f),
    river = hex(0x0A3C61),
    shallows = hex(0x1A6A9A),
    signal = hex(0xD9530F),
    upbound = hex(0x0B8A7A),
    downbound = hex(0x4651C8),
    primaryText = hex(0x0B1A26),
    secondaryText = hex(0x3C4A57, 0.85f),
    tertiaryText = hex(0x3C4A57, 0.45f),
)

val DarkPalette = Palette(
    isDark = true,
    background = hex(0x07121D),
    surface = hex(0x0F2133),
    hairline = hex(0x8FB8DE, 0.14f),
    river = hex(0x0B2A47),
    shallows = hex(0x134770),
    signal = hex(0xFF8A3D),
    upbound = hex(0x34D2BC),
    downbound = hex(0x8F98FF),
    primaryText = hex(0xF2F6FA),
    secondaryText = hex(0xC4D3E0, 0.75f),
    tertiaryText = hex(0xC4D3E0, 0.4f),
)

/** Signal orange that reads on the river blue in either mode */
val SignalOnRiver = hex(0xFF9A52)

val LocalPalette = staticCompositionLocalOf { LightPalette }

object Theme {
    val colors: Palette
        @Composable @ReadOnlyComposable get() = LocalPalette.current

    val cornerRadius = 18.dp

    /** Text sizes after iOS's text styles */
    enum class Style(val size: TextUnit) {
        LargeTitle(34.sp), Title(28.sp), Title2(22.sp), Title3(20.sp), Headline(17.sp), Body(17.sp),
        Subheadline(15.sp), Footnote(13.sp), Caption(12.sp), Caption2(11.sp),
    }

    private fun flex(weight: Int, width: Float) = FontFamily(
        Font(
            R.font.roboto_flex,
            FontWeight(weight),
            variationSettings = FontVariation.Settings(FontVariation.weight(weight), FontVariation.width(width)),
        ),
    )

    private val hullHeavy = flex(900, 140f)
    private val hullBold = flex(700, 140f)
    private val figureFamilies = mapOf(500 to flex(500, 100f), 600 to flex(600, 100f), 700 to flex(700, 100f), 800 to flex(800, 100f), 900 to flex(900, 100f))

    /** Ship names, wide and heavy like the lettering on a hull */
    fun hull(style: Style, heavy: Boolean = true) = TextStyle(
        fontFamily = if (heavy) hullHeavy else hullBold,
        fontWeight = FontWeight(if (heavy) 900 else 700),
        fontSize = style.size,
    )

    /** Countdowns and figures: digits that don't jump about */
    fun figure(style: Style, weight: Int = 700) = TextStyle(
        fontFamily = figureFamilies[weight] ?: figureFamilies.getValue(700),
        fontWeight = FontWeight(weight),
        fontSize = style.size,
        fontFeatureSettings = "tnum",
    )

    fun text(style: Style, weight: FontWeight = FontWeight.Normal) = TextStyle(fontSize = style.size, fontWeight = weight)
}

@Composable
fun BridgeViewTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val palette = if (dark) DarkPalette else LightPalette
    val scheme = if (dark) {
        darkColorScheme(
            primary = palette.signal,
            onPrimary = Color.Black,
            secondary = palette.shallows,
            background = palette.background,
            surface = palette.surface,
            surfaceContainer = palette.surface,
            onBackground = palette.primaryText,
            onSurface = palette.primaryText,
            onSurfaceVariant = palette.secondaryText,
            outlineVariant = palette.hairline,
        )
    } else {
        lightColorScheme(
            primary = palette.signal,
            onPrimary = Color.White,
            secondary = palette.shallows,
            background = palette.background,
            surface = palette.surface,
            surfaceContainer = palette.surface,
            onBackground = palette.primaryText,
            onSurface = palette.primaryText,
            onSurfaceVariant = palette.secondaryText,
            outlineVariant = palette.hairline,
        )
    }
    CompositionLocalProvider(LocalPalette provides palette) {
        MaterialTheme(colorScheme = scheme) {
            // Text outside a Material surface takes this colour, so it follows light and dark
            CompositionLocalProvider(LocalContentColor provides palette.primaryText, content = content)
        }
    }
}
