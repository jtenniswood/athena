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
class ModelPickerIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun field(activity: MainActivity, name: String): Any? = MainActivity::class.java
        .getDeclaredField(name).apply { isAccessible = true }.get(activity)

    private fun evaluate(view: WebView, script: String): String {
        val completed = CountDownLatch(1)
        var value = ""
        instrumentation.runOnMainSync { view.evaluateJavascript(script) { value = it; completed.countDown() } }
        check(completed.await(30, TimeUnit.SECONDS)) { "WebView did not evaluate JavaScript" }
        return value
    }
    private fun waitUntil(check: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 30000
        while (!check()) {
            if (System.currentTimeMillis() >= deadline) fail("WebView condition timed out")
            Thread.sleep(100)
        }
    }
    @Test fun nativeModelSearchAndSelectionRoundTripThroughTheRealBridge() {
        val context = instrumentation.targetContext
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val previous = prefs.getString("origin", null)
        val adapter = instrumentation.context.assets.open("android-adapter.js").bufferedReader().use { it.readText() }
        prefs.edit().putString("origin", "").commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                lateinit var web: WebView
                scenario.onActivity { activity ->
                    prefs.edit().putString("origin", "https://athena.example").commit()
                    MainActivity::class.java.getDeclaredField("origin").apply { isAccessible = true }.set(activity, "https://athena.example")
                    MainActivity::class.java.getDeclaredMethod("openServer", android.os.Bundle::class.java)
                        .apply { isAccessible = true }.invoke(activity, null)
                    web = field(activity, "web") as WebView; web.stopLoading()
                    web.loadDataWithBaseURL("https://athena.example/", """
                      <!doctype html><meta name="viewport" content="width=device-width"><div>Existing chat draft</div>
                      <script type="module">
                      $adapter
                      window.host = await androidHost(); window.query = ''; window.choice = '';
                      window.openModels = () => androidOpenActionMenu({id:'models',title:'Models',compact:true,x:0,y:0,viewportWidth:390,
                        search:{id:'search',label:'Search models',value:''},
                        groups:[{label:'Provider',selection:'single',items:[{id:'model-a',label:'Model A',checked:true},{id:'model-b',label:'Model B',checked:false}]}]
                      },(id,value)=>{ if(id==='search') window.query=value }).then(result=>window.choice=result.id);
                      window.fixtureReady = true;
                      </script>
                    """.trimIndent(), "text/html", "UTF-8", "https://athena.example/")
                }
                waitUntil { evaluate(web, "window.fixtureReady === true") == "true" }
                assertEquals("true", evaluate(web, "window.host.capabilities.includes('action-menu-search')"))
                evaluate(web, "window.openModels()")
                fun sheet(activity: MainActivity): com.google.android.material.bottomsheet.BottomSheetDialog? {
                    val menus = (field(activity, "actionMenus$" + "delegate") as Lazy<*>).value as NativeActionMenus
                    return NativeActionMenus::class.java.getDeclaredField("sheet").apply { isAccessible = true }.get(menus) as? com.google.android.material.bottomsheet.BottomSheetDialog
                }
                waitUntil { var shown = false; scenario.onActivity { shown = sheet(it)?.isShowing == true }; shown }
                fun views(view: View): List<View> = listOf(view) + if (view is android.view.ViewGroup) (0 until view.childCount).flatMap { views(view.getChildAt(it)) } else emptyList()
                scenario.onActivity {
                    val dialog = sheet(it)!!
                    views(dialog.window!!.decorView).filterIsInstance<android.widget.EditText>().single().apply { requestFocus(); setText("Model B") }
                }
                waitUntil { evaluate(web, "window.query === 'Model B'") == "true" }
                instrumentation.waitForIdleSync()
                instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
                    val output = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir") ?: context.getExternalFilesDir(null)!!.absolutePath
                    java.io.File(output, "native-model-picker.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                }
                scenario.onActivity { sheet(it)!!.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)!!.findViewWithTag<View>("model-b").performClick() }
                waitUntil { evaluate(web, "window.choice === 'model-b'") == "true" }
                assertEquals("\"Existing chat draft\"", evaluate(web, "document.querySelector('div').textContent"))
            }
        } finally {
            prefs.edit().apply { if(previous == null) remove("origin") else putString("origin",previous) }.commit()
        }
    }
}
