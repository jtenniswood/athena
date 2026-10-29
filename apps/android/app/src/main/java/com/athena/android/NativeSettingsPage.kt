package com.athena.android

import android.text.InputType
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.ImageView
import com.google.android.material.button.MaterialButtonToggleGroup
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
        val value: String, val inputType: String, val checked: Boolean, val disabled: Boolean, val options: List<Option>,
        val presentation: String = "", val group: String = "", val icon: String = "")
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
                    }, text(node, "presentation", 20), text(node, "group", 100), text(node, "icon", 100))
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
            setNavigationIconTint(color(com.google.android.material.R.attr.colorOnSurface))
            setNavigationContentDescription(R.string.menu_back)
            setNavigationOnClickListener { emit("back") }
        }
        page.addView(toolbar)
        scroll = NestedScrollView(activity)
        column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16.dp(), 0, 16.dp(), 32.dp())
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
                setIcon(R.drawable.ic_search)
                iconTintList = ColorStateList.valueOf(color(com.google.android.material.R.attr.colorOnSurfaceVariant))
                setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
                setOnMenuItemClickListener { emit(next.search); true }
            }
            menu.add("Close settings").apply {
                setIcon(R.drawable.ic_close)
                iconTintList = ColorStateList.valueOf(color(com.google.android.material.R.attr.colorOnSurfaceVariant))
                setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
                setOnMenuItemClickListener { emit("close"); true }
            }
        }
        val rows = column ?: return false
        rows.removeAllViews()
        var index = 0
        while (index < next.rows.size) {
            val row = next.rows[index]
            // Long preset lists are a single preference with a choice dialog.
            // Their original command IDs still own selection and persistence.
            val detail = next.rows.getOrNull(index + 1)?.takeIf { it.kind == "text" }
            val choiceStart = index + if (detail != null) 2 else 1
            val firstChoice = next.rows.getOrNull(choiceStart)
            val fieldChoices = if (row.kind == "heading" && firstChoice?.group?.isNotBlank() == true)
                next.rows.drop(choiceStart).takeWhile { it.group == firstChoice.group } else emptyList()
            if (fieldChoices.size > 3 && fieldChoices.all { it.kind == "action" && it.description.isBlank() }) {
                val selected = fieldChoices.firstOrNull { it.checked }?.label ?: "Not set"
                val preference = firstChoice!!.copy(label = row.label, description = detail?.label ?: "", value = selected, presentation = "value", group = "", disabled = fieldChoices.all { it.disabled })
                rows.addView(render(preference).apply {
                    tag = firstChoice.group
                    setOnClickListener { chooseActions(row.label, fieldChoices) }
                }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = 2.dp() })
                index = choiceStart + fieldChoices.size
                continue
            }
            val group = if (row.group.isNotBlank()) next.rows.drop(index).takeWhile { it.group == row.group } else emptyList()
            if (group.size > 1 && compactChoices(group)) {
                rows.addView(choices(group), LinearLayout.LayoutParams(-1, -2).apply { topMargin = 4.dp(); bottomMargin = 12.dp() })
                index += group.size
            } else {
                rows.addView(render(row).apply { if (row.id.isNotBlank()) tag = row.id }, LinearLayout.LayoutParams(-1, -2).apply {
                    if (row.kind !in listOf("heading", "text")) bottomMargin = 2.dp()
                })
                index++
            }
        }
        scroll?.post { scroll?.scrollTo(0, previousScroll) }
        if (editorId != null && next.rows.none { it.id == editorId && !it.disabled }) {
            editor?.dismiss(); editor = null; editorId = null
        }
        return true
    }
    private fun color(attribute: Int) = MaterialColors.getColor(host!!, attribute)
    private fun text(value: String, heading: Boolean = false): TextView = TextView(activity).apply {
        text = value
        setTextAppearance(if (heading) com.google.android.material.R.style.TextAppearance_Material3_TitleSmall
            else com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
        setTextColor(color(if (heading) androidx.appcompat.R.attr.colorPrimary else com.google.android.material.R.attr.colorOnSurfaceVariant))
        setPadding(16.dp(), if (heading) 24.dp() else 8.dp(), 16.dp(), if (heading) 8.dp() else 16.dp())
        if (heading) ViewCompat.setAccessibilityHeading(this, true)
    }
    private fun current(row: Row) = model?.rows?.any { it.id == row.id && !it.disabled } == true
    private fun compactChoices(rows: List<Row>): Boolean = rows.size <= 3 && rows.all { it.kind == "action" && it.description.isBlank() } &&
        rows.sumOf { it.label.length } <= 24 && activity.resources.configuration.fontScale <= 1.15f &&
        activity.resources.configuration.screenWidthDp >= 360
    private fun choices(rows: List<Row>): View = MaterialButtonToggleGroup(activity).apply {
        isSingleSelection = true
        isSelectionRequired = true
        rows.forEach { row ->
            addView(MaterialButton(activity, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                id = View.generateViewId(); tag = row.id; text = row.label
                isEnabled = !row.disabled; minHeight = 48.dp()
                maxLines = 2
                isCheckable = true
                setOnClickListener { if (current(row)) emit(row.id) }
            }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        rows.indexOfFirst { it.checked }.takeIf { it >= 0 }?.let { check(getChildAt(it).id) }
    }
    private fun render(row: Row): View {
        if (row.kind in listOf("text", "heading")) return text(row.label, row.kind == "heading")
        if (row.kind == "action" && row.presentation !in listOf("navigation", "choice", "value")) {
            return LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(16.dp(), 4.dp(), 16.dp(), 8.dp())
                addView(MaterialButton(activity, null, if (row.presentation == "primary") com.google.android.material.R.attr.materialButtonStyle
                    else com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                    text = row.label; isEnabled = !row.disabled; minHeight = 48.dp()
                    if (row.presentation == "destructive") {
                        setTextColor(color(androidx.appcompat.R.attr.colorError))
                        strokeColor = ColorStateList.valueOf(color(androidx.appcompat.R.attr.colorError))
                    }
                    setOnClickListener { if (current(row)) emit(row.id) }
                }, LinearLayout.LayoutParams(-2, -2))
                if (row.description.isNotBlank()) addView(text(row.description).apply { setPadding(0, 4.dp(), 0, 8.dp()) })
            }
        }
        val selection = row.kind == "radio" || (row.presentation == "choice" && row.group.isNotBlank())
        val editable = row.kind in listOf("input", "select") || row.presentation == "value"
        val value = if (!editable) "" else if (row.inputType == "password") "Set a new value"
            else if (row.kind == "select") row.options.firstOrNull { it.value == row.value }?.label ?: row.value
            else row.value.take(240).ifBlank { "Not set" }
        val click = { if (current(row)) { when (row.kind) { "input" -> edit(row); "select" -> choose(row); else -> emit(row.id) } } }
        return LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            minimumHeight = (if (row.description.isBlank() && value.isBlank()) 56 else 72).dp()
            setPadding(16.dp(), 12.dp(), 16.dp(), 12.dp())
            background = GradientDrawable().apply {
                cornerRadius = 12.dp().toFloat()
                setColor(color(com.google.android.material.R.attr.colorSurfaceContainerLow))
            }
            val ripple = android.util.TypedValue()
            activity.theme.resolveAttribute(android.R.attr.selectableItemBackground, ripple, true)
            foreground = androidx.appcompat.content.res.AppCompatResources.getDrawable(activity, ripple.resourceId)
            isEnabled = !row.disabled; alpha = if (row.disabled) 0.38f else 1f
            setOnClickListener { click() }
            if (row.presentation == "navigation") addView(ImageView(activity).apply {
                setImageResource(categoryIcon(row.icon)); imageTintList = ColorStateList.valueOf(color(com.google.android.material.R.attr.colorOnSurfaceVariant))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, LinearLayout.LayoutParams(24.dp(), 24.dp()).apply { marginEnd = 16.dp() })
            val labels = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                addView(TextView(activity).apply {
                    text = row.label; setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyLarge)
                    setTextColor(color(com.google.android.material.R.attr.colorOnSurface))
                })
                if (value.isNotBlank()) addView(TextView(activity).apply {
                    text = value; setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
                    setTextColor(color(androidx.appcompat.R.attr.colorPrimary)); setPadding(0, 4.dp(), 0, 0)
                })
                if (row.description.isNotBlank()) addView(TextView(activity).apply {
                    text = row.description; setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
                    setTextColor(color(com.google.android.material.R.attr.colorOnSurfaceVariant)); setPadding(0, 4.dp(), 0, 0)
                })
            }
            addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
            if (row.kind == "toggle" || selection) {
                val control = if (selection) MaterialRadioButton(activity) else MaterialSwitch(activity)
                control.apply {
                    isChecked = row.checked; isEnabled = !row.disabled
                    isClickable = false; isFocusable = false
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                }
                addView(control, LinearLayout.LayoutParams(-2, -2).apply { marginStart = 16.dp() })
                ViewCompat.setAccessibilityDelegate(this, object : androidx.core.view.AccessibilityDelegateCompat() {
                    override fun onInitializeAccessibilityNodeInfo(host: View, info: androidx.core.view.accessibility.AccessibilityNodeInfoCompat) {
                        super.onInitializeAccessibilityNodeInfo(host, info)
                        info.className = if (selection) "android.widget.RadioButton" else "android.widget.Switch"
                        info.isCheckable = true; info.isChecked = row.checked
                    }
                })
            } else addView(ImageView(activity).apply {
                setImageResource(R.drawable.ic_chevron_right)
                imageTintList = ColorStateList.valueOf(color(com.google.android.material.R.attr.colorOnSurfaceVariant))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }, LinearLayout.LayoutParams(24.dp(), 24.dp()).apply { marginStart = 16.dp() })
            contentDescription = listOf(row.label, value, row.description).filter { it.isNotBlank() }.joinToString(". ")
        }
    }
    private fun categoryIcon(key: String): Int = when {
        key.contains("appearance") || key.contains("theme") -> R.drawable.ic_palette
        key.contains("notification") || key.contains("sound") -> R.drawable.ic_notifications
        key.contains("model") || key.contains("provider") || key.contains("gateway") -> R.drawable.ic_server
        key.contains("chat") || key.contains("memory") -> R.drawable.ic_chat
        key.contains("voice") -> R.drawable.ic_mic
        key.contains("update") -> R.drawable.ic_refresh
        key.contains("credential") || key.contains("permission") || key.contains("safety") -> R.drawable.ic_lock
        else -> R.drawable.ic_settings
    }
    private fun chooseActions(title: String, rows: List<Row>) {
        if (editor != null) return
        val enabled = rows.filter { !it.disabled }
        if (enabled.isEmpty()) return
        editorId = enabled.first().id
        editor = MaterialAlertDialogBuilder(activity).setTitle(title)
            .setSingleChoiceItems(enabled.map { it.label }.toTypedArray(), enabled.indexOfFirst { it.checked }) { dialog, index ->
                if (current(enabled[index])) emit(enabled[index].id)
                dialog.dismiss()
            }.setNegativeButton("Cancel", null).create().also { dialog ->
                dialog.setOnDismissListener { editor = null; editorId = null; if (refreshPending) refresh() }
                dialog.show()
            }
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
            background = null
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
        val wrapper = TextInputLayout(activity, null, com.google.android.material.R.attr.textInputOutlinedStyle).apply {
            hint = "Value"
            boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE
            helperText = row.description.takeIf { it.isNotBlank() }
            setPadding(24.dp(), 8.dp(), 24.dp(), 0)
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
