package com.athena.android

import android.view.View
import com.google.android.material.appbar.MaterialToolbar
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeAppSettingsTest {
    private val snapshot = AppDiagnostics(listOf(AppDiagnostics.Section("Connection", listOf("State" to "Ready"))))
    private val actions = NativeAppSettings.Actions({}, {}, {}, {})

    @Test fun detailsAndSettingsBackPreserveTheOriginalHostView() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val host = activity.findViewById<View>(R.id.connect_content)
        val settings = NativeAppSettings(activity)
        settings.show({ snapshot }, actions)
        val content = activity.findViewById<View>(android.R.id.content)
        val root = content.findViewWithTag<View>(R.string.app_settings)
        assertEquals(activity.getString(R.string.app_settings), root.findViewById<MaterialToolbar>(R.id.settings_toolbar).title)
        content.findViewWithTag<View>(R.string.connection_details).performClick()
        assertTrue(settings.detailsShowing)
        assertEquals(View.GONE, root.visibility)
        assertNull(ShadowDialog.getLatestDialog())
        assertTrue(settings.navigateBack())
        assertFalse(settings.detailsShowing)
        assertSame(root, content.findViewWithTag<View>(R.string.app_settings))
        assertEquals(View.VISIBLE, root.visibility)
        assertTrue(settings.navigateBack())
        assertFalse(settings.isShowing)
        assertSame(host, activity.findViewById(R.id.connect_content))
        assertTrue(host.isShown)
        assertFalse(settings.navigateBack())
        controller.pause().stop().destroy()
    }

    @Test fun testNotificationUsesTheNormalChannelAndKeepsSettingsOpen() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        MainActivity::class.java.getDeclaredMethod("appSettings").apply { isAccessible = true }.invoke(activity)
        val content = activity.findViewById<View>(android.R.id.content)
        val action = content.findViewWithTag<View>(R.string.test_notification)
        action.performClick()
        val manager = activity.getSystemService(android.app.NotificationManager::class.java)
        val notifications = org.robolectric.Shadows.shadowOf(manager)
        val notification = notifications.getNotification("athena-test-notification", 0)
        assertEquals("responses", notification.channelId)
        assertEquals(activity.getString(R.string.test_notification_title), notification.extras.getString(android.app.Notification.EXTRA_TITLE))
        assertEquals(activity.getString(R.string.test_notification_body), notification.extras.getString(android.app.Notification.EXTRA_TEXT))
        action.performClick()
        assertEquals(1, notifications.allNotifications.size)
        assertNotNull(content.findViewWithTag<View>(R.string.app_settings))
        controller.pause().stop().destroy()
    }

    @Test fun blockedTestNotificationOffersAndroidSettingsWithoutPostingAnAlert() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val manager = activity.getSystemService(android.app.NotificationManager::class.java)
        org.robolectric.Shadows.shadowOf(manager).setNotificationsEnabled(false)
        MainActivity::class.java.getDeclaredMethod("appSettings").apply { isAccessible = true }.invoke(activity)
        activity.findViewById<View>(android.R.id.content).findViewWithTag<View>(R.string.test_notification).performClick()
        assertTrue(org.robolectric.Shadows.shadowOf(manager).allNotifications.isEmpty())
        val dialog = ShadowDialog.getLatestDialog() as androidx.appcompat.app.AlertDialog
        dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).performClick()
        val intent = org.robolectric.Shadows.shadowOf(activity).nextStartedActivity
        assertEquals(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS, intent.action)
        assertEquals(activity.packageName, intent.getStringExtra(android.provider.Settings.EXTRA_APP_PACKAGE))
        controller.pause().stop().destroy()
    }

    @Test fun themeRefreshRetainsTheDetailsBackStack() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val settings = NativeAppSettings(activity)
        settings.show({ snapshot }, actions)
        settings.showDetails(snapshot)
        settings.refresh()
        assertTrue(settings.detailsShowing)
        assertTrue(settings.navigateBack())
        assertTrue(settings.isShowing)
        assertFalse(settings.detailsShowing)
        assertNotNull(activity.findViewById<View>(android.R.id.content).findViewWithTag<View>(R.string.app_settings))
        settings.dismiss()
        controller.pause().stop().destroy()
    }

    @Test fun systemBackClosesSettingsBeforeLeavingTheChatHost() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        MainActivity::class.java.getDeclaredMethod("appSettings").apply { isAccessible = true }.invoke(activity)
        activity.findViewById<View>(android.R.id.content).findViewWithTag<View>(R.string.connection_details).performClick()
        activity.onBackPressedDispatcher.onBackPressed()
        assertNull(activity.findViewById<View>(R.id.copy_details))
        assertNotNull(activity.findViewById<View>(R.id.settings_rows))
        activity.onBackPressedDispatcher.onBackPressed()
        assertNull(activity.findViewById<View>(R.id.settings_rows))
        assertNotNull(activity.findViewById<View>(R.id.connect_content))
        controller.pause().stop().destroy()
    }
}
