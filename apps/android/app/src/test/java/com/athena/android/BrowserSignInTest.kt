package com.athena.android

import android.app.Activity
import android.content.Context
import android.os.Looper
import android.webkit.CookieManager
import androidx.appcompat.app.AlertDialog
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class BrowserSignInTest {
    private val origin = "https://athena.example"
    private fun activity(): Activity {
        val controller = Robolectric.buildActivity(Activity::class.java)
        controller.get().setTheme(R.style.AppTheme)
        return controller.setup().get().also {
            it.getSharedPreferences("athena", Context.MODE_PRIVATE).edit().putString("origin", origin).commit()
        }
    }
    private class Response(private val body: String = "{}", private val cookies: List<String> = emptyList()) : HttpURLConnection(URL("https://athena.example")) {
        val request = ByteArrayOutputStream()
        override fun connect() {}
        override fun disconnect() {}
        override fun usingProxy() = false
        override fun getOutputStream() = request
        override fun getResponseCode() = 200
        override fun getInputStream() = ByteArrayInputStream(body.toByteArray())
        override fun getHeaderFields(): Map<String, List<String>> = mapOf("Set-Cookie" to cookies)
    }
    private fun until(check: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 4000
        while (!check()) {
            shadowOf(Looper.getMainLooper()).idle()
            check(System.currentTimeMillis() < deadline) { "Browser sign-in did not settle" }
            Thread.sleep(10)
        }
    }

    @Test fun pendingExchangeSurvivesHostClosureAndImportsCookiesIntoTheNewHost() {
        val old = activity()
        val prefs = old.getSharedPreferences("android-sign-in", Context.MODE_PRIVATE)
        prefs.edit().putString("origin", origin).putString("id", "pending-request").putString("verifier", "v".repeat(43))
            .putLong("started", System.currentTimeMillis()).commit()
        BrowserSignIn(old) {}.close()
        assertEquals("pending-request", prefs.getString("id", null))
        val next = activity()
        var connected = false
        val response = Response(cookies = listOf("hermes_session_at=imported; Path=/; Secure; HttpOnly"))
        val signIn = BrowserSignIn(next, open = { url -> assertEquals("$origin/api/athena/android/auth/exchange", url.toString()); response }) { connected = true }
        signIn.resume(origin)
        until { connected }
        assertFalse(prefs.contains("verifier"))
        assertTrue(CookieManager.getInstance().getCookie(origin).contains("hermes_session_at=imported"))
        assertTrue(response.request.toString().contains("pending-request"))
        signIn.close()
    }

    @Test fun expiredExchangeIsClearedWithoutSendingCredentials() {
        val host = activity()
        val prefs = host.getSharedPreferences("android-sign-in", Context.MODE_PRIVATE)
        prefs.edit().putString("origin", origin).putString("id", "expired").putString("verifier", "private")
            .putLong("started", System.currentTimeMillis() - 300001).commit()
        var status = ""
        val signIn = BrowserSignIn(host, { code, _ -> status = code }, open = { error("Must not contact the server") }) {}
        signIn.resume(origin)
        assertEquals("auth-expired", status)
        assertFalse(prefs.contains("verifier"))
        signIn.close()
    }

    @Test fun cancellingTheBrowserPromptInvalidatesItsPendingVerifier() {
        val host = activity()
        var status = ""
        val response = Response("""{"id":"pending","loginPath":"/login"}""")
        val signIn = BrowserSignIn(host, { code, _ -> status = code }, open = { response }) {}
        signIn.start(origin, "/login")
        until { ShadowDialog.getLatestDialog()?.isShowing == true }
        val dialog = ShadowDialog.getLatestDialog() as AlertDialog
        assertEquals(origin, dialog.findViewById<android.widget.TextView>(R.id.sign_in_server)!!.text.toString())
        dialog.getButton(AlertDialog.BUTTON_NEGATIVE).performClick()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("auth-cancelled", status)
        assertFalse(host.getSharedPreferences("android-sign-in", Context.MODE_PRIVATE).contains("verifier"))
        signIn.close()
    }
}
