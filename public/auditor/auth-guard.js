/**
 * ALS Consulting — Auditor Auth Guard
 * public/auditor/auth-guard.js
 *
 * Include this script at the TOP of every auditor screen.
 * If no valid session token exists, redirects to login immediately.
 *
 * Usage — add this line inside <head> of every auditor screen:
 *   <script src="auth-guard.js"><\/script>
 */

(function() {
  const token = sessionStorage.getItem("als_auditor_token");

  if (!token) {
    // No token — redirect to login immediately before page renders
    window.location.replace("login.html");
    return;
  }

  // Token exists — allow page to load
  // The token is checked server-side on any API calls
  // so even if someone guesses a token format, they cannot
  // access real audit data without the correct server-side key

  // Expose logout function globally for all auditor screens
  window.alsAuditorLogout = function() {
    sessionStorage.removeItem("als_auditor_token");
    window.location.replace("login.html");
  };
})();
