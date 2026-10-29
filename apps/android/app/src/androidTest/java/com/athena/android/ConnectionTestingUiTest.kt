package com.athena.android

import android.content.Context
import android.view.View
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Uses real WebView network, HTTP and bridge callbacks, including retry. */
@RunWith(AndroidJUnit4::class)
class ConnectionTestingUiTest {
    @Test fun failureScenariosRetryAndExitWithoutChangingTheSavedServer() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val oldOrigin = prefs.getString("origin", null)
        prefs.edit().remove("origin").commit()
        fun field(activity: MainActivity, name: String): Any? = MainActivity::class.java.getDeclaredField(name)
            .apply { isAccessible = true }.get(activity)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                val expected = mapOf(ConnectionTest.UNAVAILABLE to "web-unreachable", ConnectionTest.HTTP_ERROR to "web-unreachable",
                    ConnectionTest.WRONG_SERVER to "web-timeout", ConnectionTest.UNSUPPORTED_PROTOCOL to "web-protocol")
                fun recovery(previous: ConnectionCoordinator.State? = null): ConnectionCoordinator.State {
                    val deadline = System.currentTimeMillis() + 30000
                    while (System.currentTimeMillis() < deadline) {
                        var state: ConnectionCoordinator.State? = null
                        scenario.onActivity { state = (field(it, "connection") as ConnectionCoordinator).state }
                        if (state!!.stage == ConnectionCoordinator.Stage.RECOVERY && state !== previous) return state!!
                        Thread.sleep(100)
                    }
                    error("Connection test did not reach recovery")
                }
                for ((test, code) in expected) {
                    scenario.onActivity { activity ->
                        activity.findViewById<View>(R.id.connection_testing).performClick()
                        val dialog = field(activity, "connectionTestDialog") as androidx.appcompat.app.AlertDialog
                        dialog.listView.performItemClick(null, test.ordinal, test.ordinal.toLong())
                    }
                    val failed = recovery()
                    assertEquals(test.title, code, failed.code)
                    if (test == ConnectionTest.HTTP_ERROR) {
                        assertTrue(failed.message.contains("503"))
                        instrumentation.waitForIdleSync()
                        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
                            java.io.File(context.getExternalFilesDir(null), "connection-test-http-503.png").outputStream().use {
                                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
                            }
                        }
                    }
                    scenario.onActivity { activity ->
                        assertTrue(activity.findViewById<View>(R.id.end_connection_test).isShown)
                        assertTrue(activity.findViewById<View>(R.id.reconnect).isShown)
                        assertEquals(View.GONE, activity.findViewById<View>(R.id.connection_progress).visibility)
                        activity.findViewById<View>(R.id.reconnect).performClick()
                    }
                    assertEquals(code, recovery(failed).code)
                    assertFalse(prefs.contains("origin"))
                    scenario.onActivity { activity ->
                        activity.findViewById<View>(R.id.end_connection_test).performClick()
                        assertNull(field(activity, "connectionTest"))
                        assertNotNull(activity.findViewById<View>(R.id.server_address))
                    }
                }
            }
        } finally { prefs.edit().apply { if (oldOrigin == null) remove("origin") else putString("origin", oldOrigin) }.commit() }
    }
}
