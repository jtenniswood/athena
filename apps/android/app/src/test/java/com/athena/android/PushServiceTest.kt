package com.athena.android

import android.app.NotificationManager
import android.content.Context
import com.google.firebase.messaging.RemoteMessage
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class PushServiceTest {
    @Test fun backgroundPushChecksServerAccountBindingAndSignOutState() {
        val app = RuntimeEnvironment.getApplication()
        val prefs = app.getSharedPreferences("athena", Context.MODE_PRIVATE)
        prefs.edit().putString("origin", "https://athena.example").putString("pushBinding", "account-A")
            .putBoolean("pushEnabled", true).commit()
        val service = Robolectric.buildService(PushService::class.java).create().get()
        val manager = app.getSystemService(NotificationManager::class.java)
        fun message(origin: String, binding: String) = RemoteMessage.Builder("test")
            .setData(mapOf("origin" to origin, "bindingId" to binding, "kind" to "turnDone", "focusSessionId" to "chat-1"))
            .build()
        MainActivity.foreground = false
        MainActivity.visibility.clear()
        service.onMessageReceived(message("https://attacker.example", "account-A"))
        service.onMessageReceived(message("https://athena.example", "previous-account"))
        assertEquals(0, shadowOf(manager).allNotifications.size)
        service.onMessageReceived(message("https://athena.example", "account-A"))
        assertEquals(1, shadowOf(manager).allNotifications.size)
        manager.cancelAll()
        MainActivity.foreground = true
        service.onMessageReceived(message("https://athena.example", "account-A"))
        assertEquals("A foreground Activity without a ready chat still receives alerts", 1, shadowOf(manager).allNotifications.size)
        manager.cancelAll()
        MainActivity.visibility.acknowledge("chat-1")
        service.onMessageReceived(message("https://athena.example", "account-A"))
        assertEquals(0, shadowOf(manager).allNotifications.size)
        MainActivity.foreground = false
        MainActivity.visibility.clear()
        prefs.edit().putBoolean("pushEnabled", false).commit()
        service.onMessageReceived(message("https://athena.example", "account-A"))
        assertEquals(0, shadowOf(manager).allNotifications.size)
    }
}
