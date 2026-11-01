package app.bridgeview.photo

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/** Getting a photo ready to share: no bigger than the server shows, as a JPEG */
object SharedPhoto {
    /** Longest side, in pixels */
    const val MAX_SIDE = 2048
    /** The server turns down photos smaller than this on their longest side (SHARED_PHOTO_SIZE in server/admin-api.js) */
    const val MIN_SIDE = 640

    /** Whether a photo this size is big enough to share */
    fun isBigEnough(width: Int, height: Int): Boolean = max(width, height) >= MIN_SIDE

    /** The size to redraw a photo at: at most [MAX_SIDE] across, never enlarged */
    fun targetSize(width: Int, height: Int): Pair<Int, Int> {
        val scale = minOf(1.0, MAX_SIDE.toDouble() / max(width, height))
        return (width * scale).roundToInt().coerceAtLeast(1) to (height * scale).roundToInt().coerceAtLeast(1)
    }

    class Prepared(val jpeg: ByteArray, val originalWidth: Int, val originalHeight: Int)

    /**
     * The photo decoded upright (ImageDecoder applies its EXIF orientation) and
     * redrawn at most [MAX_SIDE] across, as a JPEG. Re-encoding leaves out the
     * original's metadata (where it was taken, the camera); the server strips any
     * that's left too. Plain SDR: an HDR gain map would be cut off by the server.
     */
    fun prepare(resolver: ContentResolver, uri: Uri, quality: Int = 85): Prepared {
        var width = 0
        var height = 0
        val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            width = info.size.width
            height = info.size.height
            val (w, h) = targetSize(width, height)
            decoder.setTargetSize(w, h)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
        bitmap.recycle()
        return Prepared(out.toByteArray(), width, height)
    }

    /** The photo's size without decoding it all */
    fun size(resolver: ContentResolver, uri: Uri): Pair<Int, Int>? = runCatching {
        var size: Pair<Int, Int>? = null
        ImageDecoder.decodeDrawable(ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            size = info.size.width to info.size.height
            decoder.setTargetSize(1, 1)
        }
        size
    }.getOrNull()
}
