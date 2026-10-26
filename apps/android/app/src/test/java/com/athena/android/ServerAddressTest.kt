package com.athena.android

import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun normalizesHttpsOrigins() {
        assertEquals("https://athena.example", ServerAddress.normalize(" https://ATHENA.example:443/ "))
        assertEquals("https://athena.example:8443", ServerAddress.normalize("https://athena.example:8443"))
    }
    @Test fun rejectsUnsafeAddresses() {
        listOf("http://athena.example", "javascript:alert(1)", "https://user:pass@athena.example",
            "https://athena.example/app", "https://athena.example/?token=secret", "https://athena.example/#/chat").forEach {
            assertThrows(IllegalArgumentException::class.java) { ServerAddress.normalize(it) }
        }
    }
    @Test fun restrictsBridgeAndNavigationToExactOrigin() {
        val origin = "https://athena.example"
        assertTrue(ServerAddress.belongsTo("$origin/auth/callback?code=abc", origin))
        assertFalse(ServerAddress.belongsTo("$origin.attacker.example", origin))
        assertFalse(ServerAddress.belongsTo("https://athena.example:8443", origin))
        assertFalse(ServerAddress.belongsTo("https://athena.example@attacker.example", origin))
        assertFalse(ServerAddress.belongsTo("javascript:alert(1)", origin))
    }
    @Test fun notificationTargetsCannotEscapeTheConversationHash() {
        assertEquals("https://athena.example/#/chat%2Fid%20%3F%23", ServerAddress.conversationUrl("https://athena.example", "chat/id ?#"))
    }
}
