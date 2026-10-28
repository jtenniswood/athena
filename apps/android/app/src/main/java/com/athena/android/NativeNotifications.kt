package com.athena.android

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject

class NativeNotifications(private val context: Context) {
    companion object { private val receiptsLock = Any() }
    private val manager = context.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(NotificationChannel("responses", "Responses and alerts", NotificationManager.IMPORTANCE_DEFAULT))
        manager.createNotificationChannel(NotificationChannel("silent", "Silent alerts", NotificationManager.IMPORTANCE_LOW))
    }

    fun permission(): String {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return if (context.getSharedPreferences("athena", Context.MODE_PRIVATE).getBoolean("notificationAsked", false)) "denied" else "default"
        }
        return if (manager.areNotificationsEnabled()) "granted" else "denied"
    }

    fun show(origin: String, payload: JSONObject): Boolean = synchronized(receiptsLock) {
        if (permission() != "granted") return@synchronized false
        val expires = payload.optString("expiresAt").toLongOrNull()
        if (expires != null && expires <= System.currentTimeMillis()) return@synchronized false
        val event = payload.optString("eventId")
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val receipts = prefs.getStringSet("pushReceipts", emptySet()) ?: emptySet()
        if (event.isNotEmpty() && event in receipts) return@synchronized true
        val tag = payload.optString("tag").take(256).ifBlank { "athena" }
        val target = ServerAddress.conversationUrl(origin, payload.optString("focusSessionId"))
        val intent = Intent(context, MainActivity::class.java)
            .setAction("com.athena.android.OPEN_CONVERSATION")
            .setData(android.net.Uri.parse(target))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val channel = if (payload.optBoolean("silent")) "silent" else "responses"
        val title = if (payload.optString("kind") == "turnDone") "Athena · Response ready" else payload.optString("title", "Athena")
        val notification = Notification.Builder(context, channel)
            .setSmallIcon(com.athena.android.R.drawable.ic_athena)
            .setContentTitle(title.take(200))
            .setContentText(payload.optString("body").take(2000))
            .setStyle(Notification.BigTextStyle().bigText(payload.optString("body").take(2000)))
            .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        try { manager.notify(tag, 0, notification) } catch (_: SecurityException) { return@synchronized false }
        if (event.isNotEmpty()) prefs.edit().putStringSet("pushReceipts", (receipts.toList().takeLast(199) + event).toSet()).apply()
        return@synchronized true
    }
}
