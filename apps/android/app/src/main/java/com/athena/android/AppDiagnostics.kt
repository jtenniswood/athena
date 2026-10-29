package com.athena.android

import android.content.Context
import androidx.webkit.WebViewCompat
import com.google.firebase.FirebaseApp

/** A deliberately limited projection: no tokens, cookies, private keys or chat content. */
data class AppDiagnostics(val sections: List<Section>) {
    data class Section(val title: String, val rows: List<Pair<String, String>>)
    fun text(): String = sections.joinToString("\n\n") { section ->
        section.title + "\n" + section.rows.joinToString("\n") { (label, value) -> "$label: $value" }
    }
    companion object {
        fun capture(context: Context, origin: String, connection: ConnectionCoordinator, webRevision: String, serverProtocol: String, connectionTest: String? = null): AppDiagnostics {
            val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
            return AppDiagnostics(listOf(
                Section("Connection", listOf(
                    "Server" to origin,
                    "State" to connection.state.stage.name.lowercase().replace('_', ' '),
                    "Status" to connection.state.message,
                    "Connection test" to (connectionTest ?: "Off"),
                    "Bridge protocol" to (connection.protocol?.toString() ?: "Legacy"),
                    "Server protocol" to serverProtocol
                )),
                Section("Notifications", listOf(
                    "Permission" to NativeNotifications(context).permission(),
                    "Firebase" to if (FirebaseApp.getApps(context).isEmpty()) "Not configured" else "Configured",
                    "Registration" to if (prefs.getBoolean("pushEnabled", false)) "Active" else "Inactive",
                    "Token sync" to (prefs.getString("pushSyncStatus", "Not registered") ?: "Not registered"),
                    "Delivery" to (prefs.getString("pushDeliveryStatus", "No delivery status") ?: "No delivery status")
                )),
                Section("Versions", listOf(
                    "Android app" to "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                    "APK source" to BuildConfig.BUILD_REVISION,
                    "Web source" to webRevision,
                    "Android System WebView" to (WebViewCompat.getCurrentWebViewPackage(context)?.versionName ?: "Unavailable")
                ))
            ))
        }
    }
}
