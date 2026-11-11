package com.athena.android

import android.app.Notification
import android.app.NotificationManager
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeNotificationsTest {
    private val app = RuntimeEnvironment.getApplication()

    @Test fun nativeAlertOpensOnlyItsConversationAndReplacesItsOwnTag() {
        val notifications = NativeNotifications(app)
        val payload = JSONObject().put("kind", "turnDone").put("body", "Ready")
            .put("tag", "reply-1").put("focusSessionId", "chat/id")
        assertTrue(notifications.show("https://athena.example", payload))
        val manager = app.getSystemService(NotificationManager::class.java)
        val notification = shadowOf(manager).getNotification("reply-1", 0)
        assertEquals("Athena · Response ready", notification.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("https://athena.example/#/chat%2Fid", shadowOf(notification.contentIntent).savedIntent.dataString)
        assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility)
        payload.put("chatTitle", "Weekend plans").put("focusProfile", "research & writing")
        assertTrue(notifications.show("https://athena.example", payload))
        assertEquals(1, shadowOf(manager).allNotifications.size)
        val updated = shadowOf(manager).getNotification("reply-1", 0)
        assertEquals("Weekend plans", updated.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("Ready", updated.extras.getString(Notification.EXTRA_TEXT))
        assertEquals("https://athena.example/#/chat%2Fid?profile=research%20%26%20writing", shadowOf(updated.contentIntent).savedIntent.dataString)
    }

    @Test fun mutedAlertsUseTheirOwnLowImportanceChannel() {
        val notifications = NativeNotifications(app)
        notifications.show("https://athena.example", JSONObject().put("silent", true))
        val manager = app.getSystemService(NotificationManager::class.java)
        assertEquals("silent", shadowOf(manager).allNotifications.single().channelId)
        assertEquals(NotificationManager.IMPORTANCE_LOW, manager.getNotificationChannel("silent").importance)
    }
    @Test fun duplicateDeliveryDoesNotReappearAfterDismissalAndExpiredEventsAreIgnored() {
        val notifications = NativeNotifications(app)
        val manager = app.getSystemService(NotificationManager::class.java)
        val payload = JSONObject().put("eventId", "event-one").put("tag", "event-one")
            .put("expiresAt", (System.currentTimeMillis() + 60000).toString())
        assertTrue(notifications.show("https://athena.example", payload))
        manager.cancelAll()
        assertTrue(notifications.show("https://athena.example", payload))
        assertEquals(0, shadowOf(manager).allNotifications.size)
        payload.put("eventId", "expired").put("expiresAt", "1")
        assertFalse(notifications.show("https://athena.example", payload))
        assertEquals(0, shadowOf(manager).allNotifications.size)
    }

    @Test fun updateAlertOpensAppUpdatesAndDoesNotReappearForTheSameBuild() {
        val notifications = NativeNotifications(app)
        val manager = app.getSystemService(NotificationManager::class.java)
        notifications.showUpdate("0.3.0", 1002, "main")
        assertTrue(shadowOf(manager).allNotifications.isEmpty())
        notifications.showUpdate("0.3.0", 1002, "stable")
        val notification = shadowOf(manager).allNotifications.single()
        assertEquals("app-updates", notification.channelId)
        assertEquals("Version 0.3.0 is ready to install.", notification.extras.getString(Notification.EXTRA_TEXT))
        assertEquals(NativeNotifications.OPEN_APP_UPDATE, shadowOf(notification.contentIntent).savedIntent.action)
        manager.cancelAll()
        notifications.showUpdate("0.3.0", 1002, "stable")
        assertTrue(shadowOf(manager).allNotifications.isEmpty())
        notifications.showUpdate("0.3.1", 1003, "stable")
        assertEquals(1, shadowOf(manager).allNotifications.size)
    }

}
