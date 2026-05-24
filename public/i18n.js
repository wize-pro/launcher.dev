// Universal i18n helper. Works in Node (module.exports) and the browser (window.I18n).
// Pure functions, no dependencies — shared by server.js (require) and index.html (<script>).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18n = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Look up `key` in the active language, fall back to English, then to the key itself.
  // Replace {placeholders} from `params`.
  function translate(catalogs, lang, key, params) {
    const active = (catalogs && catalogs[lang]) || {};
    const base = (catalogs && catalogs.en) || {};
    let str = key in active ? active[key] : (key in base ? base[key] : key);
    if (params) {
      for (const k of Object.keys(params)) {
        if (params[k] != null) {
          str = str.split('{' + k + '}').join(String(params[k]));
        }
      }
    }
    return str;
  }

  // Map a navigator/OS language tag to a supported language code, else 'en'.
  function detectLang(navLang, supported) {
    const base = String(navLang || '').slice(0, 2).toLowerCase();
    return supported.includes(base) ? base : 'en';
  }

  return { translate, detectLang };
});
