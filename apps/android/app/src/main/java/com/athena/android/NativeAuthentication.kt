package com.athena.android

import android.app.Activity
import android.net.Uri

/** One orchestration point; Access and Athena retain separate credentials and handoff protocols. */
class NativeAuthentication(
    activity: Activity,
    private val connection: ConnectionCoordinator,
    private val connected: () -> Unit,
    accessConnected: () -> Unit
) {
    private var lastAccess = false
    private fun progress(access: Boolean, code: String, message: String) {
        lastAccess = access
        when (code) {
            "waiting" -> connection.pending(access)
            "connected" -> connection.waitingForSession()
            else -> connection.recover(code, message)
        }
    }
    private val browser = BrowserSignIn(activity, { code, message -> progress(false, code, message) }, connected = connected)
    private val access = AccessSignIn(activity, progress = { code, message -> progress(true, code, message) }, connected = accessConnected)

    fun start(origin: String, useAccess: Boolean, path: String = "/login", started: (Boolean) -> Unit = {}) {
        lastAccess = useAccess
        connection.authenticate(useAccess)
        if (useAccess) { browser.cancel(); access.start(origin) }
        else { access.cancel(); browser.start(origin, path, started) }
    }
    fun retry(origin: String) = start(origin, lastAccess)
    fun resume(origin: String) { browser.resume(origin); access.resume(origin) }
    fun receive(uri: Uri?, origin: String): Boolean = access.receive(uri, origin)
    fun cancel() { browser.cancel(); access.cancel() }
    fun close() { browser.close(); access.close() }
}
