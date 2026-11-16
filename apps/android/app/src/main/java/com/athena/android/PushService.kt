package com.athena.android

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/** FCM runs independently of the WebView, including after Android reclaims the app process. */
class PushService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val prefs = getSharedPreferences("athena", MODE_PRIVATE)
        val origin = prefs.getString("origin", "") ?: return
        val data = message.data
        val binding = data["bindingId"] ?: return
        fun eligible() = !MainActivity.visibility.shouldSuppress(MainActivity.foreground, data["focusSessionId"]) &&
            origin.isNotEmpty() && data["origin"] == origin && prefs.getString("origin", "") == origin &&
            prefs.getBoolean("pushEnabled", false) && binding == prefs.getString("pushBinding", "")
        if (!eligible()) return
        val payload = JSONObject(data as Map<*, *>)
        if (data["fetchPreview"] == "true") {
            NativePushRegistration(this).preview(origin, binding, data["eventId"].orEmpty())?.let { preview ->
                (preview.opt("chatTitle") as? String)?.let { payload.put("chatTitle", it) }
                (preview.opt("body") as? String)?.let { payload.put("body", it) }
            }
        }
        if (eligible()) NativeNotifications(this).show(origin, payload)
    }
    override fun onNewToken(token: String) {
        NativePushRegistration(this).recordToken(token)
        android.os.Handler(android.os.Looper.getMainLooper()).post { NativePushRegistration(this).schedule() }
    }
}
