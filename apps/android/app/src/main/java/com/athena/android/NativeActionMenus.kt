package com.athena.android

import android.view.Menu
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.NestedScrollView
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDragHandleView
import com.google.android.material.button.MaterialButton
import com.google.android.material.color.MaterialColors
import org.json.JSONArray
import org.json.JSONObject

/** Presents bounded command descriptions. Only the originating web owner executes commands. */
class NativeActionMenus(private val activity: AppCompatActivity) {
    data class Item(val id: String, val label: String, val description: String, val disabled: Boolean,
        val destructive: Boolean, val checked: Boolean?, val children: List<Group>?)
    data class Group(val label: String, val single: Boolean, val items: List<Item>)
    data class Model(val id: String, val title: String, val compact: Boolean, val x: Double, val y: Double,
        val viewportWidth: Double, val groups: List<Group>)

    companion object {
        fun parse(payload: JSONObject): Model {
            var count = 0
            val ids = mutableSetOf<String>()
            fun text(value: JSONObject, key: String, max: Int, required: Boolean = false): String {
                val raw = value.opt(key)
                require(raw == null || raw == JSONObject.NULL || raw is String)
                val result = if (raw is String) raw else ""
                require(result.length <= max && (!required || result.isNotBlank()))
                return result
            }
            fun groups(values: JSONArray, depth: Int): List<Group> {
                require(depth <= 3 && values.length() <= 20)
                return (0 until values.length()).map { i ->
                    val group = values.getJSONObject(i)
                    val items = group.getJSONArray("items")
                    Group(text(group, "label", 160), group.optString("selection") == "single", (0 until items.length()).map { j ->
                        require(++count <= 80)
                        val item = items.getJSONObject(j)
                        val id = text(item, "id", 512, true)
                        require(ids.add(id))
                        val children = if (item.has("children")) groups(item.getJSONArray("children"), depth + 1) else null
                        require(children == null || children.any { it.items.isNotEmpty() })
                        Item(id, text(item, "label", 240, true), text(item, "description", 500),
                            item.optBoolean("disabled"), item.optBoolean("destructive"),
                            if (item.has("checked")) item.getBoolean("checked") else null, children)
                    })
                }
            }
            val sections = groups(payload.getJSONArray("groups"), 0)
            require(count > 0)
            val width = payload.getDouble("viewportWidth")
            val x = payload.getDouble("x")
            val y = payload.getDouble("y")
            require(width.isFinite() && width > 0 && x.isFinite() && y.isFinite())
            return Model(text(payload, "id", 100, true), text(payload, "title", 240, true), payload.optBoolean("compact"), x, y, width, sections)
        }
    }

    private var requestId: String? = null
    private var completion: ((Any) -> Unit)? = null
    private var sheet: BottomSheetDialog? = null
    private var popup: PopupMenu? = null
    private var anchorView: View? = null

    fun dismiss(id: String? = null) {
        if (id != null && id != requestId) return
        finish(JSONObject().put("status", "dismissed"))
    }

    private fun finish(value: JSONObject) {
        val reply = completion
        completion = null; requestId = null
        val oldSheet = sheet; sheet = null
        val oldPopup = popup; popup = null
        oldSheet?.setOnDismissListener(null); oldSheet?.dismiss()
        oldPopup?.setOnDismissListener(null); oldPopup?.dismiss()
        anchorView?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) }; anchorView = null
        reply?.invoke(value)
    }

    fun show(model: Model, web: View, respond: (Any) -> Unit) {
        dismiss()
        requestId = model.id; completion = respond
        if (model.compact) showSheet(model) else showPopup(model, web)
    }

    private fun selected(item: Item) {
        if (!item.disabled && item.children == null) finish(JSONObject().put("status", "selected").put("id", item.id))
    }

    private fun showSheet(model: Model) {
        val dialog = BottomSheetDialog(activity)
        sheet = dialog
        val content = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        content.addView(BottomSheetDragHandleView(activity))
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; setPadding(24.dp(), 0, 24.dp(), 16.dp())
        }
        content.addView(header)
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; setPadding(8.dp(), 0, 8.dp(), 16.dp())
        }
        val scroll = NestedScrollView(activity).apply { isFillViewport = false; addView(column) }
        content.addView(scroll, LinearLayout.LayoutParams(-1, -2).apply { weight = 1f })
        var goBack: (() -> Unit)? = null
        dialog.onBackPressedDispatcher.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { goBack?.invoke() ?: dialog.cancel() }
        })
        fun render(groups: List<Group>, title: String, back: (() -> Unit)? = null, restoreId: String? = null) {
            goBack = back
            header.removeAllViews()
            column.removeAllViews()
            if (back != null) header.addView(MaterialButton(activity, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                setText(R.string.menu_back); isAllCaps = false; minHeight = 48.dp()
                setOnClickListener { back() }
            }, LinearLayout.LayoutParams(-2, -2))
            val heading = TextView(activity).apply {
                text = title; setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_TitleLarge)
                ViewCompat.setAccessibilityHeading(this, true)
                ViewCompat.setAccessibilityPaneTitle(content, title)
            }
            header.addView(heading)
            for ((index, group) in groups.withIndex()) {
                if (index > 0) column.addView(com.google.android.material.divider.MaterialDivider(activity),
                    LinearLayout.LayoutParams(-1, -2).apply { topMargin = 8.dp(); bottomMargin = 8.dp() })
                if (group.label.isNotEmpty()) column.addView(TextView(activity).apply {
                    text = group.label; setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_LabelLarge)
                    setPadding(16.dp(), 16.dp(), 16.dp(), 8.dp()); ViewCompat.setAccessibilityHeading(this, true)
                })
                for (item in group.items) {
                    val row = activity.layoutInflater.inflate(R.layout.action_menu_row, column, false)
                    row.tag = item.id; row.isEnabled = !item.disabled
                    row.alpha = if (item.disabled) 0.38f else 1f
                    val label = row.findViewById<TextView>(R.id.menu_label).apply { text = item.label }
                    row.findViewById<TextView>(R.id.menu_description).apply {
                        text = item.description; visibility = if (item.description.isEmpty()) View.GONE else View.VISIBLE
                    }
                    row.findViewById<ImageView>(R.id.menu_submenu).visibility = if (item.children != null) View.VISIBLE else View.GONE
                    row.contentDescription = listOf(item.label, item.description).filter { it.isNotEmpty() }.joinToString(". ")
                    if (item.children != null) row.contentDescription = activity.getString(R.string.menu_open_submenu, row.contentDescription)
                    if (item.checked != null) row.findViewById<ImageView>(R.id.menu_selection).apply {
                        visibility = View.VISIBLE
                        setImageResource(if (group.single) {
                            if (item.checked) R.drawable.ic_radio_selected else R.drawable.ic_radio_unselected
                        } else if (item.checked) R.drawable.ic_checkbox_selected else R.drawable.ic_menu_unchecked)
                    }
                    ViewCompat.setAccessibilityDelegate(row, object : androidx.core.view.AccessibilityDelegateCompat() {
                        override fun onInitializeAccessibilityNodeInfo(host: View, info: androidx.core.view.accessibility.AccessibilityNodeInfoCompat) {
                            super.onInitializeAccessibilityNodeInfo(host, info)
                            info.className = if (item.checked == null) "android.widget.Button"
                                else if (group.single) "android.widget.RadioButton" else "android.widget.CheckBox"
                            info.isCheckable = item.checked != null; info.isChecked = item.checked == true
                        }
                    })
                    if (item.destructive) label.setTextColor(MaterialColors.getColor(label, androidx.appcompat.R.attr.colorError))
                    row.setOnClickListener {
                        if (item.children != null) render(item.children, item.label, { render(groups, title, back, item.id) })
                        else selected(item)
                    }
                    column.addView(row)
                }
            }
            scroll.post {
                val target = restoreId?.let { column.findViewWithTag<View>(it) }
                if (target != null) { target.requestFocus(); target.requestRectangleOnScreen(android.graphics.Rect(0, 0, target.width, target.height)) }
                else scroll.scrollTo(0, 0)
            }
        }
        render(model.groups, model.title)
        dialog.setContentView(content)
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, 0, bars.right, bars.bottom); insets
        }
        dialog.setOnDismissListener { if (sheet === dialog) dismiss() }
        dialog.show()
        dialog.behavior.state = BottomSheetBehavior.STATE_EXPANDED
    }

    private fun showPopup(model: Model, web: View) {
        val root = activity.findViewById<FrameLayout>(android.R.id.content)
        val webPosition = IntArray(2); val rootPosition = IntArray(2)
        web.getLocationOnScreen(webPosition); root.getLocationOnScreen(rootPosition)
        val scale = web.width / model.viewportWidth
        val anchor = View(activity).apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
        anchorView = anchor
        root.addView(anchor, FrameLayout.LayoutParams(1, 1).apply {
            leftMargin = (webPosition[0] - rootPosition[0] + model.x * scale).toInt().coerceIn(0, (root.width - 1).coerceAtLeast(0))
            topMargin = (webPosition[1] - rootPosition[1] + model.y * scale).toInt().coerceIn(0, (root.height - 1).coerceAtLeast(0))
        })
        val menu = PopupMenu(activity, anchor)
        popup = menu
        var nextId = 0
        val actions = mutableMapOf<Int, Item>()
        fun populate(target: Menu, groups: List<Group>) {
            for (group in groups) {
                val groupId = ++nextId
                if (group.label.isNotEmpty()) target.add(groupId, ++nextId, Menu.NONE, group.label).isEnabled = false
                for (item in group.items) {
                    val itemId = ++nextId
                    val entry = if (item.children != null) target.addSubMenu(groupId, itemId, Menu.NONE, item.label).also { populate(it, item.children) }.item
                        else target.add(groupId, itemId, Menu.NONE, item.label).also { actions[itemId] = item }
                    entry.isEnabled = !item.disabled
                    entry.isCheckable = item.checked != null; entry.isChecked = item.checked == true
                    entry.contentDescription = item.description.ifEmpty { item.label }
                }
                target.setGroupCheckable(groupId, group.items.any { it.checked != null }, group.single)
            }
        }
        populate(menu.menu, model.groups)
        menu.setOnMenuItemClickListener { item -> actions[item.itemId]?.let { selected(it) }; true }
        menu.setOnDismissListener { if (popup === menu) dismiss() }
        anchor.post { if (popup === menu && requestId == model.id) menu.show() }
    }

    private fun Int.dp() = (this * activity.resources.displayMetrics.density).toInt()
}
