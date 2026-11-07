package com.athena.android

import android.content.ClipData
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.Base64
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver
import java.io.File
import java.io.RandomAccessFile

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ShareInboxTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private lateinit var inbox: ShareInbox
    class Files : ContentProvider() {
        override fun onCreate() = true
        override fun getType(uri: Uri) = "application/octet-stream"
        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, args: Array<out String>?, sort: String?): Cursor =
            MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME)).apply { addRow(arrayOf("shared-${uri.lastPathSegment}.txt")) }
        override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
            ParcelFileDescriptor.open(File(context!!.filesDir, uri.lastPathSegment!!), ParcelFileDescriptor.MODE_READ_ONLY)
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, args: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, args: Array<out String>?) = 0
    }
    @Before fun setup() {
        File(context.cacheDir, "incoming-shares").deleteRecursively()
        val provider = Files()
        provider.attachInfo(context, ProviderInfo().apply { authority = "shares.test" })
        ShadowContentResolver.registerProviderInternal("shares.test", provider)
        inbox = ShareInbox(context)
    }
    private fun file(name: String, bytes: ByteArray): Uri {
        File(context.filesDir, name).writeBytes(bytes)
        return Uri.parse("content://shares.test/$name")
    }
    private fun payload(batch: JSONObject, index: Int = 0, offset: Int = 0) =
        JSONObject().put("id", batch.getString("id")).put("index", index).put("offset", offset)

    @Test fun singleShareSurvivesProviderRemovalAndInboxRecreationUntilAcknowledged() {
        val bytes = ByteArray(70000) { (it % 256).toByte() }
        val uri = file("first", bytes)
        assertTrue(inbox.receive(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uri)))
        File(context.filesDir, "first").delete()
        val restored = ShareInbox(context)
        val batch = restored.pending() as JSONObject
        assertEquals("shared-first.txt", batch.getJSONArray("files").getJSONObject(0).getString("name"))
        val first = Base64.decode(restored.read(payload(batch)), Base64.DEFAULT)
        val last = Base64.decode(restored.read(payload(batch, offset = ShareInbox.CHUNK_SIZE)), Base64.DEFAULT)
        assertArrayEquals(bytes, first + last)
        assertTrue(restored.finish(batch.getString("id")))
        assertEquals(JSONObject.NULL, restored.pending())
    }

    @Test fun multipleAndClipDataSharesKeepOrderAndDeduplicateUris() {
        val first = file("first", byteArrayOf(1))
        val second = file("second", byteArrayOf(2))
        val intent = Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(first, second))
        intent.clipData = ClipData.newUri(context.contentResolver, "shared", first)
        inbox.receive(intent)
        val batch = inbox.pending() as JSONObject
        assertEquals(2, batch.getJSONArray("files").length())
        assertArrayEquals(byteArrayOf(2), Base64.decode(inbox.read(payload(batch, index = 1)), Base64.DEFAULT))
        inbox.finish(batch.getString("id"))
        inbox.receive(Intent(Intent.ACTION_SEND).apply { clipData = ClipData.newUri(context.contentResolver, "file", first) })
        assertEquals(1, (inbox.pending() as JSONObject).getJSONArray("files").length())
    }

    @Test fun inaccessibleOversizedAndNonContentFilesNeverLeavePartialBatches() {
        val huge = file("huge", byteArrayOf())
        RandomAccessFile(File(context.filesDir, "huge"), "rw").use { it.setLength(ShareInbox.FILE_LIMIT.toLong() + 1) }
        for (uri in listOf(huge, Uri.parse("content://shares.test/missing"), Uri.parse("file:///private/example.txt"))) {
            try { inbox.receive(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uri)); fail("Must reject invalid share") }
            catch (_: Exception) { }
            assertEquals(JSONObject.NULL, inbox.pending())
            assertTrue(File(context.cacheDir, "incoming-shares").listFiles().orEmpty().isEmpty())
        }
    }

    @Test fun unrelatedIntentsAndUntrustedChunkAddressesAreRejected() {
        assertFalse(ShareInbox.accepts(Intent(Intent.ACTION_VIEW)))
        assertFalse(ShareInbox.accepts(null))
        inbox.receive(Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, file("first", byteArrayOf(1))))
        val batch = inbox.pending() as JSONObject
        for (request in listOf(payload(batch, index = 1), payload(batch, offset = -1), payload(batch, offset = 1), payload(batch).put("id", "../other"))) {
            try { inbox.read(request); fail("Must reject invalid address") } catch (_: Exception) { }
        }
        assertNotEquals(JSONObject.NULL, inbox.pending())
    }
}
