package com.athena.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.util.UUID

/** Copy temporary URI grants into private cache before sign-in or chat selection. */
class ShareInbox(private val context: Context) {
    companion object {
        const val FILE_LIMIT = 16 * 1024 * 1024
        const val TOTAL_LIMIT = 32 * 1024 * 1024
        const val CHUNK_SIZE = 64 * 1024
        fun accepts(intent: Intent?) = intent?.action in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)
    }
    private val root = File(context.cacheDir, "incoming-shares").apply { mkdirs() }

    @Suppress("DEPRECATION")
    @Synchronized fun receive(intent: Intent): Boolean {
        require(accepts(intent))
        val streams = if (intent.action == Intent.ACTION_SEND_MULTIPLE)
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
        else listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
        val uris = (streams + (0 until (intent.clipData?.itemCount ?: 0)).mapNotNull {
            intent.clipData?.getItemAt(it)?.uri
        }).distinct()
        require(uris.isNotEmpty()) { "Share one or more files to Athena." }
        require(uris.size <= 10) { "Share up to 10 files at a time." }
        prune()
        require(batches().size < 5) { "Attach or cancel pending shares before sharing more files." }
        val id = UUID.randomUUID().toString()
        val directory = File(root, id).apply { mkdirs() }
        try {
            val files = JSONArray()
            var total = 0
            for ((index, uri) in uris.withIndex()) {
                require(uri.scheme == "content") { "This file provider cannot be shared with Athena." }
                val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else null
                }?.replace(Regex("[\\/\\\\\r\n]"), "_")?.take(120)?.ifBlank { null } ?: "shared-file-${index + 1}"
                val target = File(directory, index.toString())
                context.contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use { output ->
                        val buffer = ByteArray(8192)
                        var size = 0
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            size += count; total += count
                            require(size <= FILE_LIMIT && total <= TOTAL_LIMIT) { "Share files up to 16 MiB each and 32 MiB in total." }
                            output.write(buffer, 0, count)
                        }
                    }
                } ?: error("The shared file could not be opened.")
                files.put(JSONObject().put("name", name).put("size", target.length())
                    .put("type", context.contentResolver.getType(uri) ?: "application/octet-stream"))
            }
            File(directory, "manifest.json").writeText(JSONObject().put("id", id).put("files", files).toString())
            return true
        } catch (error: Exception) {
            directory.deleteRecursively()
            throw error
        }
    }

    @Synchronized fun pending(): Any {
        prune()
        return batches().firstOrNull()?.let { JSONObject(File(it, "manifest.json").readText()) } ?: JSONObject.NULL
    }

    @Synchronized fun read(payload: JSONObject): String {
        val directory = batch(payload.getString("id"))
        val manifest = JSONObject(File(directory, "manifest.json").readText())
        val index = payload.getInt("index")
        require(index in 0 until manifest.getJSONArray("files").length())
        val offset = payload.getLong("offset")
        val file = File(directory, index.toString())
        require(offset >= 0 && offset < file.length())
        val bytes = ByteArray(minOf(CHUNK_SIZE.toLong(), file.length() - offset).toInt())
        RandomAccessFile(file, "r").use { it.seek(offset); it.readFully(bytes) }
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    @Synchronized fun finish(id: String): Boolean = batch(id).deleteRecursively()

    private fun batch(id: String): File {
        require(Regex("[a-f0-9-]{36}").matches(id))
        return File(root, id)
    }
    private fun batches() = root.listFiles().orEmpty().filter { File(it, "manifest.json").isFile }.sortedBy { it.lastModified() }
    private fun prune() {
        root.listFiles().orEmpty().filter { System.currentTimeMillis() - it.lastModified() > 24 * 60 * 60 * 1000L }
            .forEach { it.deleteRecursively() }
    }
}
