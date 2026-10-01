import nextConfig from "eslint-config-next";

/** eslint-config-next ships a native flat-config array — no legacy bridge needed. */
const eslintConfig = [
  ...nextConfig,
  {
    ignores: [".next/**", "node_modules/**", "npm-cache/**"],
  },
];

export default eslintConfig;
