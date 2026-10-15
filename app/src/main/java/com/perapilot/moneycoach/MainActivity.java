package com.perapilot.moneycoach;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int REQ_FILE_CHOOSER = 4101;
    private static final int REQ_SAVE_BACKUP = 4102;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingBackupJson;
    private String pendingBackupName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.rgb(6, 22, 17));
        getWindow().setNavigationBarColor(Color.rgb(6, 22, 17));

        try {
            webView = new WebView(this);
            webView.setBackgroundColor(Color.rgb(6, 22, 17));
            setContentView(webView);

            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);
            settings.setAllowContentAccess(true);
            settings.setLoadsImagesAutomatically(true);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);

            webView.addJavascriptInterface(new AndroidBridge(), "Android");
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (url != null && url.startsWith("file:///android_asset/index.html")) {
                        view.evaluateJavascript(
                                "(function(){var s=document.createElement('script');s.src='fix25.js';s.onload=function(){console.log('PeraPilot 2.6 cutoff-plan patch loaded')};document.head.appendChild(s);})()",
                                null
                        );
                    }
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    super.onReceivedError(view, request, error);
                }
            });
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onShowFileChooser(WebView webView,
                                                 ValueCallback<Uri[]> filePathCallbackNew,
                                                 FileChooserParams fileChooserParams) {
                    if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                    filePathCallback = filePathCallbackNew;
                    try {
                        Intent intent = fileChooserParams.createIntent();
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        startActivityForResult(intent, REQ_FILE_CHOOSER);
                        return true;
                    } catch (Exception e) {
                        filePathCallback = null;
                        Toast.makeText(MainActivity.this, "File picker unavailable", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                }
            });

            if (savedInstanceState == null) {
                webView.loadUrl("file:///android_asset/index.html");
            } else {
                webView.restoreState(savedInstanceState);
            }
        } catch (Throwable t) {
            Toast.makeText(this, "PeraPilot could not start: " + t.getClass().getSimpleName(), Toast.LENGTH_LONG).show();
            finish();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }

        if (requestCode == REQ_SAVE_BACKUP) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingBackupJson != null) {
                try (OutputStream os = getContentResolver().openOutputStream(data.getData())) {
                    if (os != null) {
                        os.write(pendingBackupJson.getBytes(StandardCharsets.UTF_8));
                        os.flush();
                        Toast.makeText(this, "Backup saved", Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(this, "Could not save backup", Toast.LENGTH_LONG).show();
                }
            }
            pendingBackupJson = null;
            pendingBackupName = null;
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void saveBackup(String json, String filename) {
            runOnUiThread(() -> {
                pendingBackupJson = json;
                pendingBackupName = (filename == null || filename.trim().isEmpty())
                        ? "PeraPilot_V2_6_Backup.json" : filename;

                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, pendingBackupName);

                try {
                    startActivityForResult(intent, REQ_SAVE_BACKUP);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Cannot open save dialog", Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public String appVersion() {
            return "2.6.0";
        }
    }
}
