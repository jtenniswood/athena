package com.athena.android

import android.content.Context
import android.webkit.ValueCallback
import android.webkit.WebView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ConnectionTestingTest {
    private class GuardedPage(context: Context) : WebView(context) {
        var destroyed = false
        override fun getUrl() = "https://saved.example/"
        override fun evaluateJavascript(script: String, callback: ValueCallback<String>?) { callback?.onReceiveValue("false") }
        override fun destroy() { destroyed = true; super.destroy() }
    }
    private fun field(name: String) = MainActivity::class.java.getDeclaredField(name).apply { isAccessible = true }
    private fun start(activity: MainActivity, test: ConnectionTest) = MainActivity::class.java
        .getDeclaredMethod("startConnectionTest", ConnectionTest::class.java).apply { isAccessible = true }.invoke(activity, test)

    @Test fun enteringTestingWaitsForTheExistingDraftAndRecordingGuard() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("athena", Context.MODE_PRIVATE)
        prefs.edit().putString("origin", "https://saved.example").commit()
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val page = GuardedPage(activity)
        field("web").set(activity, page)
        field("documentReady").setBoolean(activity, true)
        try {
            start(activity, ConnectionTest.HTTP_ERROR)
            assertNull(field("connectionTest").get(activity))
            assertFalse(page.destroyed)
            assertNotNull(field("navigationAction").get(activity))
            assertEquals("https://saved.example", prefs.getString("origin", null))
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun endingATestReconnectsToTheSavedServerAndDoesNotPersistTestNavigation() {
        val prefs = RuntimeEnvironment.getApplication().getSharedPreferences("athena", Context.MODE_PRIVATE)
        prefs.edit().putString("origin", "https://saved.example").commit()
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        field("web").set(activity, null)
        try {
            start(activity, ConnectionTest.HTTP_ERROR)
            val state = android.os.Bundle()
            controller.saveInstanceState(state)
            assertNull(state.getBundle("webview"))
            activity.findViewById<android.view.View>(R.id.end_connection_test).performClick()
            assertNull(field("connectionTest").get(activity))
            assertEquals("https://saved.example", field("origin").get(activity))
            assertNull(activity.findViewById<android.view.View>(R.id.end_connection_test))
            // A recreated activity must restore the configured server, never the test document.
            field("web").set(activity, null)
            start(activity, ConnectionTest.HTTP_ERROR)
            controller.recreate()
            assertNull(field("connectionTest").get(controller.get()))
            assertEquals("https://saved.example", field("origin").get(controller.get()))
            assertEquals("https://saved.example", prefs.getString("origin", null))
        } finally { controller.pause().stop().destroy() }
    }
}
