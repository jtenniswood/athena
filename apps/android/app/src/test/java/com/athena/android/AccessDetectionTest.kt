package com.athena.android

import org.junit.Assert.*
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

class AccessDetectionTest {
    private val origin = "https://athena.example"
    private class Response(private val status: Int, private val location: String? = null, private val body: String = "") : HttpURLConnection(URL("https://athena.example/")) {
        var disconnected = false
        override fun connect() {}
        override fun disconnect() { disconnected = true }
        override fun usingProxy() = false
        override fun getResponseCode() = status
        override fun getHeaderField(name: String) = when (name.lowercase()) {
            "location" -> location
            "content-type" -> "text/html; charset=utf-8"
            else -> null
        }
        override fun getInputStream() = body.byteInputStream()
        override fun getErrorStream() = body.byteInputStream()
    }

    @Test fun loginRedirectsMustBelongToTheServerOrCloudflareAccess() {
        assertTrue(AccessDetection.loginUrl("$origin/cdn-cgi/access/login", origin))
        assertTrue(AccessDetection.loginUrl("https://team.cloudflareaccess.com/cdn-cgi/access/login", origin))
        for (url in listOf("http://team.cloudflareaccess.com/cdn-cgi/access/login",
            "https://cloudflareaccess.com.evil.example/cdn-cgi/access/login", "https://evil.example/cdn-cgi/access/login",
            "https://user@team.cloudflareaccess.com/cdn-cgi/access/login", "$origin/login", "not a URL")) {
            assertFalse(url, AccessDetection.loginUrl(url, origin))
        }
    }

    @Test fun expiredAccessIsDetectedWithoutForwardingCookiesThroughRedirects() {
        for (location in listOf("/cdn-cgi/access/login", "https://team.cloudflareaccess.com/cdn-cgi/access/login")) {
            val response = Response(302, location)
            assertTrue(AccessDetection.required(origin, "CF_Authorization=expired") { url ->
                assertEquals("$origin/", url.toString())
                response
            })
            assertFalse(response.instanceFollowRedirects)
            assertEquals("CF_Authorization=expired", response.getRequestProperty("Cookie"))
            assertEquals(5000, response.connectTimeout)
            assertEquals(5000, response.readTimeout)
            assertTrue(response.disconnected)
        }
    }

    @Test fun accessPagesAreRecognisedButGenericForbiddenAndServerFailuresAreNot() {
        for (status in listOf(200, 401, 403)) {
            assertTrue(AccessDetection.required(origin, null) { Response(status, body = "<title>Sign in · Cloudflare Access</title>") })
        }
        for (status in listOf(200, 401, 403, 503)) {
            val response = Response(status, body = "<title>Cloudflare</title><p>Forbidden</p>")
            assertFalse(AccessDetection.required(origin, null) { response })
            assertTrue(response.disconnected)
        }
        assertFalse(AccessDetection.required(origin, null) { Response(302, "https://evil.example/cdn-cgi/access/login") })
        assertFalse(AccessDetection.required(origin, null) { Response(302, "$origin/login") })
    }

    @Test fun brokenProbeDisconnectsAndDoesNotConsumeAnUnlimitedResponse() {
        val broken = object : HttpURLConnection(URL("$origin/")) {
            var disconnected = false
            override fun connect() {}
            override fun disconnect() { disconnected = true }
            override fun usingProxy() = false
            override fun getResponseCode(): Int = throw java.io.IOException("offline")
        }
        assertThrows(java.io.IOException::class.java) { AccessDetection.required(origin, null) { broken } }
        assertTrue(broken.disconnected)
        assertFalse(AccessDetection.required(origin, null) {
            Response(403, body = "x".repeat(65536) + "<title>Cloudflare Access</title>")
        })
    }
}
