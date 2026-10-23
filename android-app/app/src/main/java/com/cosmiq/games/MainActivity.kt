package com.cosmiq.games

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Full-screen WebView shell for the COSMIQ classroom games and piano.
 *
 * The web files are bundled in assets and served from https://appassets.androidplatform.net/assets/
 * through [WebViewAssetLoader], so they behave like a normal website (relative links, localStorage,
 * blob workers) while staying fully offline.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var downloads: DownloadSaver
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    // A page asked for the camera (camera input mode); answered once Android permission is known.
    private var pendingCameraRequest: PermissionRequest? = null

    private val cameraPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingCameraRequest ?: return@registerForActivityResult
            pendingCameraRequest = null
            if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
        }

    private val fileChooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            fileCallback?.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
            )
            fileCallback = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        downloads = DownloadSaver(this)
        webView = createWebView()
        setContentView(webView)
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(HOME_URL)
        }

        // Back goes back between pages; on the home page it just sends the app to the background.
        onBackPressedDispatcher.addCallback(this) {
            if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        pendingCameraRequest?.deny()
        pendingCameraRequest = null
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView.destroy()
        super.onDestroy()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        return WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            overScrollMode = View.OVER_SCROLL_NEVER
            isHapticFeedbackEnabled = false

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true                 // best scores, saved quizzes
                mediaPlaybackRequiresUserGesture = false // game sounds
                allowFileAccess = false                  // everything comes through the asset loader
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100                           // ignore the panel's font-size setting
                useWideViewPort = true
                loadWithOverviewMode = true
            }

            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                    // Anything outside the bundled games opens in the system browser.
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: ActivityNotFoundException) {
                        // No browser installed: stay in the game.
                    }
                    return true
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                        view.evaluateJavascript(DownloadSaver.PAGE_SCRIPT, null)
                    }
                }

                // The renderer was killed (e.g. low memory): rebuild it instead of crashing the app.
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    rebuildWebView()
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                // Only our bundled pages may use the camera, and only for video.
                override fun onPermissionRequest(request: PermissionRequest) {
                    val wantsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
                    if (request.origin.host != WebViewAssetLoader.DEFAULT_DOMAIN || !wantsCamera) {
                        request.deny()
                        return
                    }
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) ==
                        PackageManager.PERMISSION_GRANTED
                    ) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        pendingCameraRequest?.deny()
                        pendingCameraRequest = request
                        cameraPermission.launch(Manifest.permission.CAMERA)
                    }
                }

                override fun onPermissionRequestCanceled(request: PermissionRequest) {
                    if (pendingCameraRequest === request) pendingCameraRequest = null
                }

                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = callback
                    return try {
                        fileChooser.launch(params.createIntent())
                        true
                    } catch (_: ActivityNotFoundException) {
                        fileCallback = null
                        Toast.makeText(this@MainActivity, R.string.no_file_picker, Toast.LENGTH_LONG).show()
                        false
                    }
                }
            }

            installDownloadBridge(this)
        }
    }

    // Quiz Show exports JSON through <a download href="blob:…">, which WebView cannot download by itself.
    // A page script reads the blob and posts it here as a data: URL.
    private fun installDownloadBridge(view: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        val origins = setOf(ORIGIN)
        WebViewCompat.addWebMessageListener(view, "CosmiqBridge", origins) { _, message, _, _, _ ->
            val json = runCatching { JSONObject(message.data ?: return@addWebMessageListener) }.getOrNull()
                ?: return@addWebMessageListener
            if (json.optString("type") == "download") {
                downloads.save(json.optString("name", "download"), json.optString("dataUrl"))
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(view, DownloadSaver.PAGE_SCRIPT, origins)
        }
    }

    private fun rebuildWebView() {
        val old = webView
        webView = createWebView()
        setContentView(webView)
        old.destroy()
        webView.loadUrl(HOME_URL)
    }

    private companion object {
        const val ORIGIN = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}"
        const val HOME_URL = "$ORIGIN/assets/games/index.html"
    }
}
