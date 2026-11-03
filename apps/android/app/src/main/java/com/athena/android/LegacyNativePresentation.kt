package com.athena.android

import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/** Optional presenters retained for older web clients; current clients use shared web UI. */
class LegacyNativePresentation(
    activity: AppCompatActivity,
    private val webView: () -> WebView?,
    private val isForeground: () -> Boolean,
    private val presenting: () -> Unit
) {
    companion object {
        val capabilities = listOf("action-menu", "action-menu-live", "settings-page", "action-menu-search")
    }

    private val actionMenus by lazy { NativeActionMenus(activity) }
    private val settingsPage by lazy { NativeSettingsPage(activity) }
    val settingsShowing get() = settingsPage.isShowing

    /** Origin and envelope validation remain with the host bridge. */
    fun handle(method: String, payload: JSONObject, respond: (Any) -> Unit): Boolean {
        when (method) {
            "settingsPage" -> {
                val model = NativeSettingsPage.parse(payload)
                if (webView() == null || !isForeground()) respond(JSONObject().put("status", "dismissed"))
                else { presenting(); settingsPage.show(model, respond) }
            }
            "updateSettingsPage" -> respond(settingsPage.update(NativeSettingsPage.parse(payload)))
            "dismissSettingsPage" -> { settingsPage.dismiss(payload.getString("id")); respond(true) }
            "actionMenu" -> {
                val model = NativeActionMenus.parse(payload)
                val view = webView()
                if (view == null || !isForeground()) respond(JSONObject().put("status", "dismissed"))
                else { presenting(); actionMenus.show(model, view, respond) }
            }
            "dismissActionMenu" -> { actionMenus.dismiss(payload.getString("id")); respond(true) }
            "updateActionMenu" -> respond(actionMenus.update(NativeActionMenus.parse(payload)))
            else -> return false
        }
        return true
    }

    fun dismissActions() = actionMenus.dismiss()
    fun dismiss() { settingsPage.dismiss(); actionMenus.dismiss() }
    fun refresh() = settingsPage.refresh()
    fun back(): Boolean = settingsPage.back()
}
