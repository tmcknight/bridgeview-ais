package app.bridgeview

import app.bridgeview.model.AlertPreferences
import app.bridgeview.model.DeviceRegistration
import app.bridgeview.model.PhotoReport
import app.bridgeview.model.PhotoReportReason
import app.bridgeview.net.ApiClient
import app.bridgeview.net.ApiError
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.net.SocketTimeoutException

class ApiClientTest {
    private val server = MockWebServer()
    private lateinit var api: ApiClient

    @Before fun setUp() {
        server.start()
        api = ApiClient(server.url("/"), OkHttpClient(), deviceId = { "device-1" })
    }

    @After fun tearDown() = server.close()

    @Test fun asksForApiVersion2() = runTest {
        server.enqueue(MockResponse.Builder().body("""{"generatedAt":"2026-10-30T14:02:11Z","upcoming":[],"recent":[]}""").build())
        api.bridge()
        assertEquals("/api/bridge?v=2", server.takeRequest().target)
    }

    @Test fun registersWithTheTokenInThePath() = runTest {
        server.enqueue(MockResponse.Builder().code(204).build())
        val token = "cX1:APA91b-abc_DEF"
        api.register(token, DeviceRegistration.from(AlertPreferences(), countdownsAllowed = true))
        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertEquals("/api/devices/cX1%3AAPA91b-abc_DEF", request.target)
        assertTrue(request.body!!.utf8().contains("\"platform\":\"android\""))
    }

    @Test fun mapsNotFoundAndStatus() = runTest {
        server.enqueue(MockResponse.Builder().code(404).build())
        try { api.ship(1); fail() } catch (e: ApiError) { assertTrue(e is ApiError.NotFound) }
        server.enqueue(MockResponse.Builder().code(503).build())
        try { api.ship(1); fail() } catch (e: ApiError.Status) { assertEquals(503, e.code) }
    }

    @Test fun showsTheServersOwnExplanation() = runTest {
        server.enqueue(MockResponse.Builder().code(429).body("""{"error":"Too many photos. Try again in an hour."}""").build())
        try {
            api.sharePhoto(316001234, byteArrayOf(1, 2, 3), "Pete", null)
            fail()
        } catch (e: ApiError.Server) {
            assertEquals("Too many photos. Try again in an hour.", e.message)
        }
        val request = server.takeRequest()
        assertEquals("/api/ships/316001234/photos?artist=Pete", request.target)
        assertEquals("device-1", request.headers["X-BridgeView-Device"])
        assertEquals("image/jpeg", request.headers["Content-Type"])
    }

    @Test fun reportsPhotos() = runTest {
        server.enqueue(MockResponse.Builder().code(202).body("""{"status":"received"}""").build())
        api.reportPhoto(316001234, PhotoReport("https://x/a.jpg", PhotoReportReason.WrongShip))
        val body = server.takeRequest().body!!.utf8()
        assertEquals("""{"url":"https://x/a.jpg","reason":"wrong-ship"}""", body)
    }

    @Test fun explainsErrorsInPlainWords() {
        assertEquals("Too many requests to BridgeView. Try again in a minute.", ApiError.message(ApiError.Status(429)))
        assertTrue(ApiError.message(ApiError.Status(502)).contains("having trouble (502)"))
        assertTrue(ApiError.message(java.net.UnknownHostException(), online = false).startsWith("You're offline"))
        assertTrue(ApiError.message(java.net.UnknownHostException(), online = true).contains("isn't answering"))
        assertTrue(ApiError.message(SocketTimeoutException()).contains("taking too long"))
    }
}
