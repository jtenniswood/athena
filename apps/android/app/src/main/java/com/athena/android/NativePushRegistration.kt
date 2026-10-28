package com.athena.android

import android.content.Context
import android.util.Base64
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.Executors

/** This credential can only rotate one device's FCM token; it cannot read chats or change preferences. */
class NativePushRegistration(context: Context, private val open: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }) {
    private val prefs = context.applicationContext.getSharedPreferences("athena", Context.MODE_PRIVATE)
    companion object { private val executor = Executors.newSingleThreadExecutor() }

    fun refreshKey(): String = synchronized(NativePushRegistration::class.java) {
        prefs.getString("pushRefreshKey", null) ?: Base64.encodeToString(
            ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        ).also { prefs.edit().putString("pushRefreshKey", it).apply() }
    }

    fun schedule() {
        if (!prefs.getBoolean("pushEnabled", false)) return
        val token = prefs.getString("pushToken", null) ?: return
        if (token == prefs.getString("pushSyncedToken", null)) return
        val origin = prefs.getString("origin", null) ?: return
        val key = prefs.getString("pushRefreshKey", null) ?: return
        val device = prefs.getString("deviceId", null) ?: return
        val binding = prefs.getString("pushBinding", null) ?: return
        prefs.edit().putString("pushSyncStatus", "Token refresh pending").apply()
        // CookieManager is read on the main thread; only the Access cookie is needed for this scoped endpoint.
        val cookies = CookieManager.getInstance().getCookie(origin)?.split(';')
            ?.map { it.trim() }?.firstOrNull { it.startsWith("CF_Authorization=") }
        executor.execute {
            if (prefs.getString("origin", null) != origin || prefs.getString("pushBinding", null) != binding) return@execute
            var connection: HttpURLConnection? = null
            try {
                require(ServerAddress.normalize(origin) == origin)
                connection = open(URL("$origin/api/athena/android/push/token"))
                connection.requestMethod = "POST"
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 6000; connection.readTimeout = 6000
                connection.setRequestProperty("Origin", origin)
                connection.setRequestProperty("Content-Type", "application/json")
                if (cookies != null) connection.setRequestProperty("Cookie", cookies)
                connection.doOutput = true
                val body = JSONObject().put("deviceId", device).put("bindingId", binding)
                    .put("refreshKey", key).put("token", token)
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val ok = connection.responseCode == 200 && connection.contentType?.startsWith("application/json") == true &&
                    connection.inputStream.bufferedReader().use { reader ->
                        val response = StringBuilder()
                        val buffer = CharArray(512)
                        var count = reader.read(buffer)
                        while (count >= 0) {
                            require(response.length + count <= 4096)
                            response.append(buffer, 0, count)
                            count = reader.read(buffer)
                        }
                        JSONObject(response.toString()).optBoolean("ok")
                    }
                synchronized(NativePushRegistration::class.java) {
                    if (prefs.getString("origin", null) == origin && prefs.getString("pushBinding", null) == binding &&
                        prefs.getString("pushToken", null) == token && prefs.getBoolean("pushEnabled", false)) {
                        prefs.edit().apply {
                            if (ok) putString("pushSyncedToken", token)
                            putString("pushSyncStatus", if (ok) "Token registered" else "Open Athena to refresh registration")
                        }.apply()
                    }
                }
            } catch (_: Exception) {
                if (prefs.getString("origin", null) == origin && prefs.getString("pushBinding", null) == binding)
                    prefs.edit().putString("pushSyncStatus", "Waiting for connection; retries when Athena resumes").apply()
            } finally { connection?.disconnect() }
        }
    }
}
