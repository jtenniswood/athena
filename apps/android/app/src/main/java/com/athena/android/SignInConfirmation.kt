package com.athena.android

import android.app.Activity
import android.widget.FrameLayout
import android.widget.TextView
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** The same review step for both browser handoffs, with the server kept visible. */
object SignInConfirmation {
    fun builder(activity: Activity, origin: String): MaterialAlertDialogBuilder {
        val content = activity.layoutInflater.inflate(R.layout.dialog_browser_sign_in, FrameLayout(activity), false)
        content.findViewById<TextView>(R.id.sign_in_server).text = origin
        return MaterialAlertDialogBuilder(activity).setTitle(R.string.sign_in_title)
            .setIcon(R.drawable.ic_open_browser).setView(content)
    }
}
