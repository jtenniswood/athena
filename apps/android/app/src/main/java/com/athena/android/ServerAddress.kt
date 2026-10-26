package com.athena.android

import java.net.URI

/** Athena serves its app, API and sign-in routes at the HTTPS origin root. */
object ServerAddress {
    fun normalize(input: String): String {
        val uri = URI(input.trim())
        require(uri.scheme == "https" && !uri.host.isNullOrEmpty()) { "Enter a complete HTTPS address." }
        require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            (uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")) { "Use the Athena server address without a path, query, or credentials." }
        require(uri.port == -1 || uri.port in 1..65535) { "Invalid server port." }
        return URI("https", null, uri.host.lowercase(), if (uri.port == 443) -1 else uri.port, null, null, null).toASCIIString()
    }

    fun belongsTo(url: String?, origin: String): Boolean = try {
        val uri = URI(url ?: "")
        uri.rawUserInfo == null && normalize("${uri.scheme}://${uri.rawAuthority}") == origin
    } catch (_: Exception) { false }

    fun conversationUrl(origin: String, sessionId: String?): String {
        val hash = sessionId?.takeIf { it.isNotBlank() }?.let {
            "/" + java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20")
        } ?: ""
        return "$origin/#$hash"
    }
}
