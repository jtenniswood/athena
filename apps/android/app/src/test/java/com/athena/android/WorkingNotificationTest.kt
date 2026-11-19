package com.athena.android

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import com.google.firebase.messaging.RemoteMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowNotificationManager

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], shadows = [PromotedNotificationManager::class])
class WorkingNotificationTest {
    private val app = RuntimeEnvironment.getApplication()
    private val manager = app.getSystemService(NotificationManager::class.java)
    private val origin = "https://athena.example"
    private val expires = System.currentTimeMillis() + 60_000
    private val service = Robolectric.buildService(PushService::class.java).create().get()

    @Before fun register() {
        app.getSharedPreferences("athena", Context.MODE_PRIVATE).edit()
            .putString("origin", origin).putString("pushBinding", "account-A").putBoolean("pushEnabled", true).commit()
        WorkingNotification.setBackground(app, false)
    }

    @Test fun showsOnlyInTheBackgroundAndOpensTheProfileConversation() {
        receive("workingStart")
        assertTrue(manager.activeNotifications.isEmpty())

        WorkingNotification.setBackground(app, true)
        val notification = manager.activeNotifications.single().notification
        assertEquals("Hermes is working", notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
        assertTrue(notification.extras.getBoolean("android.requestPromotedOngoing"))
        val intent = shadowOf(notification.contentIntent).savedIntent
        assertEquals("com.athena.android.OPEN_CONVERSATION", intent.action)
        assertEquals("$origin/#/chat%2Fid?profile=research%20%26%20writing", intent.dataString)

        WorkingNotification.setBackground(app, false)
        assertTrue(manager.activeNotifications.isEmpty())
        WorkingNotification.setBackground(app, true)
        assertEquals(1, manager.activeNotifications.size)

        receive("workingEnd")
        assertTrue(manager.activeNotifications.isEmpty())
        receive("workingStart")
        assertTrue(manager.activeNotifications.isEmpty())
    }

    @Test fun anOutOfOrderEndSuppressesTheStartAndOtherAccountsCannotClearARun() {
        WorkingNotification.setBackground(app, true)
        receive("workingEnd", 'a')
        receive("workingStart", 'a')
        assertTrue(manager.activeNotifications.isEmpty())

        receive("workingStart", 'b')
        receive("workingEnd", 'b', "another-account")
        assertEquals(1, manager.activeNotifications.size)
        receive("workingEnd", 'b')
        assertTrue(manager.activeNotifications.isEmpty())
    }

    private fun receive(kind: String, id: Char = 'a', binding: String = "account-A") {
        service.onMessageReceived(RemoteMessage.Builder("test").setData(mapOf(
            "origin" to origin, "bindingId" to binding, "kind" to kind, "runId" to id.toString().repeat(64),
            "expiresAt" to expires.toString(), "focusSessionId" to "chat/id", "focusProfile" to "research & writing"
        )).build())
    }
}

@Implements(NotificationManager::class)
class PromotedNotificationManager : ShadowNotificationManager() {
    @Implementation(minSdk = 36)
    protected fun canPostPromotedNotifications() = true
}
