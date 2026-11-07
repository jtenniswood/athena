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
    private fun field(activity: MainActivity, name: String): Any? = MainActivity::class.java.getDeclaredField(name)
        .apply { isAccessible = true }.get(activity)

    @Test fun failureScenariosRetryAndExitWithoutChangingTheSavedServer() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val oldOrigin = prefs.getString("origin", null)
        prefs.edit().remove("origin").commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                val expected = mapOf(ConnectionTest.UNAVAILABLE to "web-unreachable", ConnectionTest.HTTP_ERROR to "web-unreachable",
                    ConnectionTest.UNSUPPORTED_PROTOCOL to "web-protocol")
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

    @Test fun slowStartupKeepsTheSpinnerUntilTheWebAppConnects() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val prefs = instrumentation.targetContext.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val oldOrigin = prefs.getString("origin", null)
        prefs.edit().remove("origin").commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { activity ->
                    activity.findViewById<View>(R.id.connection_testing).performClick()
                    val dialog = field(activity, "connectionTestDialog") as androidx.appcompat.app.AlertDialog
                    val test = ConnectionTest.WRONG_SERVER
                    dialog.listView.performItemClick(null, test.ordinal, test.ordinal.toLong())
                }
                fun awaitState(predicate: (ConnectionCoordinator.State) -> Boolean) {
                    val deadline = System.currentTimeMillis() + 30000
                    while (System.currentTimeMillis() < deadline) {
                        var matches = false
                        scenario.onActivity { matches = predicate((field(it, "connection") as ConnectionCoordinator).state) }
                        if (matches) return
                        Thread.sleep(100)
                    }
                    fail("Connection did not reach the expected state")
                }
                awaitState { it.slowConnection }
                scenario.onActivity { activity ->
                    val state = (field(activity, "connection") as ConnectionCoordinator).state
                    assertEquals(ConnectionCoordinator.Stage.LOADING, state.stage)
                    assertEquals("Still connecting to Athena…", state.message)
                    assertTrue(activity.findViewById<View>(R.id.connection_progress).isShown)
                    assertEquals(View.GONE, activity.findViewById<View>(R.id.reconnect).visibility)
                    assertTrue(activity.findViewById<View>(R.id.review_settings).isShown)
                    // Complete startup through the real origin-restricted bridge after the loading deadline.
                    (field(activity, "web") as android.webkit.WebView).evaluateJavascript("""
                        window.AthenaAndroid.postMessage(JSON.stringify({id:'slow-hello',method:'hello',payload:{protocol:1}}));
                        window.AthenaAndroid.postMessage(JSON.stringify({id:'slow-ready',method:'webState',payload:{ready:true}}));
                    """.trimIndent(), null)
                }
                awaitState { it.stage == ConnectionCoordinator.Stage.READY }
                scenario.onActivity { activity ->
                    assertEquals(View.GONE, (field(activity, "connectionScreen") as View).visibility)
                    activity.findViewById<View>(R.id.end_connection_test).performClick()
                }
                assertFalse(prefs.contains("origin"))
            }
        } finally { prefs.edit().apply { if (oldOrigin == null) remove("origin") else putString("origin", oldOrigin) }.commit() }
    }
}
