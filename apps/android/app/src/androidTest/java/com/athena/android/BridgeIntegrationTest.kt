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
        val adapter = instrumentation.context.assets.open("android-adapter.js").bufferedReader().use { it.readText() }
        prefs.edit().putString("origin", "").commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var activity: MainActivity
                lateinit var web: WebView
                scenario.onActivity {
                    activity = it
                    prefs.edit().putString("origin", "https://athena.example").commit()
                    MainActivity::class.java.getDeclaredField("origin").apply { isAccessible = true }.set(it, "https://athena.example")
                    MainActivity::class.java.getDeclaredMethod("openServer", android.os.Bundle::class.java)
                        .apply { isAccessible = true }.invoke(it, null)
                    web = field(it, "web") as WebView
                    web.stopLoading()
                    web.loadDataWithBaseURL("https://athena.example/", """
                        <!doctype html><meta name="viewport" content="width=device-width">
                        <button id="settings">App settings</button>
                        <script type="module">
                          $adapter
                          window.adapter = { androidAppSettingsMenu, androidOpenAppSettings, androidWebVisibility };
                          window.productionHello = await androidHost();
                          const nativeReceiver = AthenaAndroid.onmessage;
                          window.result = null;
                          AthenaAndroid.onmessage = function(event) {
                            if (JSON.parse(event.data).id === 'test') window.result = JSON.parse(event.data);
                            else nativeReceiver(event);
                          };
                          window.addEventListener('athena:prepare-native-navigation', function(event) {
                            event.preventDefault(); window.navigationId = event.detail.requestId;
                          });
                          window.fixtureReady = true;
                        </script>
                    """.trimIndent(), "text/html", "UTF-8", "https://athena.example/")
                }
                waitUntil { evaluate(web, "window.fixtureReady === true") == "true" }
                scenario.onActivity { assertEquals("https://athena.example/", web.url) }
                assertEquals("1", evaluate(web, "window.productionHello.protocol"))
                request(web, "webState", JSONObject().put("ready", true).put("revision", "fixture").put("serverProtocol", 1))
                evaluate(web, "window.discovered = null; window.adapter.androidAppSettingsMenu(true).then(value => window.discovered = value)")
                waitUntil { evaluate(web, "window.discovered === true") == "true" }
                scenario.onActivity { assertEquals(View.VISIBLE, (field(it, "nativeToolbar") as View).visibility) }
                evaluate(web, "window.handedOver = null; window.adapter.androidAppSettingsMenu(true, true).then(value => window.handedOver = value)")
                waitUntil { evaluate(web, "window.handedOver === true") == "true" }
                scenario.onActivity { assertEquals(View.GONE, (field(it, "nativeToolbar") as View).visibility) }

                waitUntil { var focused = false; scenario.onActivity { focused = web.hasWindowFocus() }; focused }
                request(web, "webVisibility", JSONObject().put("sessionId", "chat-1"))
                assertTrue(MainActivity.visibility.shouldSuppress(true, "chat-1"))
                assertFalse(MainActivity.visibility.shouldSuppress(true, "chat-2"))
                evaluate(web, "document.getElementById('settings').textContent = 'Draft remains on resume'")
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
                assertFalse(MainActivity.visibility.shouldSuppress(true, "chat-1"))
                scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
                assertEquals("\"Draft remains on resume\"", evaluate(web, "document.getElementById('settings').textContent"))
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
                evaluate(web, "window.unmounted = null; window.adapter.androidAppSettingsMenu(false).then(value => window.unmounted = value)")
                waitUntil { evaluate(web, "window.unmounted === true") == "true" }
                scenario.onActivity { assertEquals(View.VISIBLE, (field(it, "nativeToolbar") as View).visibility) }
                waitUntil { var focused = false; scenario.onActivity { focused = web.hasWindowFocus() }; focused }
                request(web, "webVisibility", JSONObject().put("sessionId", "chat-1").put("connected", true))
                assertTrue(MainActivity.visibility.shouldSuppress(true, "chat-1"))
                evaluate(web, "window.settingsOpened = null; window.adapter.androidOpenAppSettings().then(value => window.settingsOpened = value)")
                waitUntil { evaluate(web, "window.settingsOpened === true") == "true" }
                assertFalse(MainActivity.visibility.shouldSuppress(true, "chat-1"))
                val settingsDelegate = MainActivity::class.java.getDeclaredField("nativeSettings$" + "delegate").apply { isAccessible = true }
                scenario.onActivity {
                    val settings = (settingsDelegate.get(it) as Lazy<*>).value as NativeAppSettings
                    settings.sheet!!.findViewById<android.view.View>(com.google.android.material.R.id.design_bottom_sheet)!!
                        .findViewWithTag<android.view.View>(R.string.connection_details).performClick()
                    assertTrue(settings.detailsShowing)
                }
                instrumentation.waitForIdleSync()
                Thread.sleep(400) // Let the native dialog's enter animation settle before visual verification.
                instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
                    java.io.File(context.getExternalFilesDir(null), "connection-details.png").outputStream().use {
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
                    }
                }
            }
        } finally {
            prefs.edit().apply { if (previousOrigin == null) remove("origin") else putString("origin", previousOrigin) }.commit()
        }
    }
}
