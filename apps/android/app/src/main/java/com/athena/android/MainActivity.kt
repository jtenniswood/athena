package com.athena.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
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
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging

class MainActivity : ComponentActivity() {
    companion object { @Volatile var foreground = false }
    private val prefs by lazy { getSharedPreferences("athena", MODE_PRIVATE) }
    private val notifications by lazy { NativeNotifications(this) }
    private val signIn by lazy { BrowserSignIn(this) { web?.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null) } }
    private val accessSignIn by lazy { AccessSignIn(this) { reconnectAthena() } }
    private var nativeToolbar: View? = null
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
        super.onCreate(savedInstanceState)
        container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(17, 17, 17))
            setOnApplyWindowInsetsListener { view, insets ->
                if (Build.VERSION.SDK_INT >= 30) {
                    val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime())
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                } else view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
                insets
            }
        }
        setContentView(container)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { navigateBack() }
        })
        origin = prefs.getString("origin", "") ?: ""
        if (origin.isEmpty()) setup() else openServer(savedInstanceState)
        accessSignIn.receive(intent?.data, origin)
    }

    private fun setup() {
        container.removeAllViews()
        val title = TextView(this).apply { text = "Connect to Athena"; textSize = 24f; setPadding(24, 48, 24, 16) }
        val help = TextView(this).apply { text = "Enter the HTTPS address of your Athena web app."; setPadding(24, 0, 24, 16) }
        val address = EditText(this).apply {
            hint = "https://athena.example.com"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(); setText(origin)
        }
        val connect = Button(this).apply {
            text = "Connect"
            setOnClickListener {
                try {
                    val next = ServerAddress.normalize(address.text.toString())
                    prefs.edit().putString("origin", next).apply()
                    origin = next
                    openServer(null)
                } catch (error: Exception) { address.error = error.message ?: "Invalid address" }
            }
        }
        container.addView(title); container.addView(help); container.addView(address); container.addView(connect)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openServer(state: Bundle?) {
        container.removeAllViews()
        val toolbar = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        toolbar.addView(TextView(this).apply { text = "  Athena"; textSize = 16f }, LinearLayout.LayoutParams(0, 48.dp(), 1f))
        toolbar.addView(Button(this).apply { text = "App settings"; setOnClickListener { appSettings() } })
        nativeToolbar = toolbar
        container.addView(toolbar)
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
                toolbar.visibility = View.VISIBLE
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.isForMainFrame && request.url.scheme == "https" &&
                    request.url.path?.startsWith("/cdn-cgi/access/") == true &&
                    (ServerAddress.belongsTo(request.url.toString(), origin) || request.url.host?.endsWith(".cloudflareaccess.com") == true)) {
                    toolbar.visibility = View.VISIBLE
                    accessSignIn.start(origin)
                    return true
                }
                if (request.isForMainFrame && ServerAddress.belongsTo(request.url.toString(), origin) &&
                    request.url.path in listOf("/login", "/auth/login")) {
                    toolbar.visibility = View.VISIBLE
                    signIn.start(origin, request.url.encodedPath + (request.url.encodedQuery?.let { "?$it" } ?: ""))
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
                container.removeView(view); view.destroy(); web = null
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
        container.addView(view, LinearLayout.LayoutParams(-1, 0, 1f))
        if (state == null || view.restoreState(state) == null) view.loadUrl(origin + "/")
        openNotification(intent)
    }

    private fun handleMessage(raw: String, reply: JavaScriptReplyProxy) {
        if (raw.length > 16000) return
        try {
            val message = JSONObject(raw)
            val id = message.getString("id").take(100)
            val respond: (Any) -> Unit = { value ->
                try { reply.postMessage(JSONObject().put("id", id).put("value", value).toString()) }
                catch (_: Exception) { /* The originating page may have closed during an Android prompt. */ }
            }
            when (message.getString("method")) {
                "appSettings" -> { appSettings(); respond(true) }
                "appSettingsMenu" -> {
                    nativeToolbar?.visibility = if (message.getJSONObject("payload").optBoolean("mounted")) View.GONE else View.VISIBLE
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
                "notify" -> respond(notifications.show(origin, message.getJSONObject("payload")))
                "openSignIn" -> {
                    val path = message.getJSONObject("payload").getString("path")
                    if (ServerAddress.belongsTo(origin + path, origin) && Uri.parse(path).path in listOf("/login", "/auth/login")) {
                        signIn.start(origin, path) { respond(it) }
                    } else respond(false)
                }
                "pushRegistration" -> {
                    if (FirebaseApp.getApps(this).isEmpty()) { respond(JSONObject.NULL); return }
                    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                        if (!task.isSuccessful) { respond(JSONObject.NULL); return@addOnCompleteListener }
                        val deviceId = prefs.getString("deviceId", null) ?: java.util.UUID.randomUUID().toString().also {
                            prefs.edit().putString("deviceId", it).apply()
                        }
                        prefs.edit().putString("pushToken", task.result).apply()
                        respond(JSONObject().put("deviceId", deviceId).put("token", task.result))
                    }
                }
                "pushEnabled" -> {
                    val state = message.getJSONObject("payload")
                    prefs.edit().putBoolean("pushEnabled", state.optBoolean("enabled"))
                        .putString("pushBinding", state.optString("bindingId")).apply()
                    respond(true)
                }
                "navigationReady" -> {
                    val action = navigationAction; navigationAction = null
                    val result = message.getJSONObject("payload")
                    respond(true)
                    if (result.optBoolean("ready")) action?.invoke()
                    else if (action != null) Toast.makeText(this, result.optString("reason", "Finish active work before leaving."), Toast.LENGTH_LONG).show()
                }
                else -> respond(false)
            }
        } catch (_: Exception) { /* Ignore malformed or stale bridge requests. */ }
    }

    private fun appSettings() {
        AlertDialog.Builder(this).setTitle("Athena app settings")
            .setItems(arrayOf("Android notification settings", "Change Athena server", "Reload Athena", "Sign in through Cloudflare Access")) { _, item ->
                when (item) {
                    3 -> accessSignIn.start(origin)
                    0 -> startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                    1 -> AlertDialog.Builder(this).setTitle("Change Athena server?")
                        .setMessage("Finish active replies and recordings first. Saved drafts remain on this device for the current server.")
                        .setNegativeButton("Cancel", null).setPositiveButton("Change server") { _, _ ->
                            prepareNavigation(allowUnloaded = true) { web?.destroy(); web = null; setup() }
                        }.show()
                    2 -> AlertDialog.Builder(this).setTitle("Reload Athena?")
                        .setMessage("Finish active replies and recordings first.")
                        .setNegativeButton("Cancel", null).setPositiveButton("Reload") { _, _ -> reconnectAthena() }.show()
                }
            }.show()
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
        val view = web ?: return
        if (allowUnloaded && (view.url.isNullOrBlank() || view.url == "about:blank")) {
            navigationAction = null
            action()
            return
        }
        navigationAction = action
        view.evaluateJavascript("window.dispatchEvent(new Event('athena:prepare-native-navigation', {cancelable:true}))") { unhandled ->
            if (allowUnloaded && unhandled == "true" && navigationAction === action) {
                navigationAction = null; action()
            }
        }
        view.postDelayed({
            if (navigationAction === action) {
                navigationAction = null
                Toast.makeText(this, "Athena did not confirm your draft is saved. Update the server or finish connecting before leaving.", Toast.LENGTH_LONG).show()
            }
        }, 6000)
    }

    private fun errorScreen(message: String) {
        container.removeAllViews()
        container.addView(TextView(this).apply { text = message; setPadding(24, 48, 24, 24) })
        container.addView(Button(this).apply { text = "Reconnect"; setOnClickListener { web?.destroy(); web = null; openServer(null) } })
        container.addView(Button(this).apply { text = "Server settings"; setOnClickListener { web?.destroy(); web = null; setup() } })
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
            web?.loadUrl(target)
            intent.data = null
        }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); if (accessSignIn.receive(intent.data, origin)) intent.data = null else openNotification(intent) }
    override fun onSaveInstanceState(state: Bundle) { super.onSaveInstanceState(state); web?.saveState(state) }
    override fun onResume() { super.onResume(); foreground = true; web?.onResume(); CookieManager.getInstance().flush(); if (origin.isNotEmpty()) signIn.resume(origin) }
    override fun onPause() { foreground = false; CookieManager.getInstance().flush(); web?.onPause(); super.onPause() }
    private fun navigateBack() {
        if (web?.canGoBack() == true) web?.goBack() else moveTaskToBack(true)
    }
    override fun onDestroy() { fileReply?.onReceiveValue(null); microphoneRequest?.deny(); signIn.close(); web?.destroy(); super.onDestroy() }
    private fun Int.dp(): Int = (this * resources.displayMetrics.density).toInt()
}
