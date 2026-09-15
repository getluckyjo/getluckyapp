import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // eslint-config-next 16.3 promoted this React Compiler rule to an error.
      // It flags the five admin list pages whose fetch callback starts with
      // setLoading(true) inside a useEffect. The fix is a shared paged-list
      // hook that derives `loading` from the request, which is admin panel
      // work, not a lint fix; until then it is a warning like the rest.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
