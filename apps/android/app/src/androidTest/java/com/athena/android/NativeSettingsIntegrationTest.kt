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
class NativeSettingsIntegrationTest {
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
    @Test fun nativeControlsUseTheRealWebViewOwnersAndFileChooser() {
        val context = instrumentation.targetContext
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val previous = prefs.getString("origin", null)
        val adapter = instrumentation.context.assets.open("android-adapter.js").bufferedReader().use { it.readText() }
        val settings = instrumentation.context.assets.open("native-settings.js").bufferedReader().use { it.readText() }
            .replace(Regex("import .* from './android-adapter.js'"), "")
        prefs.edit().putString("origin", "").commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web: WebView
                lateinit var presenter: NativeSettingsPage
                scenario.onActivity { activity ->
                    prefs.edit().putString("origin", "https://athena.example").commit()
                    MainActivity::class.java.getDeclaredField("origin").apply { isAccessible = true }.set(activity, "https://athena.example")
                    MainActivity::class.java.getDeclaredMethod("openServer", android.os.Bundle::class.java)
                        .apply { isAccessible = true }.invoke(activity, null)
                    web = field(activity, "web") as WebView
                    presenter = (field(activity, "settingsPage$" + "delegate") as Lazy<*>).value as NativeSettingsPage
                    web.stopLoading()
                    web.loadDataWithBaseURL("https://athena.example/", """
                        <!doctype html><meta name="viewport" content="width=device-width">
                        <div id="draft">Existing chat draft</div>
                        <div class="browser-settings-fullscreen-card"><button aria-label="Close settings" id="close">Close</button>
                        <div data-browser-settings-frame><header class="browser-settings-header"><h1>Settings</h1></header>
                        <label>Display name<input id="name" value="Original"></label>
                        <label>Notifications<input id="notifications" type="checkbox"></label>
                        <button id="import">Import configuration</button><input id="file" type="file" hidden>
                        <div role="status" id="status"></div></div></div>
                        <script type="module">
                          $adapter
                          $settings
                          document.getElementById('name').onblur = event => window.saved = event.target.value;
                          document.getElementById('notifications').onchange = event => window.toggled = event.target.checked;
                          document.getElementById('import').onclick = () => document.getElementById('file').click();
                          document.getElementById('close').onclick = () => document.querySelector('[data-browser-settings-frame]').remove();
                          window.stopSettings = installNativeSettings(); window.fixtureReady = true;
                        </script>
                    """.trimIndent(), "text/html", "UTF-8", "https://athena.example/")
                }
                waitUntil { evaluate(web, "window.fixtureReady === true") == "true" }
                waitUntil { var shown = false; scenario.onActivity { shown = presenter.isShowing }; shown }
                fun views(view: View): List<View> = listOf(view) + if (view is android.view.ViewGroup)
                    (0 until view.childCount).flatMap { views(view.getChildAt(it)) } else emptyList()
                fun click(label: String) = scenario.onActivity { activity ->
                    views(activity.findViewById(android.R.id.content)).filterIsInstance<android.widget.TextView>()
                        .first { it.text.toString() == label && it.isClickable }.performClick()
                }
                click("Original")
                scenario.onActivity {
                    val dialog = NativeSettingsPage::class.java.getDeclaredField("editor").apply { isAccessible = true }.get(presenter) as androidx.appcompat.app.AlertDialog
                    views(dialog.window!!.decorView).filterIsInstance<android.widget.EditText>().single().setText("Saved natively")
                    dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).performClick()
                }
                waitUntil { evaluate(web, "window.saved === 'Saved natively'") == "true" }
                click("Notifications")
                waitUntil { evaluate(web, "window.toggled === true") == "true" }
                instrumentation.waitForIdleSync()
                instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
                    java.io.File(InstrumentationRegistry.getArguments().getString("additionalTestOutputDir") ?: context.getExternalFilesDir(null)!!.absolutePath, "native-settings-page.png").outputStream().use {
                        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
                    }
                }
                click("Import configuration")
                waitUntil { var opened = false; scenario.onActivity { opened = field(it, "settingsFilesReply") != null }; opened }
                waitUntil { instrumentation.uiAutomation.rootInActiveWindow?.packageName?.toString()?.contains("documentsui") == true }
                instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
                waitUntil { var pending = true; scenario.onActivity { pending = field(it, "settingsFilesReply") != null }; !pending }
                scenario.onActivity { presenter.back() }
                waitUntil { var shown = true; scenario.onActivity { shown = presenter.isShowing }; !shown }
                assertEquals("\"Existing chat draft\"", evaluate(web, "document.getElementById('draft').textContent"))
            }
        } finally {
            prefs.edit().apply { if (previous == null) remove("origin") else putString("origin", previous) }.commit()
        }
    }
}
