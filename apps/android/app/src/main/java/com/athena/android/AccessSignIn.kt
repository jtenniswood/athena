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
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/** Bootstrap Access in the browser without needing an unauthenticated server endpoint. */
class AccessSignIn(private val activity: Activity, private val now: () -> Long = System::currentTimeMillis, private val connected: () -> Unit) {
    private val prefs = activity.getSharedPreferences("access-sign-in", Context.MODE_PRIVATE)
    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private fun decode(text: String) = Base64.decode(text, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    fun start(origin: String) {
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val state = encode(ByteArray(32).also { SecureRandom().nextBytes(it) })
        val url = Uri.parse("$origin/api/athena/android/auth/access").buildUpon()
            .appendQueryParameter("state", state).appendQueryParameter("key", encode(pair.public.encoded)).build()
        AlertDialog.Builder(activity).setTitle("Sign in through Cloudflare Access")
            .setMessage("Sign in with Pocket ID in your browser, then check code ${state.take(6)} and server $origin before approving the app connection.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Open browser") { _, _ ->
                // Private app storage, excluded from backups. The short-lived key never leaves this device.
                prefs.edit().putString("origin", origin).putString("state", state)
                    .putString("private", encode(pair.private.encoded)).putLong("started", now()).apply()
                try { CustomTabsIntent.Builder().build().launchUrl(activity, url) }
                catch (_: Exception) { prefs.edit().clear().apply(); Toast.makeText(activity, "No browser could open Access sign-in.", Toast.LENGTH_LONG).show() }
            }.show()
    }

    fun receive(uri: Uri?, origin: String): Boolean {
        if (uri?.scheme != "athena-android" || uri.host != "access") return false
        try {
            require(uri.path.isNullOrEmpty() && uri.query == null)
            require(origin == prefs.getString("origin", null))
            val elapsed = now() - prefs.getLong("started", 0)
            require(elapsed in 0..300000)
            val encoded = uri.encodedFragment ?: error("Missing response")
            require(encoded.length in 400..30000)
            val envelope = decode(encoded)
            val privateKey = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(decode(prefs.getString("private", null) ?: error("No request"))))
            val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding")
            rsa.init(Cipher.DECRYPT_MODE, privateKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
            val key = rsa.doFinal(envelope.copyOfRange(0, 256))
            val aes = Cipher.getInstance("AES/GCM/NoPadding")
            aes.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, envelope.copyOfRange(256, 268)))
            val body = JSONObject(String(aes.doFinal(envelope.copyOfRange(268, envelope.size)), Charsets.UTF_8))
            require(body.getString("origin") == origin && body.getString("state") == prefs.getString("state", null))
            require(now() - body.getLong("created") in -60000..300000)
            val token = body.getString("token")
            require(Regex("[A-Za-z0-9_.-]{20,16000}").matches(token))
            val claims = JSONObject(String(decode(token.split('.')[1]), Charsets.UTF_8))
            val seconds = claims.getLong("exp") - now() / 1000
            require(seconds > 0)
            prefs.edit().clear().apply()
            CookieManager.getInstance().setCookie(origin, "CF_Authorization=$token; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds.coerceAtMost(2592000)}") {
                CookieManager.getInstance().flush(); connected()
            }
        } catch (_: Exception) {
            Toast.makeText(activity, "Access sign-in could not be verified. Start again from App settings.", Toast.LENGTH_LONG).show()
        }
        return true
    }
}
