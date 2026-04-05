/**
 * ALS Consulting — Auditor Auth Guard
 * Include at top of every auditor screen inside <head>
 * <script src="auth-guard.js"><\/script>
 */
(function() {
  if (sessionStorage.getItem("als_auditor_auth") !== "1") {
    window.location.replace("index.html");
    return;
  }
  window.alsAuditorLogout = function() {
    sessionStorage.removeItem("als_auditor_auth");
    window.location.replace("index.html");
  };
})();
