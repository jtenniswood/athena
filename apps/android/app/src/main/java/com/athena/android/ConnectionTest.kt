package com.athena.android

import android.webkit.WebResourceResponse

/** Temporary WebView fixtures; never persisted as the user's server configuration. */
enum class ConnectionTest(val title: String) {
    UNAVAILABLE("Server unavailable"),
    HTTP_ERROR("Server returns HTTP 503"),
    WRONG_SERVER("Wrong server / Athena missing"),
    UNSUPPORTED_PROTOCOL("Incompatible server integration");

    companion object { const val ORIGIN = "https://athena-connection-test.invalid" }

    fun response(): WebResourceResponse? {
        // A reserved .invalid hostname exercises the real network-error callback.
        if (this == UNAVAILABLE) return null
        val document = when (this) {
            UNSUPPORTED_PROTOCOL -> """<!doctype html><html><body><script>
                window.AthenaAndroid.postMessage(JSON.stringify({id:'connection-test',method:'hello',payload:{protocol:999}}));
                </script></body></html>"""
            else -> "<!doctype html><html><body><h1>Connection test</h1><p>This server does not provide Athena.</p></body></html>"
        }
        return WebResourceResponse("text/html", "UTF-8", if (this == HTTP_ERROR) 503 else 200,
            if (this == HTTP_ERROR) "Service Unavailable" else "OK",
            mapOf("Cache-Control" to "no-store"), document.byteInputStream())
    }
}
