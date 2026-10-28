package com.athena.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.NestedScrollView
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.card.MaterialCardView
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** Native presentation only: connection and navigation actions remain owned by the host. */
class NativeAppSettings(private val activity: Activity) {
    data class Actions(val notifications: () -> Unit, val changeServer: () -> Unit, val signIn: () -> Unit, val reload: () -> Unit)
    var sheet: BottomSheetDialog? = null
        private set
    private var details: AlertDialog? = null
    val isShowing: Boolean get() = sheet?.isShowing == true
    val detailsShowing: Boolean get() = details?.isShowing == true
    fun dismiss() { sheet?.dismiss(); details?.dismiss() }

    fun show(origin: String, diagnostics: () -> AppDiagnostics, actions: Actions) {
        if (isShowing) return
        val dialog = BottomSheetDialog(activity)
        sheet = dialog
        val content = activity.layoutInflater.inflate(R.layout.sheet_app_settings, FrameLayout(activity), false)
        ViewCompat.setAccessibilityHeading(content.findViewById(R.id.settings_title), true)
        content.findViewById<TextView>(R.id.connected_server).text = origin
        content.findViewById<TextView>(R.id.app_version).text = activity.getString(R.string.version, BuildConfig.VERSION_NAME)
        val rows = content.findViewById<LinearLayout>(R.id.settings_rows)
        fun row(title: Int, description: Int, icon: Int, action: () -> Unit) {
            val item = activity.layoutInflater.inflate(R.layout.app_settings_row, rows, false)
            item.findViewById<TextView>(R.id.row_title).setText(title)
            item.findViewById<TextView>(R.id.row_description).setText(description)
            item.findViewById<ImageView>(R.id.row_icon).setImageResource(icon)
            item.tag = title
            item.contentDescription = "${activity.getString(title)}. ${activity.getString(description)}"
            ViewCompat.setAccessibilityDelegate(item, object : androidx.core.view.AccessibilityDelegateCompat() {
                override fun onInitializeAccessibilityNodeInfo(host: View, info: androidx.core.view.accessibility.AccessibilityNodeInfoCompat) {
                    super.onInitializeAccessibilityNodeInfo(host, info); info.className = "android.widget.Button"
                }
            })
            item.setOnClickListener { dialog.dismiss(); action() }
            rows.addView(item)
        }
        row(R.string.notifications, if (NativeNotifications(activity).permission() == "granted") R.string.notifications_enabled else R.string.notifications_disabled, R.drawable.ic_notifications, actions.notifications)
        row(R.string.change_server, R.string.change_server_description, R.drawable.ic_server, actions.changeServer)
        row(R.string.browser_sign_in, R.string.browser_sign_in_description, R.drawable.ic_open_browser, actions.signIn)
        row(R.string.reload, R.string.reload_description, R.drawable.ic_refresh, actions.reload)
        row(R.string.connection_details, R.string.connection_details_description, R.drawable.ic_server) { showDetails(diagnostics()) }
        dialog.setContentView(content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, 0, bars.right, bars.bottom); insets
        }
        dialog.setOnDismissListener { if (sheet === dialog) sheet = null }
        dialog.show()
        dialog.behavior.state = BottomSheetBehavior.STATE_EXPANDED
    }

    fun showDetails(snapshot: AppDiagnostics) {
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16.dp(), 0, 16.dp(), 8.dp())
        }
        for (section in snapshot.sections) {
            val rows = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(16.dp(), 16.dp(), 16.dp(), 16.dp()) }
            rows.addView(TextView(activity).apply {
                text = section.title
                setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_TitleMedium)
                ViewCompat.setAccessibilityHeading(this, true)
            })
            for ((label, value) in section.rows) {
                rows.addView(TextView(activity).apply {
                    text = label; setPadding(0, 12.dp(), 0, 4.dp())
                    setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_LabelLarge)
                })
                rows.addView(TextView(activity).apply {
                    text = value; setTextIsSelectable(true)
                    setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
                })
            }
            column.addView(MaterialCardView(activity).apply {
                radius = 20.dp().toFloat(); cardElevation = 0f; addView(rows)
            }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 12.dp() })
        }
        val scroll = NestedScrollView(activity).apply { addView(column) }
        val dialog = MaterialAlertDialogBuilder(activity).setTitle(R.string.connection_details).setView(scroll)
            .setPositiveButton("Close", null).setNeutralButton(R.string.copy_details) { _, _ ->
                activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Athena app details", snapshot.text()))
            }.create()
        details = dialog
        dialog.setOnDismissListener { if (details === dialog) details = null }
        dialog.show()
    }
    private fun Int.dp(): Int = (this * activity.resources.displayMetrics.density).toInt()
}
