package com.athena.android

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import com.google.android.material.button.MaterialButton
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeSettingsPageTest {
    private fun model(value: String = "Original") = NativeSettingsPage.parse(JSONObject("""{
      "id":"page-1","scope":"appearance","title":"Appearance","rows":[
        {"kind":"heading","label":"Preferences"},
        {"kind":"input","id":"name","label":"Display name","value":"$value","inputType":"text"},
        {"kind":"action","id":"reset","label":"Reset settings"}
      ]}"""))
    private fun activity() = Robolectric.buildActivity(MainActivity::class.java).apply {
        org.robolectric.RuntimeEnvironment.getApplication().getSharedPreferences("athena", Context.MODE_PRIVATE).edit().remove("origin").commit()
    }.setup()
    private fun all(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { all(view.getChildAt(it)) } else emptyList()

    @Test fun nativeEditsSurviveLiveUpdatesAndUseOnlyTheCurrentCommandId() {
        val controller = activity(); val activity = controller.get(); val page = NativeSettingsPage(activity)
        val replies = mutableListOf<JSONObject>()
        try {
            page.show(model()) { replies.add(it as JSONObject) }
            val root = activity.findViewById<View>(android.R.id.content)
            val row = root.findViewWithTag<View>("name")
            all(row).filterIsInstance<MaterialButton>().single().performClick()
            val dialog = ShadowDialog.getLatestDialog() as AlertDialog
            val input = all(dialog.window!!.decorView).filterIsInstance<EditText>().single()
            input.setText("Unsaved native edit")
            page.update(model("Changed on server"))
            assertEquals("Unsaved native edit", input.text.toString())
            page.refresh()
            assertEquals("Unsaved native edit", input.text.toString())
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
            assertEquals("Unsaved native edit", replies.first { it.optString("id") == "name" }.getString("value"))
            page.dismiss()
            assertEquals("dismissed", replies.last().getString("status"))
            assertFalse(page.isShowing)
        } finally { page.dismiss(); controller.pause().stop().destroy() }
    }
    @Test fun closingAndBackAskTheWebOwnerInsteadOfResettingSettingsOrChatState() {
        val controller = activity(); val activity = controller.get(); val page = NativeSettingsPage(activity)
        val original = activity.findViewById<View>(R.id.connect_content)
        val replies = mutableListOf<JSONObject>()
        try {
            page.show(model()) { replies.add(it as JSONObject) }
            assertFalse(original.isShown)
            assertTrue(page.back())
            assertEquals("back", replies.last().getString("id"))
            assertTrue(page.isShowing)
            page.dismiss("another-page")
            assertTrue(page.isShowing)
            page.dismiss("page-1")
            assertTrue(original.isShown)
            assertFalse(page.back())
        } finally { page.dismiss(); controller.pause().stop().destroy() }
    }
    @Test fun malformedOrAmbiguousRowsAreRejected() {
        val data = JSONObject("""{"id":"page","scope":"scope","title":"Settings","rows":[{"kind":"action","id":"same","label":"One"},{"kind":"action","id":"same","label":"Two"}]}""")
        assertThrows(IllegalArgumentException::class.java) { NativeSettingsPage.parse(data) }
        data.getJSONArray("rows").remove(1)
        data.getJSONArray("rows").getJSONObject(0).put("kind","script")
        assertThrows(IllegalArgumentException::class.java) { NativeSettingsPage.parse(data) }
    }
}
