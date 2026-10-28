package com.athena.android

import org.junit.Assert.*
import org.junit.Test

class ConnectionCoordinatorTest {
    @Test fun chromeHandoverRequiresSupportedProtocolAndRenderedMenu() {
        val host = ConnectionCoordinator()
        host.loading()
        assertFalse(host.settings(true, true))
        assertFalse(host.handshake(2))
        assertTrue(host.handshake(1))
        assertFalse(host.settings(true, false))
        assertTrue(host.settings(true, true))
        assertFalse(host.settings(false, true))
    }

    @Test fun pageNavigationResetsFeaturesAndRecoveryPreservesTheCurrentMenuHandover() {
        val host = ConnectionCoordinator()
        host.handshake(1); host.settings(true, true); host.ready()
        host.loading()
        assertFalse(host.settingsReady)
        assertNull(host.protocol)
        host.handshake(1); host.settings(true, true)
        host.recover("auth-expired", "Sign in again")
        assertTrue(host.settingsReady)
        assertEquals(ConnectionCoordinator.Stage.RECOVERY, host.state.stage)
        assertEquals("auth-expired", host.state.code)
        host.authenticate(true)
        assertEquals(ConnectionCoordinator.Stage.ACCESS_SIGN_IN, host.state.stage)
        host.authenticate(false)
        assertEquals(ConnectionCoordinator.Stage.ATHENA_SIGN_IN, host.state.stage)
        host.ready()
        assertNull(host.state.code)
    }
    @Test fun sessionReconnectDoesNotForgetTheRenderedNativeSettingsReplacement() {
        val host = ConnectionCoordinator()
        host.loading(); host.handshake(1); host.settings(true, true); host.ready()
        host.sessionConnected(false)
        assertEquals(ConnectionCoordinator.Stage.LOADING, host.state.stage)
        assertTrue(host.settingsReady)
        host.sessionConnected(true)
        assertEquals(ConnectionCoordinator.Stage.READY, host.state.stage)
        assertTrue(host.settingsReady)
        host.authenticate(true)
        host.sessionConnected(true)
        assertEquals(ConnectionCoordinator.Stage.ACCESS_SIGN_IN, host.state.stage)
    }

}
