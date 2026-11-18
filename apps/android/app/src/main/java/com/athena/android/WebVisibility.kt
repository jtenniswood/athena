package com.athena.android

import android.os.SystemClock

/** A short-lived acknowledgement, never persisted across process death or navigation. */
class WebVisibility(private val now: () -> Long = SystemClock::elapsedRealtime) {
    private data class Lease(val sessionId: String, val profile: String, val acknowledged: Long)
    @Volatile private var lease: Lease? = null

    fun acknowledge(sessionId: String, profile: String = "") {
        lease = Lease(sessionId.take(500), profile.take(500), now())
    }

    fun clear() { lease = null }

    fun shouldSuppress(foreground: Boolean, sessionId: String?, profile: String? = null): Boolean {
        val visible = lease ?: return false
        // Older WebViews and servers can still send only a session ID.
        val sameProfile = visible.profile.isEmpty() || profile.isNullOrEmpty() || profile == visible.profile
        return foreground && !sessionId.isNullOrEmpty() && sessionId == visible.sessionId &&
            sameProfile && now() - visible.acknowledged in 0..10000
    }
}
