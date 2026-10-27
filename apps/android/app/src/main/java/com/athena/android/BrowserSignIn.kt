package com.athena.android

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.net.Uri
import android.util.Base64
import android.webkit.CookieManager
import android.widget.Toast
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.Executors

/** A one-use PKCE handoff keeps OAuth in the browser and credentials out of URLs and JavaScript. */
class BrowserSignIn(private val activity: Activity, private val connected: () -> Unit) {
    private val prefs = activity.getSharedPreferences("android-sign-in", Context.MODE_PRIVATE)
    private val executor = Executors.newSingleThreadExecutor()
    private var exchanging = false

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    fun close() { executor.shutdownNow() }
    private fun post(origin: String, route: String, body: JSONObject): Pair<Int, HttpURLConnection> {
        val connection = URL(origin + route).openConnection() as HttpURLConnection
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
        executor.execute {
            try {
                val verifier = encode(ByteArray(32).also { SecureRandom().nextBytes(it) })
                val challenge = encode(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8)))
                val (status, response) = post(origin, "/api/athena/android/auth/start", JSONObject().put("challenge", challenge).put("loginPath", loginPath))
                val body = try { response.inputStream.bufferedReader().use { JSONObject(it.readText()) } } finally { response.disconnect() }
                require(status == 200)
                val id = body.getString("id"); val path = body.getString("loginPath")
                require(ServerAddress.belongsTo(origin + path, origin) && path.startsWith("/"))
                prefs.edit().putString("origin", origin).putString("id", id).putString("verifier", verifier)
                    .putLong("started", System.currentTimeMillis()).apply()
                activity.runOnUiThread {
                    if (!activity.isFinishing && !activity.isDestroyed) {
                        AlertDialog.Builder(activity).setTitle("Sign in to Athena")
                            .setMessage("Check that the browser shows code ${body.getString("code")}. This moves that browser’s Athena sign-in to this app. After approving, return here.")
                            .setNegativeButton("Cancel") { _, _ -> prefs.edit().clear().apply(); started(false) }
                            .setOnCancelListener { prefs.edit().clear().apply(); started(false) }
                            .setPositiveButton("Open browser") { _, _ ->
                                try { CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(origin + path)); started(true) }
                                catch (_: Exception) { prefs.edit().clear().apply(); started(false) }
                            }.show()
                    }
                }
            } catch (_: Exception) {
                activity.runOnUiThread {
                    started(false)
                    if (!activity.isDestroyed) Toast.makeText(activity, "Browser sign-in could not start. Update the Athena server, or use a session token.", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    fun resume(origin: String) {
        if (exchanging || prefs.getString("origin", "") != origin) return
        if (System.currentTimeMillis() - prefs.getLong("started", 0) > 300000) { prefs.edit().clear().apply(); return }
        val id = prefs.getString("id", null) ?: return
        val verifier = prefs.getString("verifier", null) ?: return
        exchanging = true
        executor.execute {
            try {
                val (status, response) = post(origin, "/api/athena/android/auth/exchange", JSONObject().put("id", id).put("verifier", verifier))
                val cookies = try { response.headerFields.filterKeys { it?.equals("Set-Cookie", true) == true }.values.flatten() } finally { response.disconnect() }
                if (status == 200) {
                    activity.runOnUiThread {
                        if (activity.isDestroyed) return@runOnUiThread
                        val manager = CookieManager.getInstance()
                        var remaining = cookies.size
                        if (remaining == 0) return@runOnUiThread
                        for (cookie in cookies) manager.setCookie(origin, cookie) {
                            remaining--
                            if (remaining == 0) {
                                manager.flush(); prefs.edit().clear().apply(); connected()
                            }
                        }
                    }
                } else if (status == 202) activity.runOnUiThread {
                    activity.window.decorView.postDelayed({ if (!activity.isDestroyed && MainActivity.foreground) resume(origin) }, 1000)
                } else prefs.edit().clear().apply()
            } catch (_: Exception) { /* A network interruption can be retried on the next resume. */ }
            finally { activity.runOnUiThread { exchanging = false } }
        }
    }
}
