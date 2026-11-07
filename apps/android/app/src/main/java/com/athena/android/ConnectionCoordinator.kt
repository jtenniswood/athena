package com.athena.android

/** Connection state belongs to the host; chat and draft state stay in the web app. */
class ConnectionCoordinator(private val changed: (State) -> Unit = {}) {
    enum class Stage { SETUP, LOADING, ACCESS_SIGN_IN, ATHENA_SIGN_IN, READY, RECOVERY }
    data class State(val stage: Stage, val message: String, val code: String? = null, val slowConnection: Boolean = false)
    var state = State(Stage.SETUP, "Enter your Athena server address.")
        private set
    var settingsReady = false
        private set
    var protocol: Int? = null
        private set

    fun setup() = update(Stage.SETUP, "Enter your Athena server address.")
    fun loading() {
        settingsReady = false
        protocol = null
        update(Stage.LOADING, "Connecting to Athena…")
    }
    fun authenticate(access: Boolean) = update(
        if (access) Stage.ACCESS_SIGN_IN else Stage.ATHENA_SIGN_IN,
        if (access) "Complete Cloudflare Access sign-in in your browser, then return here."
        else "Approve Athena sign-in in your browser, then return here."
    )
    fun pending(access: Boolean) = authenticate(access)
    fun ready() = update(Stage.READY, "Connected to Athena")
    fun waitingForSession() = update(Stage.LOADING, "Reconnecting to your Athena session…")
    fun waitingLonger() {
        // Elapsed time alone is not a failure: WebView and the gateway may still be connecting.
        if (state.stage == Stage.LOADING && !state.slowConnection) {
            update(Stage.LOADING, "Still connecting to Athena…", slowConnection = true)
        }
    }
    fun sessionConnected(connected: Boolean) {
        if (connected && (state.stage == Stage.LOADING ||
                (state.stage == Stage.RECOVERY && state.code == "web-timeout"))) ready()
        else if (!connected && state.stage == Stage.READY) waitingForSession()
    }
    fun recover(code: String, message: String) {
        // A failure does not unmount the current document's settings entry. Health controls visibility.
        update(Stage.RECOVERY, message, code)
    }
    fun handshake(version: Int): Boolean {
        if (version != 1) return false
        protocol = version
        return true
    }
    /** The web menu must already be rendered before its native replacement disappears. */
    fun settings(mounted: Boolean, rendered: Boolean): Boolean {
        settingsReady = mounted && rendered && protocol == 1
        return settingsReady
    }
    private fun update(stage: Stage, message: String, code: String? = null, slowConnection: Boolean = false) {
        state = State(stage, message, code, slowConnection)
        changed(state)
    }
}
