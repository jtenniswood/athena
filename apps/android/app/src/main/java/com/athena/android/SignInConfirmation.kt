package com.athena.android

import android.app.Activity
import android.widget.FrameLayout
import android.widget.TextView
import com.google.android.material.dialog.MaterialAlertDialogBuilder

/** The same review step for both browser handoffs, with server and code kept visible. */
object SignInConfirmation {
    fun builder(activity: Activity, origin: String, code: String): MaterialAlertDialogBuilder {
        val content = activity.layoutInflater.inflate(R.layout.dialog_browser_sign_in, FrameLayout(activity), false)
        content.findViewById<TextView>(R.id.sign_in_server).text = origin
        content.findViewById<TextView>(R.id.sign_in_code).apply {
            text = code
            // Read each character separately so a verification code is easy to compare with TalkBack.
            contentDescription = activity.getString(R.string.verification_code_spoken, code.toCharArray().joinToString(" "))
        }
        return MaterialAlertDialogBuilder(activity).setTitle(R.string.sign_in_title)
            .setIcon(R.drawable.ic_open_browser).setView(content)
    }
}
