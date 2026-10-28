package com.athena.android

import android.content.Context
import android.os.Bundle
import android.webkit.WebView
import android.widget.Button
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SignInUiTest {
    @Test fun inlineCancelInvalidatesPendingSignInAndKeepsTheCurrentPage() {
        val prefs = InstrumentationRegistry.getInstrumentation().targetContext.getSharedPreferences("athena", Context.MODE_PRIVATE)
        val oldOrigin = prefs.getString("origin", null)
        prefs.edit().putString("origin", "").commit()
        try {
            ActivityScenario.launch(MainActivity::class.java).use { scenario ->
                scenario.onActivity { activity ->
                    val origin = "https://athena.example"
                    prefs.edit().putString("origin", origin).commit()
                    fun field(name: String) = MainActivity::class.java.getDeclaredField(name).apply { isAccessible = true }
                    field("origin").set(activity, origin)
                    MainActivity::class.java.getDeclaredMethod("openServer", Bundle::class.java).apply { isAccessible = true }.invoke(activity, null)
                    val web = field("web").get(activity) as WebView
                    web.stopLoading()
                    val pending = activity.getSharedPreferences("access-sign-in", Context.MODE_PRIVATE)
                    pending.edit().putString("origin", origin).putString("private", "pending-key").commit()
                    val connection = field("connection").get(activity) as ConnectionCoordinator
                    connection.authenticate(true)
                    val button = field("connectionAction").get(activity) as Button
                    assertEquals(activity.getString(R.string.cancel_sign_in), button.text.toString())
                    button.performClick()
                    assertFalse(pending.contains("private"))
                    assertEquals("auth-cancelled", connection.state.code)
                    assertEquals(activity.getString(R.string.reconnect), button.text.toString())
                    assertSame(web, field("web").get(activity))
                }
            }
        } finally { prefs.edit().putString("origin", oldOrigin).commit() }
    }
}
