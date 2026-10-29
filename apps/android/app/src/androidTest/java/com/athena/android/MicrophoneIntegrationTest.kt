package com.athena.android

import android.content.Context
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Exercises microphone permission and capture in Android System WebView. */
@RunWith(AndroidJUnit4::class)
class MicrophoneIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun field(activity: MainActivity, name: String): Any? = MainActivity::class.java
        .getDeclaredField(name).apply { isAccessible = true }.get(activity)

    private fun evaluate(view: WebView, script: String): String {
        val completed = CountDownLatch(1)
        var value = ""
        instrumentation.runOnMainSync { view.evaluateJavascript(script) { value = it; completed.countDown() } }
        check(completed.await(10, TimeUnit.SECONDS)) { "WebView did not evaluate JavaScript" }
        return value
    }
    private fun waitUntil(check: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 10000
        while (!check()) {
            if (System.currentTimeMillis() >= deadline) fail("WebView condition timed out")
            Thread.sleep(100)
        }
    }
    @Test fun firstAudioCaptureRequestsAndroidPermission() {
        val context = instrumentation.targetContext
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val previous = prefs.getString("origin", null)
        instrumentation.uiAutomation.executeShellCommand("pm revoke ${context.packageName} android.permission.RECORD_AUDIO").close()
        prefs.edit().putString("origin", "").commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web: WebView
                scenario.onActivity { activity ->
                    prefs.edit().putString("origin", "https://athena.example").commit()
                    MainActivity::class.java.getDeclaredField("origin").apply { isAccessible = true }.set(activity, "https://athena.example")
                    MainActivity::class.java.getDeclaredMethod("openServer", android.os.Bundle::class.java)
                        .apply { isAccessible = true }.invoke(activity, null)
                    web = field(activity, "web") as WebView
                    web.stopLoading()
                    web.loadDataWithBaseURL("https://athena.example/", """
                        <!doctype html><meta name="viewport" content="width=device-width">
                        <button id="mic">Record</button><script>
                        window.state = 'ready';
                        document.getElementById('mic').onclick = async () => {
                          try { window.stream = await navigator.mediaDevices.getUserMedia({audio:true}); window.state = 'recording' }
                          catch(error) { window.state = error.name + ': ' + error.message }
                        };
                        </script>
                    """.trimIndent(), "text/html", "UTF-8", "https://athena.example/")
                }
                waitUntil { evaluate(web, "window.state === 'ready'") == "true" }
                evaluate(web, "document.getElementById('mic').click()")
                waitUntil {
                    instrumentation.uiAutomation.rootInActiveWindow?.findAccessibilityNodeInfosByViewId(
                        "com.android.permissioncontroller:id/permission_allow_foreground_only_button")?.isNotEmpty() == true
                }
                val allow = instrumentation.uiAutomation.rootInActiveWindow.findAccessibilityNodeInfosByViewId(
                    "com.android.permissioncontroller:id/permission_allow_foreground_only_button").first()
                assertTrue(allow.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
                waitUntil { evaluate(web, "window.state !== 'ready'") == "true" }
                assertEquals("\"recording\"", evaluate(web, "window.state"))
                evaluate(web, "window.stream.getTracks().forEach(track => track.stop())")
                assertEquals("true", evaluate(web, "window.stream.getTracks().every(track => track.readyState === 'ended')"))
            }
        } finally {
            prefs.edit().apply { if (previous == null) remove("origin") else putString("origin", previous) }.commit()
        }
    }
}
