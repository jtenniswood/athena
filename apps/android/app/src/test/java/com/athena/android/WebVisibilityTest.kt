package com.athena.android

import org.junit.Assert.*
import org.junit.Test

class WebVisibilityTest {
    @Test fun onlyAFreshAcknowledgementForTheVisibleChatSuppressesAlerts() {
        var time = 100L
        val visibility = WebVisibility { time }
        assertFalse(visibility.shouldSuppress(true, "chat-1"))
        visibility.acknowledge("chat-1")
        assertTrue(visibility.shouldSuppress(true, "chat-1"))
        assertFalse(visibility.shouldSuppress(false, "chat-1"))
        assertFalse(visibility.shouldSuppress(true, "chat-2"))
        time += 10001
        assertFalse(visibility.shouldSuppress(true, "chat-1"))
        visibility.acknowledge("chat-1"); visibility.clear()
        assertFalse(visibility.shouldSuppress(true, "chat-1"))
    }
}
