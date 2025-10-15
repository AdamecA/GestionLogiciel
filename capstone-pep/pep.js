// pep.js (CommonJS)
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const jose = require("jose");

const {
  PORT = "8081",
  REQUIRED_ROLE = "study_A",
  ISSUER = "http://localhost:8080/realms/capstone",
  JWKS_URI = "http://localhost:8080/realms/capstone/protocol/openid-connect/certs",
  UPSTREAM_SPARQL
} = process.env;

if (!UPSTREAM_SPARQL) {
  console.error("Missing UPSTREAM_SPARQL");
  process.exit(1);
}

const jwks = jose.createRemoteJWKSet(new URL(JWKS_URI));
const app = express();

async function verify(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) {
    const err = new Error("Missing bearer");
    err.status = 401;
    throw err;
  }
  const token = h.slice("Bearer ".length);
  const { payload } = await jose.jwtVerify(token, jwks, { issuer: ISSUER });
  const roles = (payload && payload.realm_access && payload.realm_access.roles) || [];
  if (!roles.includes(REQUIRED_ROLE)) {
    const err = new Error("Insufficient role");
    err.status = 403;
    throw err;
  }
}

app.use("/sparql", async (req, res, next) => {
  try { await verify(req); next(); }
  catch (e) { res.status(e.status || 401).json({ error: e.message }); }
});

app.use("/sparql", createProxyMiddleware({
  target: UPSTREAM_SPARQL,
  changeOrigin: true,
  pathRewrite: { "^/sparql": "" }
}));

app.listen(Number(PORT), () => {
  console.log(`PEP on http://localhost:${PORT}/sparql -> ${UPSTREAM_SPARQL} (role: ${REQUIRED_ROLE})`);
});
