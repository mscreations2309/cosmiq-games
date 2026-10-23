package com.cosmiq.games

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import java.util.concurrent.Executors

/**
 * Saves files the web pages "download" (e.g. Quiz Show's JSON export).
 * Android 10+: written straight to Downloads. Older: the user picks where to save.
 * Must be created in onCreate, because it registers an activity-result launcher.
 */
class DownloadSaver(private val activity: ComponentActivity) {

    private val io = Executors.newSingleThreadExecutor()
    private var pendingBytes: ByteArray? = null

    private val createDocument =
        activity.registerForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
            val bytes = pendingBytes
            pendingBytes = null
            if (uri != null && bytes != null) io.execute { write(uri, bytes) }
        }

    fun save(name: String, dataUrl: String) {
        val (mime, bytes) = decode(dataUrl) ?: return toast(R.string.download_failed)
        val fileName = name.ifBlank { "download" }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            io.execute { saveToDownloads(fileName, mime, bytes) }
        } else {
            pendingBytes = bytes
            createDocument.launch(fileName)
        }
    }

    private fun saveToDownloads(name: String, mime: String, bytes: ByteArray) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        val resolver = activity.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: return toast(R.string.download_failed)
        val ok = write(uri, bytes, notify = false)
        if (ok) {
            resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            toast(R.string.download_saved)
        } else {
            resolver.delete(uri, null, null)
        }
    }

    private fun write(uri: Uri, bytes: ByteArray, notify: Boolean = true): Boolean {
        val ok = runCatching {
            activity.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
        }.isSuccess
        if (notify || !ok) toast(if (ok) R.string.download_saved else R.string.download_failed)
        return ok
    }

    private fun toast(res: Int) {
        activity.runOnUiThread { Toast.makeText(activity, res, Toast.LENGTH_SHORT).show() }
    }

    companion object {
        /** data:<mime>[;base64],<payload> → (mime, bytes) */
        fun decode(dataUrl: String): Pair<String, ByteArray>? {
            if (!dataUrl.startsWith("data:")) return null
            val comma = dataUrl.indexOf(',')
            if (comma < 0) return null
            val meta = dataUrl.substring(5, comma)
            val payload = dataUrl.substring(comma + 1)
            val mime = meta.substringBefore(';').ifBlank { "application/octet-stream" }
            val bytes = if (meta.endsWith(";base64")) {
                runCatching { Base64.decode(payload, Base64.DEFAULT) }.getOrNull() ?: return null
            } else {
                Uri.decode(payload).toByteArray()
            }
            return mime to bytes
        }

        /** Runs in every page: turns <a download href="blob:/data:"> clicks into a message to the app. */
        const val PAGE_SCRIPT = """
(function () {
  if (window.__cosmiqDownloads || !window.CosmiqBridge) return;
  window.__cosmiqDownloads = true;
  function isDownload(a) {
    return a && a.hasAttribute && a.hasAttribute('download') && /^(blob:|data:)/.test(a.href);
  }
  function send(a) {
    var name = a.getAttribute('download') || 'download';
    fetch(a.href).then(function (r) { return r.blob(); }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(fr.result); };
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
    }).then(function (dataUrl) {
      CosmiqBridge.postMessage(JSON.stringify({ type: 'download', name: name, dataUrl: dataUrl }));
    }).catch(function (e) { console.error('Download failed', e); });
  }
  var nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isDownload(this)) { send(this); return; }
    return nativeClick.call(this);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (isDownload(a)) { e.preventDefault(); send(a); }
  }, true);
})();
"""
    }
}
