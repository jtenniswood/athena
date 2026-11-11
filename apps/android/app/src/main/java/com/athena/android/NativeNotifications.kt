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
    private val notifiedChats = context.getSharedPreferences("notified-chats", Context.MODE_PRIVATE)

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
        val sessionId = (payload.opt("focusSessionId") as? String).orEmpty()
        val kind = payload.optString("kind")
        val chatKeys = if (sessionId.isNotBlank() && (kind == "turnDone" || kind == "turnError")) {
            val aliases = payload.optJSONArray("chatAliases")
            val ids = listOf(sessionId) + (0 until (aliases?.length() ?: 0)).mapNotNull { aliases?.opt(it) as? String }
            ids.filter { it.isNotBlank() }.distinct().map { ServerAddress.conversationUrl(origin, it) }
        } else emptyList()
        if (chatKeys.any(notifiedChats::contains)) {
            // The WebView can link compression aliases after a Firebase alert arrives.
            rememberChats(chatKeys)
            return@synchronized true
        }
        val channel = if (payload.optBoolean("silent")) "silent" else "responses"
        if (manager.getNotificationChannel(channel)?.importance == NotificationManager.IMPORTANCE_NONE) return@synchronized false
        val tag = payload.optString("tag").take(256).ifBlank { "athena" }
        val target = ServerAddress.conversationUrl(origin, sessionId, payload.optString("focusProfile"))
        val intent = Intent(context, MainActivity::class.java)
            .setAction("com.athena.android.OPEN_CONVERSATION")
            .setData(android.net.Uri.parse(target))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val title = (payload.opt("chatTitle") as? String).orEmpty().trim().ifBlank {
            if (kind == "turnDone") "Athena · Response ready" else payload.optString("title", "Athena")
        }
        val notification = Notification.Builder(context, channel)
            .setSmallIcon(com.athena.android.R.drawable.ic_athena)
            .setContentTitle(title.take(200))
            .setContentText(payload.optString("body").take(2000))
            .setStyle(Notification.BigTextStyle().bigText(payload.optString("body").take(2000)))
            .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        try { manager.notify(tag, 0, notification) } catch (_: SecurityException) { return@synchronized false }
        rememberChats(chatKeys)
        if (event.isNotEmpty()) prefs.edit().putStringSet("pushReceipts", (receipts.toList().takeLast(199) + event).toSet()).apply()
        return@synchronized true
    }

    private fun rememberChats(keys: List<String>) {
        val unseen = keys.filterNot(notifiedChats::contains)
        if (unseen.isEmpty()) return
        val edit = notifiedChats.edit()
        for (key in unseen) edit.putBoolean(key, true)
        edit.apply()
    }
}
