package com.athena.android

/** Locate retained native views without adding test accessors to the application API. */
internal fun legacyPresenter(activity: MainActivity, name: String): Any {
    val owner = MainActivity::class.java.getDeclaredField("legacyUi").apply { isAccessible = true }.get(activity)
    val delegate = LegacyNativePresentation::class.java.getDeclaredField(name + "$" + "delegate").apply { isAccessible = true }
    return (delegate.get(owner) as Lazy<*>).value!!
}
