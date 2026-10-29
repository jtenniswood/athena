package com.athena.android

import android.text.InputType
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.NestedScrollView
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.color.MaterialColors
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.radiobutton.MaterialRadioButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import org.json.JSONObject

/** Native views only. The originating page retains all settings/save ownership. */
class NativeSettingsPage(private val activity: AppCompatActivity) {
    data class Option(val label: String, val value: String, val disabled: Boolean)
    data class Row(val id: String, val kind: String, val label: String, val description: String,
        val value: String, val inputType: String, val checked: Boolean, val disabled: Boolean, val options: List<Option>)
    data class Model(val id: String, val scope: String, val title: String, val search: String, val rows: List<Row>)
    companion object {
        fun parse(payload: JSONObject): Model {
            fun text(value: JSONObject, key: String, limit: Int, required: Boolean = false): String {
                val raw = value.opt(key)
                require(raw == null || raw == JSONObject.NULL || raw is String)
                val string = if (raw is String) raw else ""
                require(string.length <= limit && (!required || string.isNotBlank()))
                return string
            }
            val nodes = payload.getJSONArray("rows")
            require(nodes.length() <= 1000)
            val ids = mutableSetOf<String>()
            val rows = (0 until nodes.length()).map { index ->
                val node = nodes.getJSONObject(index)
                val kind = text(node, "kind", 20, true)
                require(kind in listOf("heading", "text", "action", "toggle", "radio", "input", "select"))
                val id = text(node, "id", 100, kind !in listOf("heading", "text"))
                if (id.isNotEmpty()) require(ids.add(id))
                val options = node.optJSONArray("options")
                require(options == null || options.length() <= 2000)
                Row(id, kind, text(node, "label", 2000, true), text(node, "description", 1000),
                    text(node, "value", 131072), text(node, "inputType", 40), node.optBoolean("checked"),
                    node.optBoolean("disabled"), (0 until (options?.length() ?: 0)).map { optionIndex ->
                        val option = options!!.getJSONObject(optionIndex)
                        Option(text(option, "label", 240, true), text(option, "value", 1000), option.optBoolean("disabled"))
                    })
            }
            return Model(text(payload, "id", 100, true), text(payload, "scope", 500, true),
                text(payload, "title", 240, true), text(payload, "search", 100), rows)
        }
    }
    private var host: LinearLayout? = null
    private var toolbar: MaterialToolbar? = null
    private var scroll: NestedScrollView? = null
    private var column: LinearLayout? = null
    private var model: Model? = null
    private var reply: ((Any) -> Unit)? = null
    private var editor: AlertDialog? = null
    private var editorId: String? = null
    private var refreshPending = false
    private val hidden = mutableListOf<Pair<View, Int>>()
    val isShowing get() = host != null
    private fun emit(id: String, value: String? = null) {
        reply?.invoke(JSONObject().put("status", "changed").put("id", id).apply { if (value != null) put("value", value) })
    }
    fun back(): Boolean { if (!isShowing) return false; emit("back"); return true }
    fun show(next: Model, respond: (Any) -> Unit) {
        dismiss()
        reply = respond
        val content = activity.findViewById<FrameLayout>(android.R.id.content)
        for (index in 0 until content.childCount) content.getChildAt(index).let {
            hidden.add(it to it.visibility); it.visibility = View.INVISIBLE
        }
        val page = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorSurface))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        host = page
        ViewCompat.setAccessibilityPaneTitle(page, next.title)
        ViewCompat.setOnApplyWindowInsetsListener(page) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); insets
        }
        toolbar = MaterialToolbar(activity).apply {
            setNavigationIcon(R.drawable.ic_arrow_back)
            setNavigationContentDescription(R.string.menu_back)
            setNavigationOnClickListener { emit("back") }
        }
        page.addView(toolbar)
        scroll = NestedScrollView(activity)
        column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp(), 8.dp(), 20.dp(), 24.dp())
        }
        scroll!!.addView(column!!)
        page.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        content.addView(page, FrameLayout.LayoutParams(-1, -1))
        ViewCompat.requestApplyInsets(page)
        update(next)
        emit("ready")
    }
    fun update(next: Model): Boolean {
        if (host == null || (model != null && next.id != model!!.id)) return false
        val sameScope = model?.scope == next.scope
        val previousScroll = if (sameScope) scroll?.scrollY ?: 0 else 0
        model = next
        host?.let { ViewCompat.setAccessibilityPaneTitle(it, next.title) }
        toolbar?.apply {
            title = next.title
            menu.clear()
            if (next.search.isNotBlank()) menu.add("Search settings").apply {
                setIcon(android.R.drawable.ic_menu_search)
                setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
                setOnMenuItemClickListener { emit(next.search); true }
            }
            menu.add("Close settings").apply {
                setIcon(android.R.drawable.ic_menu_close_clear_cancel)
                setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
                setOnMenuItemClickListener { emit("close"); true }
            }
        }
        val rows = column ?: return false
        rows.removeAllViews()
        for (row in next.rows) rows.addView(render(row).apply { if (row.id.isNotBlank()) tag = row.id }, LinearLayout.LayoutParams(-1, -2))
        scroll?.post { scroll?.scrollTo(0, previousScroll) }
        if (editorId != null && next.rows.none { it.id == editorId && !it.disabled }) {
            editor?.dismiss(); editor = null; editorId = null
        }
        return true
    }
    private fun text(value: String, heading: Boolean = false): TextView = TextView(activity).apply {
        text = value
        setTextAppearance(if (heading) com.google.android.material.R.style.TextAppearance_Material3_TitleMedium
            else com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
        setPadding(0, if (heading) 20.dp() else 6.dp(), 0, 8.dp())
        if (heading) ViewCompat.setAccessibilityHeading(this, true)
    }
    private fun render(row: Row): View {
        if (row.kind in listOf("text", "heading")) return text(row.label, row.kind == "heading")
        if (row.kind == "action") return LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(MaterialButton(activity, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = row.label
                isEnabled = !row.disabled
                isCheckable = row.checked
                isChecked = row.checked
                setOnClickListener { if (model?.rows?.any { it.id == row.id && !it.disabled } == true) emit(row.id) }
            }, LinearLayout.LayoutParams(-1, -2))
            if (row.description.isNotBlank()) addView(text(row.description))
        }
        val container = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 12.dp(), 0, 12.dp())
        }
        if (row.kind == "toggle" || row.kind == "radio") {
            val control = if (row.kind == "toggle") MaterialSwitch(activity) else MaterialRadioButton(activity)
            control.apply {
                text = row.label; isChecked = row.checked; isEnabled = !row.disabled
                setOnClickListener { emit(row.id) }
            }
            container.addView(control)
        } else {
            container.addView(text(row.label, true).apply { setPadding(0, 0, 0, 4.dp()) })
            val display = if (row.inputType == "password") "Set a new value"
                else if (row.kind == "select") row.options.firstOrNull { it.value == row.value }?.label ?: row.value
                else row.value.take(240).ifBlank { "Set value" }
            container.addView(MaterialButton(activity, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                text = display; isEnabled = !row.disabled
                contentDescription = "${row.label}. $display"
                setOnClickListener { if (row.kind == "select") choose(row) else edit(row) }
            })
        }
        if (row.description.isNotBlank()) container.addView(text(row.description))
        return container
    }
    private fun choose(row: Row) {
        if (editor != null) return
        editorId = row.id
        val options = row.options.filter { !it.disabled }
        editor = MaterialAlertDialogBuilder(activity).setTitle(row.label)
            .setSingleChoiceItems(options.map { it.label }.toTypedArray(), options.indexOfFirst { it.value == row.value }) { dialog, index ->
                emit(row.id, options[index].value); dialog.dismiss()
            }.setNegativeButton("Cancel", null).create().also { dialog ->
                dialog.setOnDismissListener { editor = null; editorId = null; if (refreshPending) refresh() }
                dialog.show()
            }
    }
    private fun edit(row: Row) {
        if (editor != null) return
        editorId = row.id
        val input = TextInputEditText(activity).apply {
            isSaveEnabled = false
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
            inputType = when (row.inputType) {
                "password" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                "number", "range" -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
                "email" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                "url" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                "textarea" -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                else -> InputType.TYPE_CLASS_TEXT
            }
            imeOptions = EditorInfo.IME_ACTION_DONE
            filters = arrayOf(android.text.InputFilter.LengthFilter(131072))
            setText(row.value)
            if (row.inputType == "textarea") minLines = 4
        }
        val wrapper = TextInputLayout(activity).apply {
            hint = row.label
            setPadding(20.dp(), 8.dp(), 20.dp(), 0)
            addView(input)
        }
        val builder = MaterialAlertDialogBuilder(activity).setTitle(row.label).setView(wrapper)
            .setNegativeButton("Cancel", null).setPositiveButton("Save", null)
        if (row.inputType == "password") builder.setNeutralButton("Clear value") { _, _ -> emit(row.id, "") }
        editor = builder.create().also { dialog ->
            dialog.setOnDismissListener { input.text?.clear(); editor = null; editorId = null; if (refreshPending) refresh() }
            dialog.show()
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                if (row.inputType == "password" && input.text.isNullOrEmpty()) {
                    wrapper.error = "Enter a new value, or choose Clear value."
                } else if (model?.rows?.any { it.id == row.id && !it.disabled } == true) {
                    emit(row.id, input.text.toString()); dialog.dismiss()
                }
            }
            input.requestFocus()
            dialog.window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        }
    }
    fun refresh() {
        if (editor != null) { refreshPending = true; return }
        refreshPending = false
        val next = model ?: return
        val callback = reply ?: return
        val position = scroll?.scrollY ?: 0
        reply = null
        show(next, callback)
        scroll?.post { scroll?.scrollTo(0, position) }
    }
    fun dismiss(id: String? = null) {
        if (id != null && id != model?.id) return
        refreshPending = false
        editor?.dismiss(); editor = null; editorId = null
        host?.let { (it.parent as? ViewGroup)?.removeView(it) }
        host = null; toolbar = null; scroll = null; column = null; model = null
        hidden.forEach { (view, visibility) -> view.visibility = visibility }; hidden.clear()
        val callback = reply; reply = null
        callback?.invoke(JSONObject().put("status", "dismissed"))
    }
    private fun Int.dp() = (this * activity.resources.displayMetrics.density).toInt()
}
