package app.bridgeview.net

import app.bridgeview.AppConfig
import app.bridgeview.model.BridgeSnapshot
import app.bridgeview.model.DeviceRegistration
import app.bridgeview.model.MapSnapshot
import app.bridgeview.model.PhotoReport
import app.bridgeview.model.Ship
import app.bridgeview.model.ShipSummaries
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The BridgeView server's HTTP API (ios/API.md) */
class ApiClient(
    private val baseUrl: HttpUrl = AppConfig.apiUrl.toHttpUrl(),
    private val client: OkHttpClient = defaultClient,
    /** X-BridgeView-Device, so a photo sender can be banned (there are no accounts) */
    private val deviceId: () -> String? = { null },
) {
    companion object {
        val defaultClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .addInterceptor { chain ->
                    chain.proceed(chain.request().newBuilder().header("User-Agent", AppConfig.userAgent).build())
                }
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build()
        }
        private val jsonType = "application/json".toMediaType()
        private val jpegType = "image/jpeg".toMediaType()
    }

    suspend fun bridge(): BridgeSnapshot = get("api/bridge")

    suspend fun map(): MapSnapshot = get("api/map")

    suspend fun ship(mmsi: Int): Ship = get("api/ships/$mmsi")

    /** Ships matching the search box, best match first (up to 25) */
    suspend fun searchShips(query: String): ShipSummaries = get("api/ships", mapOf("q" to query))

    /** The favourites, in the order given; ships the server doesn't know are left out */
    suspend fun shipsByMmsi(mmsis: List<Int>): ShipSummaries =
        if (mmsis.isEmpty()) ShipSummaries(emptyList()) else get("api/ships", mapOf("mmsi" to mmsis.joinToString(",")))

    suspend fun register(deviceToken: String, registration: DeviceRegistration) {
        val request = Request.Builder()
            .url(url("api/devices/${encode(deviceToken)}"))
            .put(ApiJson.encodeToString(DeviceRegistration.serializer(), registration).toRequestBody(jsonType))
            .build()
        execute(request, handle = ::check)
    }

    /** Shares a photo of a ship; it waits for approval before anyone sees it */
    suspend fun sharePhoto(mmsi: Int, jpeg: ByteArray, credit: String?, note: String?) {
        val url = url("api/ships/$mmsi/photos").newBuilder().apply {
            if (!credit.isNullOrEmpty()) addQueryParameter("artist", credit)
            if (!note.isNullOrEmpty()) addQueryParameter("note", note)
        }.build()
        val request = Request.Builder()
            .url(url)
            .post(jpeg.toRequestBody(jpegType))
            .withDevice()
            .build()
        val upload = client.newBuilder().writeTimeout(120, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build()
        execute(request, upload, ::checkExplained)
    }

    /** Reports one of the ship's photos; BridgeView checks it and may hide it */
    suspend fun reportPhoto(mmsi: Int, report: PhotoReport) {
        val request = Request.Builder()
            .url(url("api/ships/$mmsi/photos/report"))
            .post(ApiJson.encodeToString(PhotoReport.serializer(), report).toRequestBody(jsonType))
            .withDevice()
            .build()
        execute(request, handle = ::checkExplained)
    }

    private fun Request.Builder.withDevice(): Request.Builder = apply {
        deviceId()?.let { header("X-BridgeView-Device", it) }
    }

    private fun encode(segment: String) = java.net.URLEncoder.encode(segment, "UTF-8").replace("+", "%20")

    private fun url(path: String): HttpUrl = baseUrl.newBuilder().addEncodedPathSegments(path).build()

    private suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap()): T {
        // API v2: ship details may come from the vessel registers alone, without Wikidata
        val target = url(path).newBuilder().apply {
            query.forEach { (name, value) -> addQueryParameter(name, value) }
            addQueryParameter("v", "2")
        }.build()
        val request = Request.Builder()
            .url(target)
            .header("Accept", "application/json")
            .build()
        val text = execute(request) { response ->
            check(response)
            response.body.string()
        }
        return withContext(Dispatchers.Default) { ApiJson.decodeFromString<T>(text) }
    }

    private fun check(response: Response) {
        if (response.code == 404) throw ApiError.NotFound
        if (!response.isSuccessful) throw ApiError.Status(response.code)
    }

    /**
     * Like [check], but uses the server's own explanation when it has one
     * (for requests it refuses for reasons worth showing: banned, too many, …)
     */
    private fun checkExplained(response: Response) {
        if (!response.isSuccessful) {
            val message = runCatching {
                ApiJson.parseToJsonElement(response.body.string()).jsonObject["error"]?.jsonPrimitive?.content
            }.getOrNull()
            if (message != null) throw ApiError.Server(message)
        }
        check(response)
    }

    /**
     * Sends the request and hands the response to `handle` on the IO dispatcher, which
     * reads its body: reading it on the main thread blocks on the network
     */
    private suspend fun <T> execute(request: Request, using: OkHttpClient = client, handle: (Response) -> T): T {
        val response = send(request, using)
        return withContext(Dispatchers.IO) { response.use(handle) }
    }

    private suspend fun send(request: Request, using: OkHttpClient): Response =
        suspendCancellableCoroutine { continuation ->
            val call = using.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (!continuation.isCancelled) continuation.resumeWithException(e)
                }

                override fun onResponse(call: Call, response: Response) {
                    continuation.resume(response) { _, _, _ -> response.close() }
                }
            })
        }
}
