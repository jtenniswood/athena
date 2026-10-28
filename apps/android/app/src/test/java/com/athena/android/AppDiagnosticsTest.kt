package com.athena.android

import android.content.ClipboardManager
import android.content.Context
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog
import androidx.appcompat.app.AlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class AppDiagnosticsTest {
    @Test fun copyingConnectionDetailsExcludesCredentialsAndChatContent() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val prefs = activity.getSharedPreferences("athena", Context.MODE_PRIVATE)
        for (key in listOf("pushToken", "pushRefreshKey", "private", "cookie", "chat"))
            prefs.edit().putString(key, "secret-$key").commit()
        val diagnostics = AppDiagnostics.capture(activity, "https://athena.example", ConnectionCoordinator(), "web-revision", "1")
        val settings = NativeAppSettings(activity)
        settings.showDetails(diagnostics)
        (ShadowDialog.getLatestDialog() as AlertDialog).getButton(AlertDialog.BUTTON_NEUTRAL).performClick()
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        val copied = activity.getSystemService(ClipboardManager::class.java).primaryClip!!.getItemAt(0).text.toString()
        assertTrue(copied.contains("web-revision"))
        assertTrue(copied.contains("Android System WebView"))
        assertFalse(copied.contains("secret-"))
        controller.pause().stop().destroy()
    }
}
