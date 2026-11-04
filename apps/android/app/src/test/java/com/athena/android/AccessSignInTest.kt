package com.athena.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.ActivityNotFoundException
import android.os.Bundle
import android.net.Uri
import android.util.Base64
import android.webkit.CookieManager
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowDialog
import org.robolectric.annotation.Config
import java.security.KeyPairGenerator
import java.security.KeyFactory
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class AccessSignInTest {
    private val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    private val prefs = activity.getSharedPreferences("access-sign-in", Context.MODE_PRIVATE)
    private val origin = "https://athena.example.com"
    private val time = 1800000000000L
    private val state = "x".repeat(43)
    private val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private val token = "e30.${encode("{\"exp\":1800003600}".toByteArray())}.signature"

    private fun pending() {
        prefs.edit().putString("origin", origin).putString("state", state)
            .putString("private", encode(pair.private.encoded)).putLong("started", time).commit()
    }
    private fun response(responseState: String = state, publicKey: PublicKey = pair.public, created: Long = time, responseToken: String = token): Uri {
        val key = ByteArray(32) { it.toByte() }; val iv = ByteArray(12) { (it + 10).toByte() }
        val body = JSONObject().put("origin", origin).put("state", responseState).put("created", created).put("token", responseToken)
        val rsa = Cipher.getInstance("RSA/ECB/OAEPPadding")
        rsa.init(Cipher.ENCRYPT_MODE, publicKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT))
        val aes = Cipher.getInstance("AES/GCM/NoPadding")
        aes.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        return Uri.parse("athena-android://access#" + encode(rsa.doFinal(key) + iv + aes.doFinal(body.toString().toByteArray())))
    }

    @Test fun startsBrowserImmediatelyWithStoredCallbackCredentials() {
        var status = ""
        val signIn = AccessSignIn(activity, { time }, { code, _ -> status = code }) {}
        signIn.start(origin)

        val intent = shadowOf(activity).nextStartedActivity
        assertNotNull(intent)
        assertEquals(Intent.ACTION_VIEW, intent.action)
        val uri = intent.data!!
        assertEquals("$origin/api/athena/android/auth/access", uri.buildUpon().clearQuery().build().toString())
        assertEquals(origin, prefs.getString("origin", null))
        assertEquals(prefs.getString("state", null), uri.getQueryParameter("state"))
        assertEquals(43, uri.getQueryParameter("state")!!.length)
        assertFalse(uri.getQueryParameter("key").isNullOrEmpty())
        assertTrue(prefs.contains("private"))
        assertEquals(time, prefs.getLong("started", 0))
        assertEquals("waiting", status)
        assertNull(ShadowDialog.getLatestDialog())

        signIn.close()
        assertTrue(prefs.contains("private"))
        signIn.cancel()
        assertTrue(prefs.all.isEmpty())
    }

    class NoBrowserActivity : Activity() {
        override fun startActivity(intent: Intent, options: Bundle?) {
            throw ActivityNotFoundException("No browser")
        }
    }

    @Test fun failedBrowserLaunchClearsCredentialsAndReportsRecovery() {
        val host = Robolectric.buildActivity(NoBrowserActivity::class.java).setup().get()
        var status = ""
        AccessSignIn(host, { time }, { code, _ -> status = code }) {}.start(origin)
        assertEquals("auth-browser", status)
        assertTrue(prefs.all.isEmpty())
    }

    @Test fun importsOnlyMatchingUnexpiredRequestAndConsumesItOnce() {
        pending()
        val callback = response()
        val signIn = AccessSignIn(activity, { time }) {}
        assertTrue(signIn.receive(callback, origin))
        assertFalse(prefs.contains("private"))
        assertTrue(CookieManager.getInstance().getCookie(origin).contains("CF_Authorization=$token"))
        CookieManager.getInstance().setCookie(origin, "CF_Authorization=; Max-Age=0")
        signIn.receive(callback, origin)
        assertFalse(CookieManager.getInstance().getCookie(origin)?.contains(token) == true)
    }

    @Test fun authTabResultUsesTheSameVerifiedCookieHandoff() {
        activity.getSharedPreferences("athena", Context.MODE_PRIVATE).edit().putString("origin", origin).commit()
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val host = controller.get()
        try {
            val connection = MainActivity::class.java.getDeclaredField("connection").apply { isAccessible = true }.get(host) as ConnectionCoordinator
            connection.recover("auth-access-required", "Sign in through Cloudflare Access to reconnect to Athena.")
            host.findViewById<android.view.View>(R.id.reconnect).performClick()
            val browser = shadowOf(host).nextStartedActivity
            val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.decode(browser.data!!.getQueryParameter("key"), Base64.URL_SAFE)))
            val now = System.currentTimeMillis()
            val currentToken = "e30.${encode("{\"exp\":${now / 1000 + 3600}}".toByteArray())}.signature"
            val callback = response(browser.data!!.getQueryParameter("state")!!, publicKey, now, currentToken)
            shadowOf(host).receiveResult(browser, Activity.RESULT_OK, Intent().setData(callback))
            assertFalse(prefs.contains("private"))
            assertTrue(CookieManager.getInstance().getCookie(origin).contains("CF_Authorization=$currentToken"))
        } finally { controller.pause().stop().destroy() }
    }

    @Test fun rejectsDifferentStateServerExpiredAndTamperedCallbacks() {
        val signIn = AccessSignIn(activity, { time }) {}
        pending(); signIn.receive(response("other-state"), origin)
        assertTrue(prefs.contains("private"))
        signIn.receive(response(), "https://other.example.com")
        assertTrue(prefs.contains("private"))
        AccessSignIn(activity, { time + 300001 }) {}.receive(response(), origin)
        assertTrue(prefs.contains("private"))
        signIn.receive(Uri.parse(response().toString().dropLast(20) + "a".repeat(20)), origin)
        assertTrue(prefs.contains("private"))
        assertFalse(signIn.receive(Uri.parse("https://attacker.example/access"), origin))
        assertFalse(CookieManager.getInstance().getCookie(origin)?.contains(token) == true)
    }
}
