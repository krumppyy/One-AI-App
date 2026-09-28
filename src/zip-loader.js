// One AI Studio - Safe ES Module Loader for JSZip
let _jszipPromise = null;

export async function getJSZip() {
  if (window.JSZip) return window.JSZip;
  if (_jszipPromise) return _jszipPromise;

  _jszipPromise = new Promise((resolve, reject) => {
    // 1. Try local vendor script
    const script = document.createElement("script");
    script.src = "src/vendor/jszip.min.js";
    script.onload = () => {
      if (window.JSZip) resolve(window.JSZip);
      else reject(new Error("JSZip not found on window after loading script"));
    };
    script.onerror = () => {
      // 2. Try node_modules fallback
      const fb = document.createElement("script");
      fb.src = "node_modules/jszip/dist/jszip.min.js";
      fb.onload = () => {
        if (window.JSZip) resolve(window.JSZip);
        else reject(new Error("JSZip not found on window"));
      };
      fb.onerror = () => {
        // 3. CDN fallback
        const cdn = document.createElement("script");
        cdn.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        cdn.onload = () => {
          if (window.JSZip) resolve(window.JSZip);
          else reject(new Error("JSZip not found on window from CDN"));
        };
        cdn.onerror = (e) => reject(new Error("Failed to load JSZip: " + e));
        document.head.appendChild(cdn);
      };
      document.head.appendChild(fb);
    };
    document.head.appendChild(script);
  });

  return _jszipPromise;
}
