package com.athena.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.NestedScrollView
import com.google.android.material.card.MaterialCardView
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.color.MaterialColors
import com.google.android.material.button.MaterialButton

/** Native presentation only: connection and navigation actions remain owned by the host. */
class NativeAppSettings(private val activity: Activity) {
    data class Actions(val notifications: () -> Unit, val changeServer: () -> Unit, val signIn: () -> Unit, val reload: () -> Unit)
    private var host: FrameLayout? = null
    private var settingsPage: View? = null
    private var detailsPage: View? = null
    private var refreshSettings: (() -> Unit)? = null
    private var refreshDetails: (() -> Unit)? = null
    private var previousFocus: View? = null
    private val hiddenViews = mutableListOf<Pair<View, Int>>()
    val isShowing: Boolean get() = host != null
    val detailsShowing: Boolean get() = detailsPage != null

    fun dismiss() {
        host?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }
        host = null; settingsPage = null; detailsPage = null
        refreshSettings = null; refreshDetails = null
        hiddenViews.forEach { (view, visibility) -> view.visibility = visibility }
        hiddenViews.clear()
        previousFocus?.requestFocus(); previousFocus = null
    }

    fun navigateBack(): Boolean {
        if (!isShowing) return false
        if (detailsShowing && settingsPage != null) {
            host?.removeView(detailsPage)
            detailsPage = null; refreshDetails = null
            settingsPage?.visibility = View.VISIBLE
            settingsPage?.findViewById<MaterialToolbar>(R.id.settings_toolbar)?.requestFocus()
        } else dismiss()
        return true
    }

    fun refreshNotifications() {
        val row = settingsPage?.findViewWithTag<View>(R.string.notifications) ?: return
        val description = if (NativeNotifications(activity).permission() == "granted") R.string.notifications_enabled else R.string.notifications_disabled
        row.findViewById<TextView>(R.id.row_description).setText(description)
        row.contentDescription = "${activity.getString(R.string.notifications)}. ${activity.getString(description)}"
    }

    fun refresh() {
        val settings = refreshSettings
        val details = refreshDetails
        dismiss()
        settings?.invoke()
        details?.invoke()
    }

    private fun page(title: Int): View {
        val parent = host ?: FrameLayout(activity).also { frame ->
            val content = activity.findViewById<FrameLayout>(android.R.id.content)
            frame.setBackgroundColor(MaterialColors.getColor(frame, com.google.android.material.R.attr.colorSurface))
            previousFocus = activity.currentFocus
            for (index in 0 until content.childCount) {
                content.getChildAt(index).let { hiddenViews.add(it to it.visibility); it.visibility = View.INVISIBLE }
            }
            content.addView(frame, FrameLayout.LayoutParams(-1, -1))
            host = frame
            ViewCompat.setOnApplyWindowInsetsListener(frame) { view, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                insets
            }
            ViewCompat.requestApplyInsets(frame)
        }
        return activity.layoutInflater.inflate(R.layout.screen_settings_page, parent, false).also { screen ->
            screen.tag = title
            screen.findViewById<MaterialToolbar>(R.id.settings_toolbar).apply {
                setTitle(title)
                setNavigationOnClickListener { navigateBack() }
                ViewCompat.setAccessibilityHeading(this, true)
            }
            ViewCompat.setAccessibilityPaneTitle(screen, activity.getString(title))
            parent.addView(screen, FrameLayout.LayoutParams(-1, -1))
        }
    }

    fun show(origin: String, diagnostics: () -> AppDiagnostics, actions: Actions) {
        if (isShowing) return
        refreshSettings = { show(origin, diagnostics, actions) }
        val screen = page(R.string.app_settings)
        settingsPage = screen
        val body = screen.findViewById<FrameLayout>(R.id.settings_page_content)
        val content = activity.layoutInflater.inflate(R.layout.screen_app_settings, body, true)
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
            item.setOnClickListener { action() }
            rows.addView(item)
        }
        row(R.string.notifications, if (NativeNotifications(activity).permission() == "granted") R.string.notifications_enabled else R.string.notifications_disabled, R.drawable.ic_notifications) { actions.notifications() }
        row(R.string.change_server, R.string.change_server_description, R.drawable.ic_server) { dismiss(); actions.changeServer() }
        row(R.string.browser_sign_in, R.string.browser_sign_in_description, R.drawable.ic_open_browser) { dismiss(); actions.signIn() }
        row(R.string.reload, R.string.reload_description, R.drawable.ic_refresh) { dismiss(); actions.reload() }
        row(R.string.connection_details, R.string.connection_details_description, R.drawable.ic_server) { showDetails(diagnostics()) }
    }

    fun showDetails(snapshot: AppDiagnostics) {
        if (detailsShowing) return
        refreshDetails = { showDetails(snapshot) }
        settingsPage?.visibility = View.GONE
        val screen = page(R.string.connection_details)
        detailsPage = screen
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
        column.addView(MaterialButton(activity, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
            id = R.id.copy_details
            setText(R.string.copy_details)
            setOnClickListener {
                activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Athena app details", snapshot.text()))
            }
        }, LinearLayout.LayoutParams(-1, -2))
        val scroll = NestedScrollView(activity).apply { isFillViewport = true; addView(column) }
        screen.findViewById<FrameLayout>(R.id.settings_page_content).addView(scroll)
    }
    private fun Int.dp(): Int = (this * activity.resources.displayMetrics.density).toInt()
}
