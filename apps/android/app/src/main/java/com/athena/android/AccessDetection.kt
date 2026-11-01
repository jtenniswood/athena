package com.athena.android

import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** A Cloudflare proxy error alone does not establish that Access sign-in is needed. */
object AccessDetection {
    fun loginUrl(value: String?, origin: String): Boolean = try {
        val uri = URI(value ?: "")
        uri.scheme == "https" && uri.rawUserInfo == null &&
            (ServerAddress.belongsTo(value, origin) || uri.host?.endsWith(".cloudflareaccess.com") == true) &&
            uri.path.orEmpty().startsWith("/cdn-cgi/access/")
    } catch (_: Exception) { false }

    fun required(origin: String, cookies: String?, open: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection }): Boolean {
        val connection = open(URL("$origin/"))
        return try {
            // Never forward WebView cookies to a redirected host or store probe responses as a session.
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5000; connection.readTimeout = 5000
            connection.setRequestProperty("Accept", "text/html")
            connection.setRequestProperty("Cache-Control", "no-cache")
            cookies?.let { connection.setRequestProperty("Cookie", it) }
            val status = connection.responseCode
            val location = connection.getHeaderField("Location")?.let { URI("$origin/").resolve(it).toString() }
            if (status in 300..399 && loginUrl(location, origin)) true
            else if (status in listOf(200, 401, 403) && connection.contentType.orEmpty().startsWith("text/html", true)) {
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                val html = stream?.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (output.size() < 65536) {
                        val count = input.read(buffer, 0, minOf(buffer.size, 65536 - output.size()))
                        if (count < 0) break
                        output.write(buffer, 0, count)
                    }
                    output.toString("UTF-8")
                }.orEmpty()
                Regex("<title[^>]*>[^<]*Cloudflare Access[^<]*</title>", RegexOption.IGNORE_CASE).containsMatchIn(html)
            } else false
        } finally { connection.disconnect() }
    }
}
