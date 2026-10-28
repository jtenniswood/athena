package com.athena.android

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.webkit.*
import android.widget.*
import androidx.webkit.JavaScriptReplyProxy
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.doAfterTextChanged
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.color.DynamicColors
import com.google.android.material.color.MaterialColors
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.textfield.TextInputLayout
import com.google.android.material.textfield.TextInputEditText
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : AppCompatActivity() {
    companion object { @Volatile var foreground = false; val visibility = WebVisibility() }
    private val prefs by lazy { getSharedPreferences("athena", MODE_PRIVATE) }
    private val pushRegistration by lazy { NativePushRegistration(this) }
    private val notifications by lazy { NativeNotifications(this) }
    private val actionMenus by lazy { NativeActionMenus(this) }
    private val connection = ConnectionCoordinator { renderConnection(it) }
    private var connectionStatus: TextView? = null
    private var pageGeneration = 0
    private var navigationId: String? = null
    private var webRevision = "Unknown"
    private var serverProtocol = "Unknown"
    private val authentication by lazy { NativeAuthentication(this, connection, {
        web?.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null)
    }, { reconnectAthena() }) }
    private val nativeSettings by lazy { NativeAppSettings(this) }
    private var nativeToolbar: View? = null
    private var editingServer = false
    private var nightMode = 0
    private var web: WebView? = null
    private var origin = ""
    private var permissionReply: ((String) -> Unit)? = null
    private var microphoneRequest: PermissionRequest? = null
    private var fileReply: ValueCallback<Array<Uri>>? = null
    private var navigationAction: (() -> Unit)? = null
    private lateinit var container: LinearLayout
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        permissionReply?.invoke(notifications.permission()); permissionReply = null
    }
    private val microphonePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = microphoneRequest; microphoneRequest = null
        if (granted && request != null && ServerAddress.belongsTo(web?.url, origin)) request.grant(request.resources)
        else request?.deny()
    }
    private val filePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        fileReply?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(it.resultCode, it.data)); fileReply = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        DynamicColors.applyToActivityIfAvailable(this)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        nightMode = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK
        container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorSurface))
        }
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(container)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { navigateBack() }
        })
        origin = prefs.getString("origin", "") ?: ""
        if (origin.isEmpty()) setup() else openServer(savedInstanceState)
        authentication.receive(intent?.data, origin)
    }

    private fun setup() {
        actionMenus.dismiss()
        visibility.clear()
        connection.setup()
        connectionStatus = null
        editingServer = origin.isNotEmpty()
        container.removeAllViews()
        val screen = layoutInflater.inflate(R.layout.screen_connect, container, false)
        container.addView(screen)
        val content = screen.findViewById<View>(R.id.connect_content)
        screen.addOnLayoutChangeListener { _, left, _, right, _, _, _, _, _ ->
            val width = (right - left - 48.dp()).coerceIn(0, 560.dp())
            if (content.layoutParams.width != width) content.layoutParams = content.layoutParams.apply { this.width = width }
        }
        val input = screen.findViewById<TextInputLayout>(R.id.server_input)
        val address = screen.findViewById<TextInputEditText>(R.id.server_address)
        address.setText(origin)
        address.doAfterTextChanged { input.error = null }
        val connect = {
            try {
                val next = ServerAddress.normalize(address.text.toString())
                if (next != origin) {
                    authentication.cancel()
                    prefs.edit().putBoolean("pushEnabled", false).remove("pushRefreshKey")
                        .remove("pushBinding").remove("pushSyncedToken").remove("pushSyncedTokenVersion").remove("pushSyncStatus").apply()
                }
                prefs.edit().putString("origin", next).apply()
                origin = next
                (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
                    .hideSoftInputFromWindow(address.windowToken, 0)
                openServer(null)
            } catch (error: IllegalArgumentException) {
                input.error = error.message ?: getString(R.string.server_help)
                address.requestFocus()
            }
        }
        screen.findViewById<View>(R.id.connect).setOnClickListener { connect() }
        address.setOnEditorActionListener { _, action, _ ->
            if (action == android.view.inputmethod.EditorInfo.IME_ACTION_GO) { connect(); true } else false
        }
        screen.findViewById<View>(R.id.cancel_connect).apply {
            visibility = if (editingServer) View.VISIBLE else View.GONE
            setOnClickListener { openServer(null) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openServer(state: Bundle?) {
        actionMenus.dismiss()
        editingServer = false
        connectionStatus = null
        connection.loading()
        web?.destroy()
        web = null
        container.removeAllViews()
        val toolbar = MaterialToolbar(this).apply {
            setTitle(R.string.app_name)
            inflateMenu(R.menu.native_toolbar)
            setOnMenuItemClickListener { appSettings(); true }
        }
        nativeToolbar = toolbar
        container.addView(toolbar)
        connectionStatus = TextView(this).apply {
            setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_BodyMedium)
            setPadding(16.dp(), 8.dp(), 16.dp(), 8.dp())
            setOnClickListener {
                MaterialAlertDialogBuilder(this@MainActivity).setTitle("Connection status")
                    .setMessage(connection.state.message)
                    .setNegativeButton("Close", null)
                    .setNeutralButton("App settings") { _, _ -> appSettings() }
                    .setPositiveButton("Try again") { _, _ ->
                        if (connection.state.code?.startsWith("auth-") == true) authentication.retry(origin)
                        else reconnectAthena()
                    }.show()
            }
        }
        container.addView(connectionStatus)
        renderConnection(connection.state)
        val progress = LinearProgressIndicator(this).apply { max = 100 }
        container.addView(progress, LinearLayout.LayoutParams(-1, 4.dp()))
        val view = WebView(this)
        web = view
        view.setBackgroundColor(Color.rgb(17, 17, 17))
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            setSupportMultipleWindows(true)
            userAgentString += " AthenaAndroid/1"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            errorScreen("Update Android System WebView to use Athena’s native integration.")
            return
        }
        WebViewCompat.addWebMessageListener(view, "AthenaAndroid", setOf(origin)) { _, message, sourceOrigin, mainFrame, reply ->
            if (mainFrame && ServerAddress.belongsTo(sourceOrigin.toString(), origin) && ServerAddress.belongsTo(view.url, origin)) {
                handleMessage(message.data ?: "", reply)
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                actionMenus.dismiss()
                visibility.clear()
                pageGeneration++
                navigationAction = null; navigationId = null
                connection.loading()
                renderConnection(connection.state)
                val generation = pageGeneration
                view.postDelayed({
                    if (generation == pageGeneration && connection.state.stage == ConnectionCoordinator.Stage.LOADING) {
                        connection.recover("web-timeout", "Athena has not finished connecting. Tap here to retry or check App settings.")
                    }
                }, 20000)
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.isForMainFrame && request.url.scheme == "https" &&
                    request.url.path?.startsWith("/cdn-cgi/access/") == true &&
                    (ServerAddress.belongsTo(request.url.toString(), origin) || request.url.host?.endsWith(".cloudflareaccess.com") == true)) {
                    toolbar.visibility = View.VISIBLE
                    startSignIn(true)
                    return true
                }
                if (request.isForMainFrame && ServerAddress.belongsTo(request.url.toString(), origin) &&
                    request.url.path in listOf("/login", "/auth/login")) {
                    toolbar.visibility = View.VISIBLE
                    startSignIn(false, request.url.encodedPath + (request.url.encodedQuery?.let { "?$it" } ?: ""))
                    return true
                }
                if (ServerAddress.belongsTo(request.url.toString(), origin)) return false
                if (request.isForMainFrame) external(request.url)
                return true
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) errorScreen("Could not reach Athena. Check your connection and server address.")
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                actionMenus.dismiss()
                container.removeView(view); view.destroy(); web = null
                errorScreen("Android closed the web renderer. Reopen Athena to reconnect.")
                return true
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.setProgressCompat(newProgress, false)
                progress.visibility = if (newProgress < 100) View.VISIBLE else View.GONE
            }
            override fun onCreateWindow(source: WebView, isDialog: Boolean, isUserGesture: Boolean, result: android.os.Message): Boolean {
                if (!isUserGesture) return false
                // A temporary view resolves target=_blank without exposing the native bridge to it.
                val popup = WebView(this@MainActivity)
                popup.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(temporary: WebView, request: WebResourceRequest): Boolean {
                        val target = request.url
                        if (ServerAddress.belongsTo(target.toString(), origin) && target.path == "/" && target.query == null) view.loadUrl(target.toString())
                        else external(target)
                        temporary.post { temporary.destroy() }
                        return true
                    }
                }
                (result.obj as WebView.WebViewTransport).webView = popup
                result.sendToTarget()
                return true
            }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileReply?.onReceiveValue(null); fileReply = callback
                try { filePicker.launch(params.createIntent()) }
                catch (_: ActivityNotFoundException) { fileReply?.onReceiveValue(null); fileReply = null }
                return true
            }
            override fun onPermissionRequest(request: PermissionRequest) {
                if (!ServerAddress.belongsTo(request.origin.toString(), origin) ||
                    !ServerAddress.belongsTo(view.url, origin) || request.resources.any { it != PermissionRequest.RESOURCE_AUDIO_CAPTURE }) {
                    request.deny(); return
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) request.grant(request.resources)
                else {
                    microphoneRequest?.deny(); microphoneRequest = request
                    microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
                }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (microphoneRequest === request) microphoneRequest = null
            }
        }
        view.setDownloadListener { url, _, _, _, _ -> external(Uri.parse(url)) }
        container.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
        if (state == null || view.restoreState(state) == null) view.loadUrl(origin + "/")
        openNotification(intent)
    }

    private fun handleMessage(raw: String, reply: JavaScriptReplyProxy) {
        NativeBridge.receive(raw, { reply.postMessage(it) }, ::handleNativeRequest)
    }

    private fun handleNativeRequest(method: String, payload: JSONObject, respond: (Any) -> Unit) {
        when (method) {
            "hello" -> {
                if (!connection.handshake(payload.optInt("protocol"))) {
                    respond(false); return
                }
                respond(JSONObject().put("protocol", 1)
                    .put("appVersion", packageManager.getPackageInfo(packageName, 0).versionName)
                    .put("capabilities", org.json.JSONArray(listOf("settings-menu", "navigation-request-id", "web-state", "web-visibility", "push-token-refresh", "push-diagnostics", "action-menu")))
                    .put("insets", "native").put("typography", "platform"))
            }
            "webState" -> {
                webRevision = payload.optString("revision", "Unknown").take(80)
                serverProtocol = payload.optString("serverProtocol", "Unknown").take(40)
                if (payload.optBoolean("ready")) connection.ready()
                else connection.recover("web-startup", "Athena could not finish loading. Tap here to retry or check App settings.")
                respond(true)
            }
            "appSettings" -> { appSettings(); respond(true) }
            "actionMenu" -> {
                val model = NativeActionMenus.parse(payload)
                val view = web
                if (view == null || !foreground) respond(JSONObject().put("status", "dismissed"))
                else { visibility.clear(); actionMenus.show(model, view, respond) }
            }
            "dismissActionMenu" -> { actionMenus.dismiss(payload.getString("id")); respond(true) }
            "appSettingsMenu" -> {
                connection.settings(payload.optBoolean("mounted"), payload.optBoolean("rendered"))
                renderConnection(connection.state)
                respond(true)
            }
            "webVisibility" -> {
                connection.sessionConnected(payload.optBoolean("connected", connection.state.stage == ConnectionCoordinator.Stage.READY))
                if (connection.state.stage == ConnectionCoordinator.Stage.READY && web?.hasWindowFocus() == true) visibility.acknowledge(payload.optString("sessionId"))
                else visibility.clear()
                respond(true)
            }
            "pushDiagnostics" -> {
                val status = payload.optString("status").take(200)
                prefs.edit().putString("pushDeliveryStatus", status).apply()
                respond(true)
            }
            "permission" -> respond(notifications.permission())
            "requestPermission" -> {
                if (notifications.permission() == "default" && Build.VERSION.SDK_INT >= 33) {
                    if (permissionReply != null) { respond("default"); return }
                    permissionReply = { respond(it) }
                    prefs.edit().putBoolean("notificationAsked", true).apply()
                    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                } else respond(notifications.permission())
            }
            "notify" -> respond(notifications.show(origin, payload))
            "openSignIn" -> {
                val path = payload.getString("path")
                if (ServerAddress.belongsTo(origin + path, origin) && Uri.parse(path).path in listOf("/login", "/auth/login")) {
                    startSignIn(false, path) { respond(it) }
                } else respond(false)
            }
            "pushRegistration" -> {
                if (FirebaseApp.getApps(this).isEmpty()) { respond(JSONObject.NULL); return }
                val tokenVersion = pushRegistration.version()
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (!task.isSuccessful) { respond(JSONObject.NULL); return@addOnCompleteListener }
                    val deviceId = prefs.getString("deviceId", null) ?: java.util.UUID.randomUUID().toString().also {
                        prefs.edit().putString("deviceId", it).apply()
                    }
                    respond(pushRegistration.registration(task.result, tokenVersion).put("deviceId", deviceId)
                        .put("refreshKey", pushRegistration.refreshKey()))
                }
            }
            "pushEnabled" -> {
                val state = payload
                prefs.edit().putBoolean("pushEnabled", state.optBoolean("enabled"))
                    .putBoolean("pushVersioned", state.has("tokenVersion"))
                    .putString("pushBinding", state.optString("bindingId")).apply()
                val token = state.optString("token")
                if (state.optBoolean("enabled") && token.isNotEmpty()) {
                    pushRegistration.acknowledged(token, if (state.has("tokenVersion")) state.getLong("tokenVersion") else null)
                    pushRegistration.schedule()
                }
                respond(true)
            }
            "navigationReady" -> {
                val result = payload
                if (result.optString("requestId") != navigationId) { respond(false); return }
                val action = navigationAction; navigationAction = null; navigationId = null
                respond(true)
                if (result.optBoolean("ready")) action?.invoke()
                else if (action != null) Toast.makeText(this, result.optString("reason", "Finish active work before leaving."), Toast.LENGTH_LONG).show()
            }
            else -> throw NativeBridge.UnsupportedMethod()
        }
    }

    private fun appSettings() {
        visibility.clear()
        nativeSettings.show(origin, ::diagnostics, NativeAppSettings.Actions(
            notifications = { startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)) },
            changeServer = {
                MaterialAlertDialogBuilder(this).setTitle("Change Athena server?")
                    .setMessage("Finish active replies and recordings first. Saved drafts remain on this device for the current server.")
                    .setNegativeButton(R.string.cancel, null).setPositiveButton(R.string.change_server) { _, _ ->
                        prepareNavigation(allowUnloaded = true) { web?.destroy(); web = null; setup() }
                    }.show()
            },
            signIn = { startSignIn(true) },
            reload = {
                MaterialAlertDialogBuilder(this).setTitle("Reload Athena?")
                    .setMessage("Finish active replies and recordings first.")
                    .setNegativeButton(R.string.cancel, null).setPositiveButton(R.string.reload) { _, _ -> reconnectAthena() }.show()
            }
        ))
    }

    private fun reconnectAthena() {
        val view = web
        if (view == null) { openServer(null); return }
        // Access can interrupt the first navigation before WebView has a page to reload.
        val target = view.url?.takeIf {
            ServerAddress.belongsTo(it, origin) && Uri.parse(it).path == "/" && Uri.parse(it).query == null
        } ?: "$origin/"
        prepareNavigation(allowUnloaded = true) { view.loadUrl(target) }
    }

    private fun prepareNavigation(allowUnloaded: Boolean = false, action: () -> Unit) {
        val view = web ?: run { action(); return }
        if (navigationAction != null) {
            Toast.makeText(this, "Wait for the current navigation check to finish.", Toast.LENGTH_SHORT).show()
            return
        }
        if (allowUnloaded && (view.url.isNullOrBlank() || view.url == "about:blank")) {
            navigationAction = null
            action()
            return
        }
        navigationAction = action
        val requestId = java.util.UUID.randomUUID().toString()
        navigationId = requestId
        view.evaluateJavascript("window.dispatchEvent(new CustomEvent('athena:prepare-native-navigation', {cancelable:true,detail:{requestId:'$requestId'}}))") { unhandled ->
            if (allowUnloaded && unhandled == "true" && navigationAction === action) {
                navigationAction = null; navigationId = null; action()
            }
        }
        view.postDelayed({
            if (navigationAction === action) {
                navigationAction = null; navigationId = null
                Toast.makeText(this, "Athena did not confirm your draft is saved. Update the server or finish connecting before leaving.", Toast.LENGTH_LONG).show()
            }
        }, 6000)
    }

    private fun errorScreen(message: String) {
        actionMenus.dismiss()
        visibility.clear()
        connection.recover("web-unreachable", message)
        connectionStatus = null
        container.removeAllViews()
        val screen = layoutInflater.inflate(R.layout.screen_recovery, container, false)
        screen.findViewById<TextView>(R.id.recovery_message).text = message
        screen.findViewById<View>(R.id.reconnect).setOnClickListener { web?.destroy(); web = null; openServer(null) }
        screen.findViewById<View>(R.id.server_settings).setOnClickListener { web?.destroy(); web = null; setup() }
        container.addView(screen)
    }

    private fun external(uri: Uri) {
        if (uri.scheme !in listOf("https", "http", "mailto", "tel")) return
        try { startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
        catch (_: ActivityNotFoundException) { Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show() }
    }

    private fun openNotification(intent: Intent?) {
        val target = intent?.dataString ?: return
        if (intent.action == "com.athena.android.OPEN_CONVERSATION" && ServerAddress.belongsTo(target, origin) &&
            Uri.parse(target).path == "/" && Uri.parse(target).query == null) {
            prepareNavigation(allowUnloaded = true) {
                web?.loadUrl(target)
                intent.data = null
            }
        }
    }
    private fun startSignIn(access: Boolean, path: String = "/login", started: (Boolean) -> Unit = {}) {
        visibility.clear()
        authentication.start(origin, access, path, started)
    }

    private fun renderConnection(state: ConnectionCoordinator.State) {
        nativeToolbar?.visibility = if (connection.settingsReady && state.stage == ConnectionCoordinator.Stage.READY) View.GONE else View.VISIBLE
        connectionStatus?.apply {
            text = state.message
            visibility = if (state.stage in listOf(ConnectionCoordinator.Stage.READY, ConnectionCoordinator.Stage.SETUP)) View.GONE else View.VISIBLE
            contentDescription = state.message + ". Tap for connection actions."
        }
    }

    private fun diagnostics(): AppDiagnostics = AppDiagnostics.capture(this, origin, connection, webRevision, serverProtocol)

    override fun onConfigurationChanged(configuration: android.content.res.Configuration) {
        super.onConfigurationChanged(configuration)
        val nextMode = configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK
        if (nextMode == nightMode) return
        nightMode = nextMode
        // Restyle native surfaces without recreating an active chat or recording.
        theme.setTo(resources.newTheme().apply { applyStyle(R.style.AppTheme, true) })
        DynamicColors.applyToActivityIfAvailable(this)
        enableEdgeToEdge()
        container.setBackgroundColor(MaterialColors.getColor(container, com.google.android.material.R.attr.colorSurface))
        val input = findViewById<TextInputEditText>(R.id.server_address)
        val recovery = findViewById<TextView>(R.id.recovery_message)
        if (input != null) {
            val value = input.text.toString()
            val error = findViewById<TextInputLayout>(R.id.server_input).error
            setup()
            findViewById<TextInputEditText>(R.id.server_address).setText(value)
            findViewById<TextInputLayout>(R.id.server_input).error = error
        } else if (recovery != null) errorScreen(recovery.text.toString())
        else (nativeToolbar as? MaterialToolbar)?.apply {
            setBackgroundColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorSurface))
            setTitleTextColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorOnSurface))
        }
        val showSettings = nativeSettings.isShowing
        val showDetails = nativeSettings.detailsShowing
        nativeSettings.dismiss()
        if (showDetails) nativeSettings.showDetails(diagnostics()) else if (showSettings) appSettings()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus) visibility.clear()
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); if (authentication.receive(intent.data, origin)) intent.data = null else openNotification(intent) }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); web?.saveState(outState) }
    override fun onResume() { super.onResume(); foreground = true; pushRegistration.schedule(); web?.onResume(); CookieManager.getInstance().flush(); if (origin.isNotEmpty()) { authentication.resume(origin) } }
    override fun onPause() { actionMenus.dismiss(); foreground = false; visibility.clear(); CookieManager.getInstance().flush(); web?.onPause(); super.onPause() }
    private fun navigateBack() {
        if (editingServer) { openServer(null); return }
        if (web?.canGoBack() == true) web?.goBack() else moveTaskToBack(true)
    }
    override fun onDestroy() { actionMenus.dismiss(); nativeSettings.dismiss(); fileReply?.onReceiveValue(null); microphoneRequest?.deny(); authentication.close(); web?.destroy(); super.onDestroy() }
    private fun Int.dp(): Int = (this * resources.displayMetrics.density).toInt()
}
