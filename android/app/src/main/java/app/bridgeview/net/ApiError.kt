package app.bridgeview.net

import kotlinx.serialization.SerializationException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

sealed class ApiError(message: String) : IOException(message) {
    class Status(val code: Int) : ApiError(
        when {
            code == 429 -> "Too many requests to BridgeView. Try again in a minute."
            code >= 500 -> "BridgeView's server is having trouble ($code). Try again in a few minutes."
            else -> "BridgeView's server answered with an error ($code)."
        },
    )

    object NotFound : ApiError("This ship isn't known to the server.") {
        private fun readResolve(): Any = NotFound
    }

    /** The server's own explanation, for requests where it has one worth showing */
    class Server(message: String) : ApiError(message)

    companion object {
        /**
         * What to tell the user about a failed request, in plain words.
         * `online`: whether the phone has a network at all, if known.
         */
        fun message(error: Throwable, online: Boolean? = null): String = when (error) {
            is ApiError -> error.message ?: "Something went wrong."
            is UnknownHostException, is ConnectException, is NoRouteToHostException ->
                if (online == false) {
                    "You're offline. Ships will show again once you're connected."
                } else {
                    "BridgeView's server isn't answering right now. It may be restarting; try again in a few minutes."
                }
            is SocketTimeoutException, is InterruptedIOException ->
                "BridgeView's server is taking too long to answer. Check your connection, or try again in a few minutes."
            is SSLException ->
                "Couldn't make a secure connection to BridgeView. If you're on public Wi-Fi, you may need to sign in to it first."
            is SerializationException, is IllegalArgumentException ->
                "BridgeView's server sent something this version of the app can't read. Check for an app update."
            is IOException ->
                if (online == false) "You're offline. Ships will show again once you're connected."
                else error.message ?: "Couldn't reach BridgeView."
            else -> error.message ?: "Something went wrong."
        }
    }
}
