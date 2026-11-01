package app.bridgeview.net

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.OffsetDateTime

/** The REST API's ISO 8601 dates, with or without fractional seconds */
object InstantSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Instant = parse(decoder.decodeString())

    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())

    fun parse(text: String): Instant =
        runCatching { Instant.parse(text) }.getOrElse { OffsetDateTime.parse(text).toInstant() }
}

val ApiJson = Json {
    ignoreUnknownKeys = true
    // Optional fields are omitted, never null
    explicitNulls = false
    encodeDefaults = true
    coerceInputValues = true
}
