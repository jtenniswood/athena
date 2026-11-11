package com.athena.android

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.net.Uri
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Downloads are untrusted until their identity, signature and checksum are verified. */
class AppUpdates(private val activity: AppCompatActivity, private val prepareInstall: (() -> Unit) -> Unit) {
    companion object {
        const val REPOSITORY = "https://github.com/jtenniswood/athena/releases/download/"
        private const val GITHUB_API = "https://api.github.com/repos/jtenniswood/athena"
        private val revisionPattern = Regex("[a-f0-9]{40}")
        fun assetUrl(value: String): Boolean = value.startsWith(REPOSITORY) &&
            Uri.parse(value).let { it.scheme == "https" && it.host == "github.com" && it.userInfo == null && it.fragment == null && it.query == null && !it.path.orEmpty().contains("..") }
        fun stableRelease(releases: JSONArray): JSONObject? = (0 until releases.length())
            .map { releases.getJSONObject(it) }.firstOrNull {
                !it.optBoolean("draft") && !it.optBoolean("prerelease") &&
                    Regex("android-v[0-9]+\\.[0-9]+\\.[0-9]+").matches(it.optString("tag_name"))
            }
        // The public release list does not reliably return latest-main builds in order.
        fun latestMainRelease(runs: JSONArray, releaseForTag: (String) -> JSONObject?): JSONObject? =
            (0 until runs.length()).map { runs.getJSONObject(it) }
                .sortedByDescending { it.getLong("run_number") }
                .asSequence()
                .map { it.optString("head_sha") }
                .filter(revisionPattern::matches)
                .distinct()
                .mapNotNull { revision ->
                    val tag = "android-main-$revision"
                    releaseForTag(tag)?.takeIf {
                        it.optString("tag_name") == tag && it.optBoolean("prerelease") && !it.optBoolean("draft")
                    }
                }
                .firstOrNull()
        fun validateMetadata(info: JSONObject, installedCode: Long) {
            require(info.getInt("schemaVersion") == 1 && info.getString("packageName") == "com.athena.android" && info.getBoolean("firebaseConfigured")) { "Invalid update metadata" }
            require(info.getLong("versionCode") > installedCode) { "This app is already up to date" }
            require(revisionPattern.matches(info.getString("revision")) && Regex("[a-f0-9]{64}").matches(info.getString("sha256"))) { "Invalid update identity" }
            require(info.getInt("minimumServerProtocol") <= 1 && info.getInt("bridgeProtocol") == 1) { "This update requires a newer server protocol" }
        }
        fun validateApk(info: JSONObject, packageName: String, version: String?, code: Long,
            hash: String, certificates: Set<String>, installedCertificates: Set<String>) {
            require(hash == info.getString("sha256")) { "APK checksum mismatch" }
            require(packageName == "com.athena.android" && code == info.getLong("versionCode") && version == info.getString("version")) { "APK identity mismatch" }
            require(certificates == installedCertificates && certificates == setOf(info.getString("signingCertificateSha256"))) { "APK signing certificate mismatch" }
        }
    }
    private val prefs = activity.getSharedPreferences("athena", 0)
    private val worker = Executors.newSingleThreadExecutor()
    private var busy = false
    @Volatile private var closed = false
    private var dialog: androidx.appcompat.app.AlertDialog? = null
    private val channel get() = prefs.getString("updateChannel", "stable") ?: "stable"
    private fun ui(action: () -> Unit) = activity.runOnUiThread { if (!closed && !activity.isFinishing && !activity.isDestroyed) action() }
    private fun message(value: String) = Toast.makeText(activity, value, Toast.LENGTH_LONG).show()

    fun settings() {
        if (busy) { message("An update check or download is already running."); return }
        val choices = arrayOf("Stable releases", "Latest main builds")
        var selected = if (channel == "main") 1 else 0
        dialog = MaterialAlertDialogBuilder(activity).setTitle("App updates")
            .setSingleChoiceItems(choices, selected) { _, index -> selected = index }
            .setNegativeButton("Cancel", null).setPositiveButton("Check for updates") { _, _ ->
                prefs.edit().putString("updateChannel", if (selected == 1) "main" else "stable").apply()
                check(true)
            }.show()
    }

    fun check(manual: Boolean = false) {
        if ((!manual && BuildConfig.DEBUG) || busy) return
        busy = true
        val requestedChannel = channel
        if (manual) message("Checking for updates…")
        worker.execute {
            try {
                val release = findRelease(requestedChannel)
                val assets = release?.getJSONArray("assets")
                fun asset(name: String): String = (0 until (assets?.length() ?: 0)).map { assets!!.getJSONObject(it) }
                    .first { it.getString("name") == name }.getString("browser_download_url").also { require(assetUrl(it)) }
                val metadata = if (release == null) null else JSONObject(read(asset("build-info.json")))
                val installed = BuildConfig.VERSION_CODE.toLong()
                val available = metadata != null && metadata.getLong("versionCode") > installed
                if (available) validateMetadata(metadata, installed)
                val apkUrl = if (available) asset(if (requestedChannel == "main") "athena-android-latest.apk" else "athena-android-${metadata.getString("version")}.apk") else null
                ui {
                    busy = false
                    // A background check must never open an installer or steal focus from another app.
                    if (!MainActivity.foreground) return@ui
                    if (available) {
                        dialog = MaterialAlertDialogBuilder(activity).setTitle("Athena update available")
                            .setMessage("Version ${metadata.getString("version")} (${metadata.getLong("versionCode")}) is ready. Finish active replies and recordings before installing. Your data will be preserved.")
                            .setNegativeButton("Later", null).setPositiveButton("Download update") { _, _ -> download(metadata, apkUrl!!) }.show()
                    } else if (manual) message("No newer build is available in this channel.")
                }
            } catch (error: Exception) { ui { busy = false; if (manual) message("Could not check for updates. ${error.message.orEmpty()}") } }
        }
    }

    private fun findRelease(channel: String): JSONObject? {
        if (channel == "main") {
            val runsUrl = "$GITHUB_API/actions/workflows/android-apk.yml/runs?branch=main&status=success&per_page=10"
            val runs = JSONObject(read(runsUrl)).getJSONArray("workflow_runs")
            return latestMainRelease(runs) { tag ->
                readIfAvailable("$GITHUB_API/releases/tags/$tag", allowNotFound = true)?.let { JSONObject(it) }
            }
        }
        for (page in 1..50) {
            val releases = JSONArray(read("$GITHUB_API/releases?per_page=20&page=$page"))
            stableRelease(releases)?.let { return it }
            if (releases.length() < 20) return null
        }
        error("No matching Android release found in the release history")
    }

    private fun download(info: JSONObject, url: String) {
        if (busy) return
        if (!activity.packageManager.canRequestPackageInstalls()) {
            dialog = MaterialAlertDialogBuilder(activity).setTitle("Allow Athena updates")
                .setMessage("Allow installs from Athena on the next screen, then return and check for updates again.")
                .setNegativeButton("Cancel", null).setPositiveButton("Open settings") { _, _ ->
                    prepareInstall {
                        if (closed || !MainActivity.foreground) return@prepareInstall
                        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                    }
                }.show()
            return
        }
        busy = true
        message("Downloading Athena update…")
        worker.execute {
            val file = File(activity.cacheDir, "updates/${info.getString("sha256")}.apk")
            val partial = File(file.parentFile, "${file.name}.part.apk")
            try {
                file.parentFile!!.mkdirs()
                connection(url).let { connection ->
                    try { connection.inputStream.use { input -> partial.outputStream().use { output ->
                        val buffer = ByteArray(65536)
                        var total = 0L
                        while (true) {
                            if (closed || Thread.currentThread().isInterrupted) throw java.io.IOException("Download cancelled")
                            val size = input.read(buffer)
                            if (size < 0) break
                            total += size
                            require(total <= 100 * 1024 * 1024) { "APK exceeds download limit" }
                            output.write(buffer, 0, size)
                        }
                    } } } finally { connection.disconnect() }
                }
                val digest = MessageDigest.getInstance("SHA-256")
                partial.inputStream().use { input ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val size = input.read(buffer)
                        if (size < 0) break
                        digest.update(buffer, 0, size)
                    }
                }
                val hash = digest.digest().joinToString("") { "%02x".format(it) }
                require(hash == info.getString("sha256")) { "APK checksum mismatch" }
                @Suppress("DEPRECATION")
                val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
                @Suppress("DEPRECATION")
                fun certificates(pkg: android.content.pm.PackageInfo): Set<String> =
                    (if (Build.VERSION.SDK_INT >= 28) pkg.signingInfo!!.apkContentsSigners else pkg.signatures!!)
                        .map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { byte -> "%02x".format(byte) } }.toSet()
                @Suppress("DEPRECATION")
                val apk = activity.packageManager.getPackageArchiveInfo(partial.absolutePath, flags) ?: error("Invalid APK")
                @Suppress("DEPRECATION")
                val installed = activity.packageManager.getPackageInfo(activity.packageName, flags)
                val code = if (Build.VERSION.SDK_INT >= 28) apk.longVersionCode else @Suppress("DEPRECATION") apk.versionCode.toLong()
                validateApk(info, apk.packageName, apk.versionName, code, hash, certificates(apk), certificates(installed))
                require(partial.renameTo(file)) { "Could not save verified APK" }
                ui {
                    busy = false
                    if (!MainActivity.foreground) { message("Download finished. Check for updates when ready to install."); return@ui }
                    installVerified(file)
                }
            } catch (error: Exception) { partial.delete(); ui { busy = false; message("Update failed. ${error.message.orEmpty()}") } }
        }
    }

    internal fun installVerified(file: File) {
        prepareInstall {
            if (closed || !MainActivity.foreground || activity.isFinishing || activity.isDestroyed) return@prepareInstall
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updates", file)
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            } catch (_: android.content.ActivityNotFoundException) { message("No Android package installer is available.") }
        }
    }

    private fun connection(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        require(URL(url).protocol == "https")
        connectTimeout = 15000; readTimeout = 30000
        setRequestProperty("User-Agent", "Athena-Android/${BuildConfig.VERSION_NAME}")
    }
    private fun read(url: String): String = checkNotNull(readIfAvailable(url))

    private fun readIfAvailable(url: String, allowNotFound: Boolean = false): String? {
        val connection = connection(url)
        try {
            if (allowNotFound && connection.responseCode == HttpURLConnection.HTTP_NOT_FOUND) return null
            return connection.inputStream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val size = input.read(buffer)
                    if (size < 0) break
                    require(output.size() + size <= 1024 * 1024) { "Update response exceeds limit" }
                    output.write(buffer, 0, size)
                }
                output.toString("UTF-8")
            }
        } finally {
            connection.disconnect()
        }
    }
    fun close() { closed = true; dialog?.dismiss(); worker.shutdownNow() }
}
