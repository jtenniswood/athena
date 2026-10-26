package com.athena.android

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/** FCM runs independently of the WebView, including after Android reclaims the app process. */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val prefs = getSharedPreferences("athena", MODE_PRIVATE)
        val origin = prefs.getString("origin", "") ?: return
        if (MainActivity.foreground || origin.isEmpty() || message.data["origin"] != origin || !prefs.getBoolean("pushEnabled", false) ||
            message.data["bindingId"] != prefs.getString("pushBinding", "")) return
        NativeNotifications(this).show(origin, JSONObject(message.data as Map<*, *>))
    }
    override fun onNewToken(token: String) {
        // Registration with the authenticated Athena server is refreshed on the next app resume.
        getSharedPreferences("athena", MODE_PRIVATE).edit().putString("pushToken", token).apply()
    }
}
