package com.athena.android

import android.os.Looper
import android.view.View
import androidx.appcompat.widget.PopupMenu
import com.google.android.material.bottomsheet.BottomSheetDialog
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeActionMenusTest {
    private fun payload(id: String = "first", compact: Boolean = true) = JSONObject("""{
        "id":"$id","title":"Chat actions","compact":$compact,"x":30,"y":50,"viewportWidth":390,
        "groups":[{"items":[{"id":"rename","label":"Rename"},{"id":"delete","label":"Delete","disabled":true},
        {"id":"choice","label":"Choose","children":[{"selection":"single","items":[
        {"id":"one","label":"One","checked":true},{"id":"two","label":"Two","checked":false}]}]}]}]}""")

    @Test fun nestedSelectionOnlyReturnsItsOpaqueIdAfterDismissal() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val menus = NativeActionMenus(activity)
        val replies = mutableListOf<JSONObject>()
        menus.show(NativeActionMenus.parse(payload()), View(activity)) { replies.add(it as JSONObject) }
        val dialog = ShadowDialog.getLatestDialog() as BottomSheetDialog
        val root = dialog.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)!!
        assertFalse(root.findViewWithTag<View>("delete").isEnabled)
        root.findViewWithTag<View>("choice").performClick()
        dialog.onBackPressedDispatcher.onBackPressed()
        assertNotNull(root.findViewWithTag<View>("rename"))
        root.findViewWithTag<View>("choice").performClick()
        root.findViewWithTag<View>("two").performClick()
        assertFalse(dialog.isShowing)
        assertEquals(1, replies.size)
        assertEquals("two", replies.single().getString("id"))
        assertEquals("selected", replies.single().getString("status"))
        menus.dismiss()
        assertEquals(1, replies.size)
        controller.pause().stop().destroy()
    }

    @Test fun replacementAndStaleCleanupCannotDismissAnotherOwnersMenu() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val menus = NativeActionMenus(activity)
        val first = mutableListOf<JSONObject>(); val second = mutableListOf<JSONObject>()
        menus.show(NativeActionMenus.parse(payload()), View(activity)) { first.add(it as JSONObject) }
        menus.show(NativeActionMenus.parse(payload("second")), View(activity)) { second.add(it as JSONObject) }
        assertEquals("dismissed", first.single().getString("status"))
        menus.dismiss("first")
        assertTrue(second.isEmpty())
        (ShadowDialog.getLatestDialog() as BottomSheetDialog).cancel()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("dismissed", second.single().getString("status"))
        controller.pause().stop().destroy()
    }

    @Test fun popupSelectionUsesTheSameCommandContract() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val menus = NativeActionMenus(activity)
        val replies = mutableListOf<JSONObject>()
        menus.show(NativeActionMenus.parse(payload(compact = false)), shadowOf(activity).contentView) { replies.add(it as JSONObject) }
        shadowOf(Looper.getMainLooper()).idle()
        val field = NativeActionMenus::class.java.getDeclaredField("popup").apply { isAccessible = true }
        val popup = field.get(menus) as PopupMenu
        val rename = popup.menu.findItem(2)
        popup.menu.performIdentifierAction(rename.itemId, 0)
        assertEquals("rename", replies.single().getString("id"))
        controller.pause().stop().destroy()
    }

    @Test fun malformedDuplicateAndUnboundedCommandsAreRejected() {
        val duplicate = payload().apply {
            getJSONArray("groups").getJSONObject(0).getJSONArray("items").getJSONObject(1).put("id", "rename")
        }
        val tooLong = payload().put("title", "x".repeat(241))
        val invalidPosition = payload().put("viewportWidth", 0)
        val invalidColor = payload().apply {
            getJSONArray("groups").getJSONObject(0).getJSONArray("items").getJSONObject(0).put("color", "invalid")
        }
        for (invalid in listOf(duplicate, tooLong, invalidPosition, invalidColor)) {
            assertThrows(IllegalArgumentException::class.java) { NativeActionMenus.parse(invalid) }
        }
    }

    @Test fun persistentSelectionUpdatesTheSameSheetAndRowsInsideItsSubmenu() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val menus = NativeActionMenus(activity)
        val model = payload()
        val choices = model.getJSONArray("groups").getJSONObject(0).getJSONArray("items")
            .getJSONObject(2).getJSONArray("children").getJSONObject(0).getJSONArray("items")
        choices.getJSONObject(1).put("keepOpen", true).put("color", "#4b4bdd")
        val replies = mutableListOf<JSONObject>()
        menus.show(NativeActionMenus.parse(model), View(activity)) { replies.add(it as JSONObject) }
        val dialog = ShadowDialog.getLatestDialog() as BottomSheetDialog
        val root = dialog.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)!!
        root.findViewWithTag<View>("choice").performClick()
        val row = root.findViewWithTag<View>("two")
        assertEquals(View.VISIBLE, row.findViewById<View>(R.id.menu_color).visibility)
        row.performClick()
        assertTrue(dialog.isShowing)
        assertEquals("changed", replies.single().getString("status"))
        choices.getJSONObject(0).put("checked", false)
        choices.getJSONObject(1).put("checked", true).put("disabled", true).put("color", "")
        assertTrue(menus.update(NativeActionMenus.parse(model)))
        assertSame(dialog, ShadowDialog.getLatestDialog())
        assertSame(row, root.findViewWithTag<View>("two"))
        assertFalse(row.isEnabled)
        assertTrue(row.createAccessibilityNodeInfo().isChecked)
        assertEquals(View.GONE, row.findViewById<View>(R.id.menu_color).visibility)
        assertNull(root.findViewWithTag<View>("choice"))
        assertFalse(menus.update(NativeActionMenus.parse(payload("stale"))))
        dialog.onBackPressedDispatcher.onBackPressed()
        assertNotNull(root.findViewWithTag<View>("choice"))
        menus.dismiss()
        assertEquals(listOf("changed", "dismissed"), replies.map { it.getString("status") })
        controller.pause().stop().destroy()
    }

    @Test fun rendererSubmenuBackReturnsAnEventWithoutDismissingTheSheet() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val menus = NativeActionMenus(activity)
        val replies = mutableListOf<JSONObject>()
        menus.show(NativeActionMenus.parse(payload().put("backId", "back")), View(activity)) { replies.add(it as JSONObject) }
        val dialog = ShadowDialog.getLatestDialog() as BottomSheetDialog
        dialog.onBackPressedDispatcher.onBackPressed()
        assertTrue(dialog.isShowing)
        assertEquals("changed", replies.single().getString("status"))
        assertEquals("back", replies.single().getString("id"))
        menus.dismiss()
        controller.pause().stop().destroy()
    }
    @Test fun nativeSearchKeepsTheEditorsQueryDuringLiveRowUpdates() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get(); val menus = NativeActionMenus(activity)
        val data = payload().put("search", JSONObject().put("id", "query").put("label", "Search models").put("value", ""))
        val replies = mutableListOf<JSONObject>()
        menus.show(NativeActionMenus.parse(data), View(activity)) { replies.add(it as JSONObject) }
        val dialog = ShadowDialog.getLatestDialog() as BottomSheetDialog
        fun all(view: View): List<View> = listOf(view) + if(view is android.view.ViewGroup) (0 until view.childCount).flatMap { all(view.getChildAt(it)) } else emptyList()
        val input = all(dialog.window!!.decorView).filterIsInstance<android.widget.EditText>().single()
        input.requestFocus(); input.setText("Model 39")
        assertEquals("query", replies.last().getString("id"))
        assertEquals("Model 39", replies.last().getString("value"))
        assertTrue(menus.update(NativeActionMenus.parse(data)))
        assertEquals("Model 39", input.text.toString())
        assertTrue(dialog.isShowing)
        menus.dismiss(); controller.pause().stop().destroy()
    }

    @Test fun modelRowsSelectDirectlyAndExposeTheirOptionsSeparately() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get(); val menus = NativeActionMenus(activity)
        val data = payload()
        val row = data.getJSONArray("groups").getJSONObject(0).getJSONArray("items").getJSONObject(2)
        row.put("selectable", true).put("keepOpen", true)
        val replies = mutableListOf<JSONObject>()
        menus.show(NativeActionMenus.parse(data), View(activity)) { replies.add(it as JSONObject) }
        val dialog = ShadowDialog.getLatestDialog() as BottomSheetDialog
        val root = dialog.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)!!
        root.findViewWithTag<View>("choice").performClick()
        assertEquals("choice", replies.single().getString("id"))
        assertNotNull(root.findViewWithTag<View>("rename"))
        root.findViewWithTag<View>("choice").findViewById<View>(R.id.menu_submenu).performClick()
        assertNotNull(root.findViewWithTag<View>("one"))
        menus.dismiss(); controller.pause().stop().destroy()
    }
}
