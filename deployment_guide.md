# Production Deployment Guide (Render + Netlify + Android WebView)

Follow this step-by-step guide to deploy the Stock RSI Dashboard completely online, running 24/7 in production without needing your PC to stay turned on.

---

## Part 1: Deploy Backend Proxy on Render.com (24/7 Online API)

Render will host the Node.js backend (`server.js`) on a free tier web service, running it 24/7 over secure HTTPS.

### Steps:
1. **Prepare GitHub Repository**:
   - Push the contents of the new folder `nse-rsi-backend-new` (excluding `node_modules` and `./dist`) to a private or public repository on GitHub.
2. **Sign in to Render**:
   - Visit [Render.com](https://render.com) and sign up/login using your GitHub account.
3. **Create a New Web Service**:
   - Click **`New +`** in the dashboard and select **`Web Service`**.
   - Connect your GitHub repository.
4. **Configure Settings**:
   - **Name**: `nse-rsi-backend`
   - **Region**: Select the closest region (e.g., Singapore or Oregon).
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start` (which runs `node server.js`).
5. **Set Environment Variables**:
   - Click **`Advanced`** or navigate to the **`Environment`** tab.
   - Add these keys:
     - `PORT` = `10000` (Render defaults to this, but defining it is safer).
     - `MOCK_MODE` = `false` (forces Yahoo Finance live API connections).
6. **Deploy**:
   - Click **`Create Web Service`**.
   - Once deployment completes, copy the secure HTTPS URL provided at the top left of your service dashboard:
     `https://nse-rsi-backend.onrender.com`

---

## Part 2: Deploy Frontend on Netlify.com (Static Hosting)

Netlify will host the compiled static frontend files (`index.html`, `manifest.json`, `sw.js`, `_redirects`) and inject the production backend URL during build time.

### Steps:
1. **Sign in to Netlify**:
   - Visit [Netlify.com](https://netlify.com) and log in using your GitHub account.
2. **Import Project**:
   - Click **`Add new site`** $\rightarrow$ **`Import an existing project`**.
   - Choose GitHub and connect your repository.
3. **Configure Build Settings**:
   - **Branch to deploy**: `main`
   - **Build Command**: `npm run build`
   - **Publish directory**: `dist`
4. **Set Environment Variables**:
   - Click **`Add Environment Variables`**.
   - Add the following variable:
     - **Key**: `BACKEND_URL`
     - **Value**: `https://nse-rsi-backend.onrender.com` (Your Render backend HTTPS URL copied in Part 1).
5. **Deploy**:
   - Click **`Deploy site`**.
   - Once completed, Netlify will generate a production link (e.g., `https://your-app-name.netlify.app`).

---

## Part 3: Deploy Android WebView APK (Android Mobile App)

To convert this production Netlify web app into an Android APK, use standard WebView containers or PWABuilder.

### Option A: Using PWABuilder (Recommended & Easiest)
1. Copy your live Netlify website URL (e.g. `https://your-app-name.netlify.app`).
2. Go to **[PWABuilder.com](https://www.pwabuilder.com/)**.
3. Paste the URL and click **`Start`**. PWABuilder will automatically download your `manifest.json` and verify its details.
4. Click **`Generate APK`**.
5. Download your signed Android App package (`.apk` or `.aab` for Play Store).

### Option B: Native Android Studio WebView Container
If you are compiling inside Android Studio, ensure the following configurations are added:

1. **Internet Permissions** (`AndroidManifest.xml`):
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   ```
2. **WebView Client Settings** (`MainActivity.java`):
   ```java
   WebView webView = findViewById(R.id.webview);
   WebSettings webSettings = webView.getSettings();
   webSettings.setJavaScriptEnabled(true);
   webSettings.setDomStorageEnabled(true); // REQUIRED for localStorage backend persistence!
   webSettings.setDatabaseEnabled(true);
   
   // Direct WebView navigation to handle links inside the container
   webView.setWebViewClient(new WebViewClient() {
       @Override
       public boolean shouldOverrideUrlLoading(WebView view, String url) {
           view.loadUrl(url);
           return true;
       }
   });
   
   webView.loadUrl("https://your-app-name.netlify.app");
   ```

---

## Part 4: Production Verification Checklist
- [ ] Open your Render health check URL in browser: `https://nse-rsi-backend.onrender.com/health` (should return `{"status":"ok"}`).
- [ ] Open your Netlify page link on PC and Mobile browsers.
- [ ] Verify that the header shows `SERVER STATUS: ONLINE` in green and loading indicators display when refreshing.
- [ ] Click `Retry Connection` to confirm retry mechanics work.
- [ ] Install the APK on your phone and verify that it loads the tables and custom charts smoothly.
