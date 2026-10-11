const validator = require("validator");
function validateAuth(body, registration) {
  const fields = registration ? ["name", "email", "password"] : ["email", "password"];
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !fields.includes(key))) return { error: "Only the documented account fields are allowed." };
  if (typeof body.email !== "string" || body.email.trim().length > 254 || !validator.isEmail(body.email.trim(), { allow_utf8_local_part: false })) return { error: "Enter a valid email address of at most 254 characters." };
  if (typeof body.password !== "string" || body.password.length < 15 || body.password.length > 128) return { error: "Password must be between 15 and 128 characters; spaces are allowed." };
  if (registration && (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80)) return { error: "Name must be between 1 and 80 characters." };
  return { value: { email: body.email.trim().toLowerCase(), password: body.password, ...(registration ? { name: body.name.trim() } : {}) } };
}
module.exports = { validateAuth };
