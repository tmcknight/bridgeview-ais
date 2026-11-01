package app.bridgeview.push

import app.bridgeview.graph
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Bridge alerts and live countdowns from the server, and new FCM tokens */
class MessagingService : FirebaseMessagingService() {
    override fun onRegistered(token: String) {
        applicationContext.graph.push.didRegister(token)
    }

    // Older Play services still call this when the token changes
    @Deprecated("Firebase Messaging 26 calls onRegistered")
    override fun onNewToken(token: String) {
        applicationContext.graph.push.didRegister(token)
    }

    override fun onUnregistered(token: String) {
        applicationContext.graph.push.didUnregister()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        ShipNotifications.handle(applicationContext, message.data)
    }
}
