import fs from "node:fs";

const stripProse = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/("""|''')[\s\S]*?\1/g, "");

for (const f of ["app/api/auth/request-email-otp/route.ts", "app/api/auth/verify-email-otp/route.ts"]) {
  const code = stripProse(fs.readFileSync(f, "utf8"));
  const m = code.match(/BACKEND_URL\s*\|\||process\.env\.PROVISION_API_URL/);
  console.log("=== " + f);
  console.log("  match:", m ? JSON.stringify(m[0]) : "none");
  if (m) {
    const i = code.indexOf(m[0]);
    console.log("  context: " + JSON.stringify(code.slice(Math.max(0, i - 220), i + 180)));
  }
}