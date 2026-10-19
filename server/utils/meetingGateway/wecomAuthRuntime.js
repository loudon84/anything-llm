const jwt = require("jsonwebtoken");
const { createWeComAuthService } = require("./wecomAuth");

function createWeComAuthRuntime({
  gateway,
  store,
  jwtSecret,
  cryptoConfig = null,
  ...options
} = {}) {
  if (typeof jwtSecret !== "string" || jwtSecret.length === 0) return null;
  return createWeComAuthService({
    ...options,
    gateway,
    store,
    cryptoConfig,
    jwt: {
      sign: (claims, expiresIn) => jwt.sign(claims, jwtSecret, { expiresIn }),
      verify: (token) => jwt.verify(token, jwtSecret),
    },
  });
}

module.exports = { createWeComAuthRuntime };
