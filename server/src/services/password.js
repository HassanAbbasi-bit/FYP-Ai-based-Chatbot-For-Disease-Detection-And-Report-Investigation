const argon2 = require("argon2");
const { randomBytes } = require("node:crypto");
const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const hashPassword = (password) => argon2.hash(password, options);
let dummyHash;
async function verifyPassword(hash, password) {
  // Unknown accounts also incur hash verification work.
  if (!dummyHash) dummyHash = hashPassword(randomBytes(32).toString("hex"));
  return argon2.verify(hash || await dummyHash, password);
}
module.exports = { hashPassword, verifyPassword };
