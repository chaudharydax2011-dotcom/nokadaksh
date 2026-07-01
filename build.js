const fs = require('fs');
const path = require('path');

// Ensure dist directory exists
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

// Read index.html
let indexContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Replace placeholder with production backend URL (ensuring it doesn't have trailing slash)
let backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
if (backendUrl.endsWith('/')) {
  backendUrl = backendUrl.slice(0, -1);
}
indexContent = indexContent.replace(/__BACKEND_URL_PLACEHOLDER__/g, backendUrl);

// Write index.html to dist
fs.writeFileSync(path.join(distDir, 'index.html'), indexContent);

// Copy manifest.json and sw.js
const manifestPath = path.join(__dirname, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  let manifestContent = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(path.join(distDir, 'manifest.json'), manifestContent);
}

const swPath = path.join(__dirname, 'sw.js');
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  fs.writeFileSync(path.join(distDir, 'sw.js'), swContent);
}

// Create Netlify _redirects file
fs.writeFileSync(path.join(distDir, '_redirects'), '/* /index.html 200\n');

console.log('Build completed successfully. Files generated in ./dist folder.');
