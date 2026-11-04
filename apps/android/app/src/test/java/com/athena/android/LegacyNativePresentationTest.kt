package com.athena.android

import android.content.Context
import android.webkit.WebView
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class LegacyNativePresentationTest {
    private fun activity() = Robolectric.buildActivity(MainActivity::class.java).apply {
        org.robolectric.RuntimeEnvironment.getApplication().getSharedPreferences("athena", Context.MODE_PRIVATE)
            .edit().remove("origin").commit()
    }.setup()

    private fun page() = JSONObject("""{
      "id":"legacy-page","scope":"appearance","title":"Appearance",
      "rows":[{"id":"name","kind":"input","label":"Name","value":"Original"}]
    }""")

    @Test fun presentationRoutingKeepsTheOriginalSettingsOwnerAndLifecycle() {
        val controller = activity()
        val web = WebView(controller.get())
        var presenting = 0
        val legacy = LegacyNativePresentation(controller.get(), { web }, { true }) { presenting++ }
        val replies = mutableListOf<JSONObject>()
        try {
            assertFalse(legacy.handle("appSettings", JSONObject()) { fail("Current host commands must fall through") })
            assertTrue(legacy.handle("settingsPage", page()) { replies.add(it as JSONObject) })
            assertEquals(1, presenting)
            assertTrue(legacy.settingsShowing)
            legacy.dismissActions()
            assertTrue(legacy.settingsShowing)
            assertTrue(legacy.back())
            assertEquals("back", replies.last().getString("id"))
            legacy.handle("dismissSettingsPage", JSONObject().put("id", "another-page")) { assertEquals(true, it) }
            assertTrue(legacy.settingsShowing)
            legacy.handle("updateSettingsPage", page().put("title", "Updated appearance")) { assertEquals(true, it) }
            legacy.refresh()
            assertTrue(legacy.settingsShowing)
            legacy.dismiss()
            legacy.dismiss()
            assertFalse(legacy.settingsShowing)
            assertFalse(legacy.back())
            assertEquals(1, replies.count { it.optString("status") == "dismissed" })
        } finally { legacy.dismiss(); web.destroy(); controller.pause().stop().destroy() }
    }

    @Test fun unavailableOrBackgroundWebOwnersCannotOpenLegacySurfaces() {
        val controller = activity()
        var web: WebView? = null
        var foreground = true
        var presenting = 0
        val legacy = LegacyNativePresentation(controller.get(), { web }, { foreground }) { presenting++ }
        val menu = JSONObject("""{
          "id":"legacy-menu","title":"Actions","compact":true,"x":0,"y":0,"viewportWidth":390,
          "groups":[{"items":[{"id":"rename","label":"Rename"}]}]
        }""")
        try {
            for (available in listOf(false, true)) {
                if (available) { web = WebView(controller.get()); foreground = false }
                for ((method, payload) in listOf("settingsPage" to page(), "actionMenu" to menu)) {
                    var result: Any? = null
                    assertTrue(legacy.handle(method, payload) { result = it })
                    assertEquals("dismissed", (result as JSONObject).getString("status"))
                }
            }
            assertEquals(0, presenting)
            assertFalse(legacy.settingsShowing)
        } finally { legacy.dismiss(); web?.destroy(); controller.pause().stop().destroy() }
    }
}
