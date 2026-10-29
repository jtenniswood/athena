package com.athena.android

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeBridgeTest {
    @Test fun invalidVersionsAndPayloadsNeverReachFeatureHandlers() {
        val replies = mutableListOf<String>()
        var handled = false
        val handler: (String, JSONObject, (Any) -> Unit) -> Unit = { _, _, _ -> handled = true }
        NativeBridge.receive("""{"id":"version","protocol":2,"method":"permission"}""", replies::add, handler)
        assertEquals("unsupported-protocol", JSONObject(replies.last()).getJSONObject("error").getString("code"))
        NativeBridge.receive("""{"id":"payload","method":"permission","payload":"bad"}""", replies::add, handler)
        assertEquals("invalid-request", JSONObject(replies.last()).getJSONObject("error").getString("code"))
        assertFalse(handled)
    }

    @Test fun missingProtocolSupportsLegacyClientsAndUnknownMethodsHaveStructuredErrors() {
        val replies = mutableListOf<String>()
        NativeBridge.receive("""{"id":"legacy","method":"permission"}""", replies::add) { method, _, reply ->
            assertEquals("permission", method)
            reply("granted")
        }
        assertEquals("granted", JSONObject(replies.last()).getString("value"))
        NativeBridge.receive("""{"id":"missing","method":"future"}""", replies::add) { _, _, _ ->
            throw NativeBridge.UnsupportedMethod()
        }
        assertEquals("missing", JSONObject(replies.last()).getString("id"))
        assertEquals("unsupported-method", JSONObject(replies.last()).getJSONObject("error").getString("code"))
    }
    @Test fun onlySettingsSnapshotsMayUseTheLargerEnvelope() {
        val replies = mutableListOf<String>()
        val payload = JSONObject().put("value", "x".repeat(20000))
        var handled = false
        fun send(method: String) = NativeBridge.receive(JSONObject().put("id", "large").put("method", method).put("payload", payload).toString(), replies::add) { _, _, reply -> handled = true; reply(true) }
        send("permission")
        assertFalse(handled)
        assertEquals("invalid-request", JSONObject(replies.last()).getJSONObject("error").getString("code"))
        send("settingsPage")
        assertTrue(handled)
        handled = false
        payload.put("value", "x".repeat(270000))
        send("settingsPage")
        assertFalse(handled)
    }
}
