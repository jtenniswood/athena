package com.athena.android

import android.content.Context
import android.view.View
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Exercises the real origin-restricted WebMessage bridge in Android System WebView. */
@RunWith(AndroidJUnit4::class)
class BridgeIntegrationTest {
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
    private fun request(view: WebView, method: String, payload: JSONObject = JSONObject()): JSONObject {
        val envelope = JSONObject().put("id", "test").put("protocol", 1).put("method", method).put("payload", payload)
        evaluate(view, "window.result = null; AthenaAndroid.postMessage(${JSONObject.quote(envelope.toString())});")
        waitUntil { evaluate(view, "window.result !== null") == "true" }
        return JSONObject(evaluate(view, "window.result"))
    }

    @Test fun realBridgeKeepsNativeSettingsUntilHandoverAndRejectsStaleNavigationApprovals() {
        val context = instrumentation.targetContext
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val previousOrigin = prefs.getString("origin", null)
        prefs.edit().putString("origin", "https://athena.example").commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var activity: MainActivity
                lateinit var web: WebView
                scenario.onActivity {
                    activity = it
                    web = field(it, "web") as WebView
                    web.stopLoading()
                    web.loadDataWithBaseURL("https://athena.example/", """
                        <!doctype html><meta name="viewport" content="width=device-width">
                        <button id="settings">App settings</button>
                        <script>
                          window.result = null;
                          AthenaAndroid.onmessage = function(event) { window.result = JSON.parse(event.data); };
                          window.addEventListener('athena:prepare-native-navigation', function(event) {
                            event.preventDefault(); window.navigationId = event.detail.requestId;
                          });
                          window.fixtureReady = true;
                        </script>
                    """.trimIndent(), "text/html", "UTF-8", "https://athena.example/")
                }
                waitUntil { evaluate(web, "window.fixtureReady === true") == "true" }
                scenario.onActivity { assertEquals("https://athena.example/", web.url) }
                val hello = request(web, "hello", JSONObject().put("protocol", 1))
                assertEquals(1, hello.getJSONObject("value").getInt("protocol"))
                request(web, "webState", JSONObject().put("ready", true).put("revision", "fixture").put("serverProtocol", 1))
                request(web, "appSettingsMenu", JSONObject().put("mounted", true).put("rendered", false))
                scenario.onActivity { assertEquals(View.VISIBLE, (field(it, "nativeToolbar") as View).visibility) }
                request(web, "appSettingsMenu", JSONObject().put("mounted", true).put("rendered", true))
                scenario.onActivity { assertEquals(View.GONE, (field(it, "nativeToolbar") as View).visibility) }

                var navigated = false
                scenario.onActivity {
                    val action: () -> Unit = { navigated = true }
                    MainActivity::class.java.getDeclaredMethod("prepareNavigation", Boolean::class.javaPrimitiveType, Function0::class.java)
                        .apply { isAccessible = true }.invoke(it, false, action)
                }
                waitUntil { evaluate(web, "typeof window.navigationId === 'string'") == "true" }
                request(web, "navigationReady", JSONObject().put("requestId", "older-request").put("ready", true))
                assertFalse(navigated)
                scenario.onActivity { assertNotNull(field(it, "navigationAction")) }
                val id = org.json.JSONTokener(evaluate(web, "window.navigationId")).nextValue() as String
                request(web, "navigationReady", JSONObject().put("requestId", id).put("ready", false).put("reason", "Recording in progress"))
                scenario.onActivity { assertNull(field(it, "navigationAction")) }
                assertFalse(navigated)
                request(web, "appSettingsMenu", JSONObject().put("mounted", false))
                scenario.onActivity { assertEquals(View.VISIBLE, (field(it, "nativeToolbar") as View).visibility) }
            }
        } finally {
            prefs.edit().apply { if (previousOrigin == null) remove("origin") else putString("origin", previousOrigin) }.commit()
        }
    }
}
