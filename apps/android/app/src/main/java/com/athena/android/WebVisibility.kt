package com.athena.android

import android.os.SystemClock

/** A short-lived acknowledgement, never persisted across process death or navigation. */
class WebVisibility(private val now: () -> Long = SystemClock::elapsedRealtime) {
    @Volatile private var session = ""
    @Volatile private var acknowledged = Long.MIN_VALUE
    fun acknowledge(sessionId: String) { session = sessionId.take(500); acknowledged = now() }
    fun clear() { session = ""; acknowledged = Long.MIN_VALUE }
    fun shouldSuppress(foreground: Boolean, sessionId: String?): Boolean = foreground &&
        !sessionId.isNullOrEmpty() && sessionId == session && now() - acknowledged in 0..10000
}
