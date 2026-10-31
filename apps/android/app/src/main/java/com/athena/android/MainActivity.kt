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
    private var connectionScreen: View? = null
    private var connectionStatus: TextView? = null
    private var connectionAction: com.google.android.material.button.MaterialButton? = null
    private var documentReady = false
    private var navigationId: String? = null
    private var webRevision = "Unknown"
    private var serverProtocol = "Unknown"
    private val authentication by lazy { NativeAuthentication(this, connection, {
        web?.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null)
    }, { reconnectAthena() }) }
    private val appUpdates by lazy { AppUpdates(this) { action -> prepareNavigation(allowUnloaded = true, action = action) } }
    private val settingsPage by lazy { NativeSettingsPage(this) }
    private val nativeSettings by lazy { NativeAppSettings(this) }
    private var nativeToolbar: View? = null
    @Volatile private var connectionTest: ConnectionTest? = null
    private var connectionTestDialog: androidx.appcompat.app.AlertDialog? = null
    private var editingServer = false
    private var nightMode = 0
    private var web: WebView? = null
    private var origin = ""
    private var permissionReply: ((String) -> Unit)? = null
    private var microphoneRequest: PermissionRequest? = null
    private var settingsFilesMultiple = false
    private var settingsFilesReply: ((Any) -> Unit)? = null
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

    private val settingsFilePicker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val callback = settingsFilesReply; settingsFilesReply = null
        Thread {
            val files = org.json.JSONArray()
            try {
                var total = 0
                for (uri in if (settingsFilesMultiple) uris else uris.take(1)) {
                    val bytes = contentResolver.openInputStream(uri)?.use { stream ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (output.size() <= 2 * 1024 * 1024) {
                            val count = stream.read(buffer); if (count < 0) break
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray() } ?: continue
                    total += bytes.size
                    require(total <= 2 * 1024 * 1024) { "Configuration import exceeds 2 MiB." }
                    val name = contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    } ?: "configuration"
                    files.put(JSONObject().put("name", name).put("type", contentResolver.getType(uri) ?: "application/octet-stream")
                        .put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)))
                }
                runOnUiThread { callback?.invoke(files) }
            } catch (_: Exception) {
                runOnUiThread {
                    callback?.invoke(org.json.JSONArray())
                    android.widget.Toast.makeText(this, "Could not import files. Choose files totalling 2 MiB or less.", android.widget.Toast.LENGTH_LONG).show()
                }
            }
        }.start()
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
        connectionTest = null
        connection.setup()
        connectionScreen = null
        nativeToolbar = null
        connectionStatus = null
        connectionAction = null
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
        screen.findViewById<View>(R.id.connection_testing).setOnClickListener { showConnectionTests() }
        screen.findViewById<View>(R.id.cancel_connect).apply {
            visibility = if (editingServer) View.VISIBLE else View.GONE
            setOnClickListener { openServer(null) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openServer(state: Bundle?) {
        actionMenus.dismiss()
        editingServer = false
        documentReady = false
        connectionScreen = null
        connectionStatus = null
        connectionAction = null
        connection.loading()
        web?.destroy()
        web = null
        container.removeAllViews()
        connectionTest?.let { test ->
            val banner = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(16.dp(), 8.dp(), 16.dp(), 8.dp())
                setBackgroundColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorSecondaryContainer))
            }
            banner.addView(TextView(this).apply {
                text = getString(R.string.connection_test_active, test.title)
                setTextColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorOnSecondaryContainer))
            }, LinearLayout.LayoutParams(0, -2, 1f))
            banner.addView(com.google.android.material.button.MaterialButton(this).apply {
                id = R.id.end_connection_test
                setText(R.string.end_connection_test)
                setOnClickListener { endConnectionTest() }
            })
            container.addView(banner)
        }
        val documentOrigin = if (connectionTest != null) ConnectionTest.ORIGIN else origin
        val toolbar = MaterialToolbar(this).apply {
            setTitle(R.string.app_name)
            inflateMenu(R.menu.native_toolbar)
            setOnMenuItemClickListener { appSettings(); true }
        }
        nativeToolbar = toolbar
        container.addView(toolbar)
        val body = FrameLayout(this)
        container.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        val screen = layoutInflater.inflate(R.layout.screen_recovery, body, false)
        bindConnectionScreen(screen)
        body.addView(screen)
        renderConnection(connection.state)
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
        WebViewCompat.addWebMessageListener(view, "AthenaAndroid", setOf(documentOrigin)) { _, message, sourceOrigin, mainFrame, reply ->
            if (view === web && mainFrame && ServerAddress.belongsTo(sourceOrigin.toString(), documentOrigin) && ServerAddress.belongsTo(view.url, documentOrigin)) {
                handleMessage(message.data ?: "", reply)
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (ServerAddress.belongsTo(request.url.toString(), ConnectionTest.ORIGIN)) return connectionTest?.response()
                return null
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                if (view !== web) return
                settingsPage.dismiss()
                actionMenus.dismiss()
                visibility.clear()
                documentReady = false
                navigationAction = null; navigationId = null
                connection.loading()
                if (AccessDetection.loginUrl(url, origin)) accessRequired()
                else renderConnection(connection.state)
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (view !== web) return true
                if (request.isForMainFrame && AccessDetection.loginUrl(request.url.toString(), origin)) {
                    accessRequired()
                    return true
                }
                if (request.isForMainFrame && ServerAddress.belongsTo(request.url.toString(), origin) &&
                    request.url.path in listOf("/login", "/auth/login")) {
                    startSignIn(false, request.url.encodedPath + (request.url.encodedQuery?.let { "?$it" } ?: ""))
                    return true
                }
                if (ServerAddress.belongsTo(request.url.toString(), origin)) return false
                if (request.isForMainFrame) external(request.url)
                return true
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (view === web && request.isForMainFrame) errorScreen("Could not reach Athena. Check your connection and server address.", checkAccess = true)
            }
            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                if (view === web && request.isForMainFrame) errorScreen("The server returned HTTP ${response.statusCode}. Try again or check your server address and configuration.", checkAccess = response.statusCode in listOf(401, 403))
            }
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (view !== web) return true
                actionMenus.dismiss()
                (view.parent as? android.view.ViewGroup)?.removeView(view); view.destroy(); web = null
                errorScreen("Android closed the web renderer. Reopen Athena to reconnect.")
                return true
            }
        }
        view.webChromeClient = object : WebChromeClient() {
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
        body.addView(view, 0, FrameLayout.LayoutParams(-1, -1))
        renderConnection(connection.state)
        if (connectionTest != null || state == null || view.restoreState(state) == null) view.loadUrl(documentOrigin + "/")
        openNotification(intent)
    }

    private fun bindConnectionScreen(screen: View) {
        connectionScreen = screen
        connectionStatus = screen.findViewById(R.id.recovery_message)
        connectionAction = screen.findViewById<com.google.android.material.button.MaterialButton>(R.id.reconnect).apply {
            setOnClickListener {
                val current = connection.state
                if (current.stage in listOf(ConnectionCoordinator.Stage.ACCESS_SIGN_IN, ConnectionCoordinator.Stage.ATHENA_SIGN_IN)) {
                    authentication.cancel()
                    connection.recover("auth-cancelled", getString(R.string.sign_in_cancelled))
                } else if (current.code == "auth-access-required") startSignIn(true)
                else if (current.code?.startsWith("auth-") == true) authentication.retry(origin)
                else reconnectAthena()
            }
        }
        screen.findViewById<View>(R.id.review_settings).setOnClickListener { appSettings() }
    }

    private fun handleMessage(raw: String, reply: JavaScriptReplyProxy) {
        NativeBridge.receive(raw, { reply.postMessage(it) }, ::handleNativeRequest)
    }

    private fun handleNativeRequest(method: String, payload: JSONObject, respond: (Any) -> Unit) {
        when (method) {
            "hello" -> {
                if (!connection.handshake(payload.optInt("protocol"))) {
                    connection.recover("web-protocol", "This server uses an unsupported Android integration. Check the server version and configuration.")
                    respond(false); return
                }
                respond(JSONObject().put("protocol", 1)
                    .put("appVersion", packageManager.getPackageInfo(packageName, 0).versionName)
                    .put("capabilities", org.json.JSONArray(listOf("settings-menu", "navigation-request-id", "web-state", "web-visibility", "push-token-refresh", "push-diagnostics", "action-menu", "action-menu-live", "settings-page", "action-menu-search")))
                    .put("insets", "native").put("typography", "platform"))
            }
            "webState" -> {
                webRevision = payload.optString("revision", "Unknown").take(80)
                serverProtocol = payload.optString("serverProtocol", "Unknown").take(40)
                if (payload.optBoolean("ready")) { documentReady = true; connection.ready() }
                else {
                    connection.recover("web-startup", "Athena could not finish loading. Choose Try again or review settings.")
                    detectAccess(connection.state)
                }
                respond(true)
            }
            "settingsFiles" -> {
                if (!settingsPage.isShowing || !foreground) respond(org.json.JSONArray())
                else {
                    settingsFilesReply?.invoke(org.json.JSONArray()); settingsFilesReply = respond
                    settingsFilesMultiple = payload.optBoolean("multiple")
                    try { settingsFilePicker.launch(arrayOf("*/*")) }
                    catch (_: ActivityNotFoundException) { settingsFilesReply = null; respond(org.json.JSONArray()) }
                }
            }
            "settingsPage" -> {
                val model = NativeSettingsPage.parse(payload)
                if (web == null || !foreground) respond(JSONObject().put("status", "dismissed"))
                else { visibility.clear(); settingsPage.show(model, respond) }
            }
            "updateSettingsPage" -> respond(settingsPage.update(NativeSettingsPage.parse(payload)))
            "dismissSettingsPage" -> { settingsPage.dismiss(payload.getString("id")); respond(true) }
            "appSettings" -> { appSettings(); respond(true) }
            "actionMenu" -> {
                val model = NativeActionMenus.parse(payload)
                val view = web
                if (view == null || !foreground) respond(JSONObject().put("status", "dismissed"))
                else { visibility.clear(); actionMenus.show(model, view, respond) }
            }
            "dismissActionMenu" -> { actionMenus.dismiss(payload.getString("id")); respond(true) }
            "updateActionMenu" -> { respond(actionMenus.update(NativeActionMenus.parse(payload))) }
            "appSettingsMenu" -> {
                connection.settings(payload.optBoolean("mounted"), payload.optBoolean("rendered"))
                renderConnection(connection.state)
                respond(true)
            }
            "webVisibility" -> {
                connection.sessionConnected(payload.optBoolean("connected", connection.state.stage == ConnectionCoordinator.Stage.READY))
                if (connection.state.stage == ConnectionCoordinator.Stage.READY && !nativeSettings.isShowing && web?.hasWindowFocus() == true) visibility.acknowledge(payload.optString("sessionId"))
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
        nativeSettings.show(::diagnostics, NativeAppSettings.Actions(
            updates = { appUpdates.settings() },
            connectionTesting = { showConnectionTests() },
            testNotification = { testNotification() },
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

    private fun testNotification() {
        if (notifications.permission() == "default" && Build.VERSION.SDK_INT >= 33) {
            if (permissionReply != null) return
            permissionReply = { testNotification() }
            prefs.edit().putBoolean("notificationAsked", true).apply()
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        if (notifications.permission() != "granted") {
            MaterialAlertDialogBuilder(this).setTitle(R.string.test_notification)
                .setMessage(R.string.test_notification_blocked)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.notifications) { _, _ ->
                    startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                }.show()
            return
        }
        val sent = notifications.show(origin, JSONObject()
            .put("title", getString(R.string.test_notification_title))
            .put("body", getString(R.string.test_notification_body))
            .put("tag", "athena-test-notification"))
        Toast.makeText(this, if (sent) R.string.test_notification_sent else R.string.test_notification_failed, Toast.LENGTH_LONG).show()
        nativeSettings.refreshNotifications()
    }

    private fun showConnectionTests() {
        connectionTestDialog?.dismiss()
        val scenarios = ConnectionTest.entries
        connectionTestDialog = MaterialAlertDialogBuilder(this).setTitle(R.string.connection_testing)
            .setItems(scenarios.map { it.title }.toTypedArray()) { _, index -> startConnectionTest(scenarios[index]) }
            .setNegativeButton(R.string.cancel, null).show()
    }

    private fun startConnectionTest(test: ConnectionTest) {
        prepareNavigation(allowUnloaded = true) {
            authentication.cancel()
            nativeSettings.dismiss()
            connectionTest = test
            openServer(null)
        }
    }

    private fun endConnectionTest() {
        nativeSettings.dismiss()
        connectionTest = null
        if (origin.isBlank()) { web?.destroy(); web = null; setup() } else openServer(null)
    }

    private fun reconnectAthena() {
        if (connectionTest != null) { openServer(null); return }
        val view = web
        if (view == null) { openServer(null); return }
        // Access can interrupt the first navigation before WebView has a page to reload.
        val target = view.url?.takeIf {
            ServerAddress.belongsTo(it, origin) && Uri.parse(it).path == "/" && Uri.parse(it).query == null
        } ?: "$origin/"
        prepareNavigation(allowUnloaded = true) { view.loadUrl(target) }
    }

    private fun prepareNavigation(allowUnloaded: Boolean = false, action: () -> Unit) {
        // Test documents have no chat or composer; entering testing already saved real drafts.
        if (connectionTest != null) { action(); return }
        val view = web ?: run { action(); return }
        if (navigationAction != null) {
            Toast.makeText(this, "Wait for the current navigation check to finish.", Toast.LENGTH_SHORT).show()
            return
        }
        if (allowUnloaded && ((!documentReady && connection.state.stage == ConnectionCoordinator.Stage.RECOVERY) ||
                view.url.isNullOrBlank() || view.url == "about:blank")) {
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

    private fun accessRequired() {
        connection.recover("auth-access-required", "Sign in through Cloudflare Access to reconnect to Athena.")
    }

    private fun detectAccess(failure: ConnectionCoordinator.State) {
        if (connectionTest != null || origin.isEmpty()) return
        val requestedOrigin = origin
        val cookies = CookieManager.getInstance().getCookie(requestedOrigin)
        Thread {
            val required = try { AccessDetection.required(requestedOrigin, cookies) } catch (_: Exception) { false }
            runOnUiThread {
                // A late probe must never replace a retry, a new server or a successful connection.
                if (required && !isFinishing && !isDestroyed && origin == requestedOrigin && connection.state === failure) accessRequired()
            }
        }.start()
    }

    private fun errorScreen(message: String, checkAccess: Boolean = false) {
        settingsPage.dismiss()
        actionMenus.dismiss()
        visibility.clear()
        connection.recover("web-unreachable", message)
        if (checkAccess) detectAccess(connection.state)
        if (!documentReady) {
            web?.let { view ->
                (view.parent as? android.view.ViewGroup)?.removeView(view)
                view.destroy()
            }
            web = null
        }
    }

    private fun external(uri: Uri) {
        if (uri.scheme !in listOf("https", "http", "mailto", "tel")) return
        try { startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)) }
        catch (_: ActivityNotFoundException) { Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show() }
    }

    private fun openNotification(intent: Intent?) {
        if (connectionTest != null) return
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
        val ready = state.stage == ConnectionCoordinator.Stage.READY
        val recovery = state.stage == ConnectionCoordinator.Stage.RECOVERY
        val signingIn = state.stage in listOf(ConnectionCoordinator.Stage.ACCESS_SIGN_IN, ConnectionCoordinator.Stage.ATHENA_SIGN_IN)
        nativeToolbar?.visibility = if (ready && !connection.settingsReady) View.VISIBLE else View.GONE
        connectionScreen?.apply {
            visibility = if (ready) View.GONE else View.VISIBLE
            findViewById<View>(R.id.connection_progress).visibility = if (state.stage == ConnectionCoordinator.Stage.LOADING) View.VISIBLE else View.GONE
            findViewById<View>(R.id.review_settings).visibility = if (recovery) View.VISIBLE else View.GONE
        }
        connectionStatus?.text = state.message
        connectionAction?.apply {
            visibility = if (signingIn || recovery) View.VISIBLE else View.GONE
            setText(when {
                signingIn -> R.string.cancel_sign_in
                state.code == "auth-access-required" -> R.string.browser_sign_in
                else -> R.string.reconnect
            })
        }
        if (state.stage == ConnectionCoordinator.Stage.LOADING) {
            container.postDelayed({
                if (connection.state === state) {
                    connection.recover("web-timeout", "Athena has not finished connecting. Try again or review settings.")
                    detectAccess(connection.state)
                }
            }, 20000)
        }
    }

    private fun diagnostics(): AppDiagnostics = AppDiagnostics.capture(this, origin, connection, webRevision, serverProtocol, connectionTest?.title)

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
        if (input != null) {
            val value = input.text.toString()
            val error = findViewById<TextInputLayout>(R.id.server_input).error
            setup()
            findViewById<TextInputEditText>(R.id.server_address).setText(value)
            findViewById<TextInputLayout>(R.id.server_input).error = error
        } else {
            // Reinflate the host overlay without reloading the page or discarding drafts.
            connectionScreen?.let { previous ->
                val parent = previous.parent as? FrameLayout
                if (parent != null) {
                    val replacement = layoutInflater.inflate(R.layout.screen_recovery, parent, false)
                    parent.removeView(previous)
                    parent.addView(replacement)
                    bindConnectionScreen(replacement)
                    renderConnection(connection.state)
                }
            }
        }
        (nativeToolbar as? MaterialToolbar)?.apply {
            setBackgroundColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorSurface))
            setTitleTextColor(MaterialColors.getColor(this, com.google.android.material.R.attr.colorOnSurface))
        }
        nativeSettings.refresh()
        settingsPage.refresh()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus) visibility.clear()
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); if (authentication.receive(intent.data, origin)) intent.data = null else openNotification(intent) }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); if (connectionTest == null) web?.saveState(outState) }
    override fun onResume() { super.onResume(); foreground = true; appUpdates.check(); pushRegistration.schedule(); nativeSettings.refreshNotifications(); web?.onResume(); CookieManager.getInstance().flush(); if (origin.isNotEmpty()) { authentication.resume(origin) } }
    override fun onPause() { actionMenus.dismiss(); foreground = false; visibility.clear(); CookieManager.getInstance().flush(); web?.onPause(); super.onPause() }
    private fun navigateBack() {
        if (nativeSettings.navigateBack()) return
        if (settingsPage.back()) return
        if (editingServer) { openServer(null); return }
        if (web?.canGoBack() == true) web?.goBack() else moveTaskToBack(true)
    }
    override fun onDestroy() { connectionTestDialog?.dismiss(); appUpdates.close(); settingsFilesReply?.invoke(org.json.JSONArray()); settingsFilesReply = null; settingsPage.dismiss(); actionMenus.dismiss(); nativeSettings.dismiss(); fileReply?.onReceiveValue(null); microphoneRequest?.deny(); authentication.close(); web?.destroy(); super.onDestroy() }
    private fun Int.dp(): Int = (this * resources.displayMetrics.density).toInt()
}
