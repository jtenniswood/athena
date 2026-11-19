package com.athena.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import org.json.JSONObject

internal object WorkingNotification {
    private const val CHANNEL = "working"
    private const val TAG = "athena-working"
    private const val RUN_ID = "com.athena.android.WORKING_RUN_ID"
    private const val EXPIRES_AT = "com.athena.android.WORKING_EXPIRES_AT"
    private val validRunId = Regex("[a-f0-9]{64}")
    private var background = true

    @Synchronized
    fun setBackground(context: Context, value: Boolean) {
        background = value
        refresh(context)
    }

    @Synchronized
    fun receive(context: Context, data: Map<String, String>) {
        if (Build.VERSION.SDK_INT < 36) return
        val settings = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val origin = settings.getString("origin", "").orEmpty()
        val binding = settings.getString("pushBinding", "").orEmpty()
        if (origin.isEmpty() || binding.isEmpty() || data["origin"] != origin || data["bindingId"] != binding ||
            !settings.getBoolean("pushEnabled", false)) return
        val id = data["runId"]?.takeIf(validRunId::matches) ?: return
        val expiresAt = data["expiresAt"]?.toLongOrNull()?.takeIf { it > System.currentTimeMillis() } ?: return
        val runs = context.getSharedPreferences("working-runs", Context.MODE_PRIVATE)
        val run = JSONObject().put("origin", origin).put("binding", binding).put("expires", expiresAt)
        if (data["kind"] == "workingStart") {
            // A completed or dismissed run can receive a delayed or duplicate start.
            if (runs.contains(id)) return
            val session = data["focusSessionId"]?.takeIf { it.isNotBlank() } ?: return
            run.put("target", ServerAddress.conversationUrl(origin, session, data["focusProfile"]))
        }
        runs.edit().putString(id, run.toString()).apply()
        refresh(context)
    }

    @Synchronized
    fun dismiss(context: Context, intent: Intent) {
        val id = intent.data?.lastPathSegment?.takeIf(validRunId::matches) ?: return
        val runs = context.getSharedPreferences("working-runs", Context.MODE_PRIVATE)
        val run = runs.getString(id, null)?.let(::JSONObject) ?: return
        if (run.optLong("expires") != intent.getLongExtra(EXPIRES_AT, 0)) return
        // Keep the run receipt until its expiry to prevent another start from reposting it.
        run.remove("target")
        runs.edit().putString(id, run.toString()).apply()
        refresh(context)
    }

    @Synchronized
    fun refresh(context: Context) {
        if (Build.VERSION.SDK_INT < 36) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val settings = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val origin = settings.getString("origin", "")
        val binding = settings.getString("pushBinding", "")
        val enabled = settings.getBoolean("pushEnabled", false)
        val runs = context.getSharedPreferences("working-runs", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val edit = runs.edit()
        val latest = runs.all.mapNotNull { (id, value) ->
            val run = JSONObject(value as String)
            if (!enabled || run.optLong("expires") <= now || run.optString("origin") != origin ||
                run.optString("binding") != binding) {
                edit.remove(id)
                null
            } else if (run.has("target")) id to run else null
        }.maxByOrNull { (_, run) -> run.optLong("expires") }
        edit.apply()

        if (!background || latest == null || !manager.canPostPromotedNotifications() ||
            !manager.areNotificationsEnabled()) {
            manager.cancel(TAG, 0)
            return
        }
        val (id, run) = latest
        if (manager.activeNotifications.any { it.tag == TAG && it.notification.extras.getString(RUN_ID) == id }) return
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Working", NotificationManager.IMPORTANCE_LOW))
        val deleteIntent = Intent(context, WorkingNotificationDismissed::class.java)
            .setData(android.net.Uri.parse("athena-working://run/$id"))
            .putExtra(EXPIRES_AT, run.getLong("expires"))
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_athena)
            .setContentTitle("Hermes is working")
            .setShortCriticalText("Working")
            .setStyle(Notification.ProgressStyle().setProgressIndeterminate(true))
            .setOngoing(true)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(NativeNotifications.conversationIntent(context, run.getString("target")))
            .setDeleteIntent(PendingIntent.getBroadcast(context, 0, deleteIntent, PendingIntent.FLAG_IMMUTABLE))
            .setTimeoutAfter(run.getLong("expires") - now)
            .addExtras(Bundle().apply {
                // The public field was added in SDK 36.1. Use its documented key with compileSdk 36.
                putBoolean("android.requestPromotedOngoing", true)
                putString(RUN_ID, id)
            }).build()
        try { manager.notify(TAG, 0, notification) }
        catch (_: SecurityException) { /* Android can revoke notification permission during delivery. */ }
    }
}

class WorkingNotificationDismissed : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = WorkingNotification.dismiss(context, intent)
}
