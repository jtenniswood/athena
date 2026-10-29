package com.athena.android

import org.json.JSONObject

/** Shared transport validation; feature handlers never parse untrusted RPC envelopes. */
object NativeBridge {
    class UnsupportedMethod : IllegalArgumentException()

    fun receive(raw: String, reply: (String) -> Unit, handle: (String, JSONObject, (Any) -> Unit) -> Unit) {
        if (raw.length > 262144) return
        var id: String? = null
        fun send(value: JSONObject) {
            try { reply(value.put("id", id).toString()) }
            catch (_: Exception) { /* The originating page may have closed during a system prompt. */ }
        }
        fun fail(code: String, message: String) {
            if (id != null) send(JSONObject().put("error", JSONObject().put("code", code).put("message", message)))
        }
        try {
            val message = JSONObject(raw)
            id = message.getString("id").takeIf { it.isNotBlank() && it.length <= 100 } ?: return
            if (message.optInt("protocol", 1) != 1) {
                fail("unsupported-protocol", "Update Athena for Android.")
                return
            }
            val payload = if (message.isNull("payload")) JSONObject() else message.getJSONObject("payload")
            val method = message.getString("method")
            if (raw.length > 16000 && method !in listOf("settingsPage", "updateSettingsPage")) {
                fail("invalid-request", "Request is too large."); return
            }
            handle(method, payload) { send(JSONObject().put("value", it)) }
        } catch (_: UnsupportedMethod) {
            fail("unsupported-method", "This Android feature is unavailable.")
        } catch (_: Exception) {
            fail("invalid-request", "Invalid Android bridge request.")
        }
    }
}
