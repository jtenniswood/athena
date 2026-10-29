package com.athena.android

import androidx.appcompat.app.AlertDialog
import android.content.Context
import android.webkit.ValueCallback
import android.webkit.WebView
import android.widget.EditText
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ServerSettingsTest {
    private class Page(context: Context, private val guarded: Boolean, private val pageUrl: String?) : WebView(context) {
        var destroyed = false
        var loadedUrl: String? = null
        override fun getUrl(): String? = pageUrl
        override fun loadUrl(url: String) { loadedUrl = url }
        override fun evaluateJavascript(script: String, callback: ValueCallback<String>?) {
            callback?.onReceiveValue(if (guarded) "false" else "true")
        }
        override fun destroy() { destroyed = true; super.destroy() }
    }

    private fun fixture(guarded: Boolean, url: String? = "https://old.example.com/"): Pair<MainActivity, Page> {
        RuntimeEnvironment.getApplication().getSharedPreferences("athena", Context.MODE_PRIVATE)
            .edit().putString("origin", "https://old.example.com").commit()
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val page = Page(activity, guarded, url)
        MainActivity::class.java.getDeclaredField("web").apply { isAccessible = true }.set(activity, page)
        return activity to page
    }

    private fun choose(activity: MainActivity, item: Int) {
        MainActivity::class.java.getDeclaredMethod("appSettings").apply { isAccessible = true }.invoke(activity)
        activity.findViewById<android.view.View>(android.R.id.content)
            .findViewWithTag<android.view.View>(item).performClick()
        shadowOf(android.os.Looper.getMainLooper()).idle()
        (ShadowDialog.getLatestDialog() as AlertDialog).getButton(AlertDialog.BUTTON_POSITIVE).performClick()
        shadowOf(android.os.Looper.getMainLooper()).idle()
    }

    @Test fun changeServerOpensEditableAddressFromCloudflareAndPersistsNewOrigin() {
        val (activity, page) = fixture(guarded = false)
        choose(activity, R.string.change_server)
        assertTrue(page.destroyed)
        val input = shadowOf(activity).contentView.findViewByPredicate<EditText> { it is EditText }
        assertNotNull(input)
        assertEquals("https://old.example.com", input!!.text.toString())
        input.setText("http://new.example.com")
        activity.findViewById<android.view.View>(R.id.connect).performClick()
        assertNotNull(activity.findViewById<com.google.android.material.textfield.TextInputLayout>(R.id.server_input).error)
        assertEquals("https://old.example.com", activity.getSharedPreferences("athena", Context.MODE_PRIVATE).getString("origin", null))
        input.setText("https://new.example.com/")
        assertNull(activity.findViewById<com.google.android.material.textfield.TextInputLayout>(R.id.server_input).error)
        activity.findViewById<android.view.View>(R.id.connect).performClick()
        assertEquals("https://new.example.com", activity.getSharedPreferences("athena", Context.MODE_PRIVATE).getString("origin", null))
    }

    @Test fun activeAthenaGuardStillBlocksDestructiveNavigationUntilItConfirmsSafety() {
        val (activity, page) = fixture(guarded = true)
        choose(activity, R.string.change_server)
        assertFalse(page.destroyed)
        val pending = MainActivity::class.java.getDeclaredField("navigationAction").apply { isAccessible = true }.get(activity)
        assertNotNull(pending)
    }

    @Test fun reloadAlsoWorksWhenCloudflareHasNotLoadedAthena() {
        val (activity, page) = fixture(guarded = false)
        choose(activity, R.string.reload)
        assertEquals("https://old.example.com/", page.loadedUrl)
    }


    private fun returnFromAccess(activity: MainActivity) {
        // Access completion reconnects through the same guarded host action.
        MainActivity::class.java.getDeclaredMethod("reconnectAthena").apply { isAccessible = true }.invoke(activity)
    }

    @Test fun accessReturnLoadsServerWhenInitialNavigationNeverCommitted() {
        for (url in listOf(null, "about:blank")) {
            val (activity, page) = fixture(guarded = true, url = url)
            returnFromAccess(activity)
            assertEquals("https://old.example.com/", page.loadedUrl)
        }
    }

    @Test fun accessReturnLeavesTheCloudflareLoginUrlAndLoadsAthena() {
        val (activity, page) = fixture(guarded = false, url = "https://old.example.com/cdn-cgi/access/login")
        returnFromAccess(activity)
        assertEquals("https://old.example.com/", page.loadedUrl)
    }

    @Test fun accessReturnPreservesConversationAfterTheDraftGuardAllowsNavigation() {
        val (activity, page) = fixture(guarded = true, url = "https://old.example.com/#/chat-1")
        returnFromAccess(activity)
        assertNull(page.loadedUrl)
        val field = MainActivity::class.java.getDeclaredField("navigationAction").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        (field.get(activity) as () -> Unit).invoke()
        assertEquals("https://old.example.com/#/chat-1", page.loadedUrl)
    }

    @Test fun notificationTapDoesNotDiscardAnUnconfirmedDraft() {
        val (activity, page) = fixture(guarded = true)
        val target = "https://old.example.com/#/chat-2"
        val intent = android.content.Intent().setAction("com.athena.android.OPEN_CONVERSATION")
            .setData(android.net.Uri.parse(target))
        MainActivity::class.java.getDeclaredMethod("openNotification", android.content.Intent::class.java)
            .apply { isAccessible = true }.invoke(activity, intent)
        assertNull(page.loadedUrl)
        assertEquals(target, intent.dataString)
        val pending = MainActivity::class.java.getDeclaredField("navigationAction").apply { isAccessible = true }.get(activity)
        assertNotNull(pending)
        @Suppress("UNCHECKED_CAST")
        (pending as () -> Unit).invoke()
        assertEquals(target, page.loadedUrl)
        assertNull(intent.data)
    }

    private fun <T : android.view.View> android.view.View.findViewByPredicate(predicate: (android.view.View) -> Boolean): T? {
        if (predicate(this)) { @Suppress("UNCHECKED_CAST") return this as T }
        if (this is android.view.ViewGroup) for (index in 0 until childCount) {
            getChildAt(index).findViewByPredicate<T>(predicate)?.let { return it }
        }
        return null
    }
}
