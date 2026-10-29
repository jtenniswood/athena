package com.athena.android

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.util.Base64
import android.webkit.CookieManager
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors

/** A one-use PKCE handoff keeps OAuth in the browser and credentials out of URLs and JavaScript. */
class BrowserSignIn(
    private val activity: Activity,
    private val progress: (String, String) -> Unit = { _, _ -> },
    private val open: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
    private val connected: () -> Unit
) {
    private val prefs = activity.getSharedPreferences("android-sign-in", Context.MODE_PRIVATE)
    private val executor = Executors.newSingleThreadExecutor()
    private var exchanging = false
    private var generation = 0
    private var confirmation: androidx.appcompat.app.AlertDialog? = null
    private fun active(origin: String, request: Int) = !activity.isDestroyed && request == generation &&
        activity.getSharedPreferences("athena", Context.MODE_PRIVATE).getString("origin", "") == origin
    fun cancel() { generation++; confirmation?.dismiss(); confirmation = null; prefs.edit().clear().apply() }
    private fun report(code: String, message: String) {
        if (!activity.isDestroyed) progress(code, message)
    }

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    fun close() { generation++; confirmation?.dismiss(); executor.shutdownNow() }
    private fun post(origin: String, route: String, body: JSONObject): Pair<Int, HttpURLConnection> {
        val connection = open(URL(origin + route))
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 10000; connection.readTimeout = 10000
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Origin", origin)
        CookieManager.getInstance().getCookie(origin)?.let { connection.setRequestProperty("Cookie", it) }
        connection.doOutput = true
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        return connection.responseCode to connection
    }

    fun start(origin: String, loginPath: String, started: (Boolean) -> Unit = {}) {
        cancel()
        val request = generation
        executor.execute {
            try {
                val verifier = encode(ByteArray(32).also { SecureRandom().nextBytes(it) })
                val challenge = encode(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8)))
                val (status, response) = post(origin, "/api/athena/android/auth/start", JSONObject().put("challenge", challenge).put("loginPath", loginPath))
                val body = try { response.inputStream.bufferedReader().use { JSONObject(it.readText()) } } finally { response.disconnect() }
                require(status == 200)
                val id = body.getString("id"); val path = body.getString("loginPath")
                require(ServerAddress.belongsTo(origin + path, origin) && path.startsWith("/"))
                activity.runOnUiThread {
                    if (!activity.isFinishing && active(origin, request)) {
                        prefs.edit().putString("origin", origin).putString("id", id).putString("verifier", verifier)
                            .putLong("started", System.currentTimeMillis()).apply()
                        fun cancelled() { if (!active(origin, request)) return; cancel(); report("auth-cancelled", "Sign-in cancelled. Choose Try again when you’re ready."); started(false) }
                        confirmation = SignInConfirmation.builder(activity, origin, body.getString("code"))
                            .setNegativeButton(R.string.cancel) { _, _ -> cancelled() }
                            .setOnCancelListener { cancelled() }
                            .setPositiveButton(R.string.open_browser) { _, _ ->
                                if (!active(origin, request)) return@setPositiveButton
                                try { CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(origin + path)); report("waiting", ""); started(true) }
                                catch (_: Exception) { cancel(); report("auth-browser", "No browser could open sign-in. Choose Try again to retry."); started(false) }
                            }.show()
                    }
                }
            } catch (_: Exception) {
                activity.runOnUiThread {
                    if (active(origin, request)) {
                        report("auth-start", "Browser sign-in could not start. Check the connection and update the Athena server, then choose Try again.")
                        started(false)
                    }
                }
            }
        }
    }

    fun resume(origin: String) {
        if (exchanging || prefs.getString("origin", "") != origin) return
        if (System.currentTimeMillis() - prefs.getLong("started", 0) !in 0..300000) {
            cancel(); report("auth-expired", "Sign-in expired. Choose Try again to start again."); return
        }
        val id = prefs.getString("id", null) ?: return
        val verifier = prefs.getString("verifier", null) ?: return
        exchanging = true
        val request = generation
        report("waiting", "")
        executor.execute {
            try {
                val (status, response) = post(origin, "/api/athena/android/auth/exchange", JSONObject().put("id", id).put("verifier", verifier))
                val cookies = try { response.headerFields.filterKeys { it?.equals("Set-Cookie", true) == true }.values.flatten() } finally { response.disconnect() }
                if (status == 200) {
                    activity.runOnUiThread {
                        if (!active(origin, request)) return@runOnUiThread
                        val manager = CookieManager.getInstance()
                        var remaining = cookies.size
                        if (remaining == 0) {
                            cancel(); report("auth-cookies", "The server returned no sign-in session. Update Athena and try again.")
                            return@runOnUiThread
                        }
                        for (cookie in cookies) manager.setCookie(origin, cookie) {
                            remaining--
                            if (remaining == 0 && active(origin, request)) {
                                manager.flush(); prefs.edit().clear().apply(); report("connected", ""); connected()
                            }
                        }
                    }
                } else if (status == 202) activity.runOnUiThread {
                    activity.window.decorView.postDelayed({ if (active(origin, request) && MainActivity.foreground) resume(origin) }, 1000)
                } else activity.runOnUiThread {
                    if (active(origin, request)) {
                        cancel(); report("auth-exchange", "Sign-in expired or the server restarted. Choose Try again to start again.")
                    }
                }
            } catch (_: Exception) {
                activity.runOnUiThread {
                    if (active(origin, request)) report("auth-network", "Could not finish sign-in. Check your connection, then return to Athena or choose Try again.")
                }
            }
            finally { activity.runOnUiThread { exchanging = false } }
        }
    }
}
