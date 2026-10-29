package com.athena.android

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class AppUpdatesTest {
    private fun metadata() = JSONObject().put("schemaVersion", 1).put("packageName", "com.athena.android")
        .put("firebaseConfigured", true).put("versionCode", 1002).put("revision", "a".repeat(40))
        .put("sha256", "b".repeat(64)).put("minimumServerProtocol", 1).put("bridgeProtocol", 1)

    @Test fun channelsExcludeDockerReleasesDraftsAndOtherPrereleases() {
        val releases = JSONArray("""[
            {"tag_name":"v99.0.0"},
            {"tag_name":"android-v9.0.0","draft":true},
            {"tag_name":"android-v8.0.0","prerelease":true},
            {"tag_name":"android-main-abc","prerelease":true},
            {"tag_name":"android-v0.3.0"}
        ]""")
        assertEquals("android-v0.3.0", AppUpdates.candidate(releases, "stable")!!.getString("tag_name"))
        assertEquals("android-main-abc", AppUpdates.candidate(releases, "main")!!.getString("tag_name"))
        assertNull(AppUpdates.candidate(JSONArray("[]"), "stable"))
    }

    @Test fun metadataRejectsDowngradesWrongIdentityAndIncompatibleProtocols() {
        AppUpdates.validateMetadata(metadata(), 1001)
        val invalid = listOf(metadata().put("versionCode", 1001), metadata().put("packageName", "other.app"),
            metadata().put("firebaseConfigured", false), metadata().put("revision", "unknown"),
            metadata().put("sha256", "bad"), metadata().put("minimumServerProtocol", 2), metadata().put("bridgeProtocol", 2))
        for (info in invalid) assertThrows(IllegalArgumentException::class.java) { AppUpdates.validateMetadata(info, 1001) }
    }

    @Test fun downloadedApkMustMatchInstalledSigningIdentityAndPublishedMetadata() {
        val info = metadata().put("version", "0.3.0").put("signingCertificateSha256", "c".repeat(64))
        val hash = "b".repeat(64)
        val certificate = setOf("c".repeat(64))
        AppUpdates.validateApk(info, "com.athena.android", "0.3.0", 1002, hash, certificate, certificate)
        assertThrows(IllegalArgumentException::class.java) { AppUpdates.validateApk(info, "other.app", "0.3.0", 1002, hash, certificate, certificate) }
        assertThrows(IllegalArgumentException::class.java) { AppUpdates.validateApk(info, "com.athena.android", "0.2.0", 1002, hash, certificate, certificate) }
        assertThrows(IllegalArgumentException::class.java) { AppUpdates.validateApk(info, "com.athena.android", "0.3.0", 1001, hash, certificate, certificate) }
        assertThrows(IllegalArgumentException::class.java) { AppUpdates.validateApk(info, "com.athena.android", "0.3.0", 1002, "wrong", certificate, certificate) }
        assertThrows(IllegalArgumentException::class.java) { AppUpdates.validateApk(info, "com.athena.android", "0.3.0", 1002, hash, setOf("wrong"), certificate) }
        assertThrows(IllegalArgumentException::class.java) { AppUpdates.validateApk(info, "com.athena.android", "0.3.0", 1002, hash, certificate, setOf("wrong")) }
    }

    @Test fun installerWaitsForNavigationSafetyAndGrantsOnlyTheVerifiedFile() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        var prepared: (() -> Unit)? = null
        val updates = AppUpdates(activity) { prepared = it }
        val file = java.io.File(activity.cacheDir, "updates/verified.apk")
        file.parentFile!!.mkdirs(); file.writeText("fixture")
        try {
            updates.installVerified(file)
            assertNotNull(prepared)
            assertNull(shadowOf(activity).nextStartedActivity)
            prepared!!.invoke()
            val intent = shadowOf(activity).nextStartedActivity
            assertEquals(android.content.Intent.ACTION_VIEW, intent.action)
            assertEquals("application/vnd.android.package-archive", intent.type)
            assertEquals("com.athena.android.updates", intent.data!!.authority)
            assertTrue(intent.flags and android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
            // A safety response arriving after leaving Athena must not launch an installer.
            updates.installVerified(file)
            MainActivity.foreground = false
            prepared!!.invoke()
            assertNull(shadowOf(activity).nextStartedActivity)
        } finally { updates.close(); controller.pause().stop().destroy(); file.delete() }
    }

    @Test fun onlyRepositoryReleaseAssetsCanBeDownloaded() {
        assertTrue(AppUpdates.assetUrl(AppUpdates.REPOSITORY + "android-v0.3.0/athena.apk"))
        for (url in listOf("http://github.com/jtenniswood/athena/releases/download/x/a.apk",
            "https://github.com/other/repo/releases/download/x/a.apk", "https://evil.example/a.apk",
            AppUpdates.REPOSITORY + "../x.apk", AppUpdates.REPOSITORY + "x/a.apk?redirect=evil")) {
            assertFalse(url, AppUpdates.assetUrl(url))
        }
    }
}
