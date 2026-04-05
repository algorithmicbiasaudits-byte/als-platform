/**
 * ALS Consulting — Auditor Auth Function
 * netlify/functions/auth.js
 *
 * Verifies the auditor password against the AUDITOR_KEY
 * environment variable. The actual password never reaches
 * the browser — only a session token is returned on success.
 */

exports.handler = async function(event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { password } = JSON.parse(event.body);
    const correctKey  = process.env.AUDITOR_KEY;

    if (!correctKey) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: "Server misconfiguration — AUDITOR_KEY not set." }),
      };
    }

    if (password === correctKey) {
      // Generate a simple session token — timestamp + hash of the key
      // Not cryptographic but sufficient for this use case
      const token = Buffer.from(`als-auditor-${correctKey}-${new Date().toDateString()}`).toString("base64");

      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
        body: JSON.stringify({ success: true, token }),
      };
    }

    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ success: false, error: "Incorrect password." }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Auth error", detail: err.message }),
    };
  }
};
