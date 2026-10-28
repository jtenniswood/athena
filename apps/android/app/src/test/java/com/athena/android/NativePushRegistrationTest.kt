package com.athena.android

import android.content.Context
import android.webkit.CookieManager
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativePushRegistrationTest {
    private class Response(private val json: Boolean) : HttpURLConnection(URL("https://athena.example")) {
        val body = ByteArrayOutputStream()
        override fun connect() {}
        override fun disconnect() {}
        override fun usingProxy() = false
        override fun getOutputStream() = body
        override fun getResponseCode() = 200
        override fun getContentType() = if (json) "application/json" else "text/html"
        override fun getInputStream() = ByteArrayInputStream("{\"ok\":true}".toByteArray())
    }
    private fun verifyRefresh(json: Boolean) {
        val context = RuntimeEnvironment.getApplication()
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        prefs.edit().putString("origin", "https://athena.example").putString("pushToken", "rotated-token")
            .putString("pushSyncedToken", "old-token").putString("pushRefreshKey", "k".repeat(43))
            .putBoolean("pushVersioned", true).putString("deviceId", "installation").putString("pushBinding", "account-binding").putBoolean("pushEnabled", true).commit()
        CookieManager.getInstance().setCookie("https://athena.example", "CF_Authorization=access-cookie")
        CookieManager.getInstance().setCookie("https://athena.example", "hermes_session_at=private-session")
        val response = Response(json)
        NativePushRegistration(context) { url ->
            assertEquals("https://athena.example/api/athena/android/push/token", url.toString())
            response
        }.schedule()
        val deadline = System.currentTimeMillis() + 4000
        while (prefs.getString("pushSyncStatus", "") == "Token refresh pending") {
            check(System.currentTimeMillis() < deadline) { "Token sync did not finish" }
            Thread.sleep(10)
        }
        assertEquals(if (json) "rotated-token" else "old-token", prefs.getString("pushSyncedToken", ""))
        assertEquals("POST", response.requestMethod)
        assertFalse(response.instanceFollowRedirects)
        assertEquals("CF_Authorization=access-cookie", response.getRequestProperty("Cookie"))
        assertFalse(response.body.toString().contains("private-session"))
        val body = JSONObject(response.body.toString())
        assertEquals("rotated-token", body.getString("token"))
        assertEquals("account-binding", body.getString("bindingId"))
        assertEquals(0L, body.getLong("tokenVersion"))
    }
    @Test fun tokenRotationUsesOnlyTheScopedCredentialAndAccessCookie() = verifyRefresh(true)
    @Test fun aSuccessfulHtmlLoginPageCannotBeMistakenForARegisteredToken() = verifyRefresh(false)
    @Test fun staleSdkResultsAndAcknowledgementsCannotReplaceANewerNativeToken() {
        val context = RuntimeEnvironment.getApplication()
        val prefs = context.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val manager = NativePushRegistration(context)
        val first = manager.recordToken("token-one")
        val second = manager.recordToken("token-two")
        assertTrue(second > first)
        val late = manager.registration("token-one", first)
        assertEquals("token-two", late.getString("token"))
        assertEquals(second, late.getLong("tokenVersion"))
        manager.acknowledged("token-one", first)
        assertNotEquals("token-one", prefs.getString("pushSyncedToken", null))
        manager.acknowledged("token-two", second)
        assertEquals("token-two", prefs.getString("pushSyncedToken", null))
    }

}
