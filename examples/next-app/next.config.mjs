/** @type {import("next").NextConfig} */
export default {
  // The workspace packages ship TypeScript source, so Next compiles them the
  // same way it compiles this app. Without this they arrive untransformed.
  transpilePackages: ["@rulekitai/rulekit", "@rulekitai/ui"],
}
