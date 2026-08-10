/** @type {import("next").NextConfig} */
export default {
  // The workspace packages ship TypeScript source, so Next compiles them the
  // same way it compiles this app. Without this they arrive untransformed.
  transpilePackages: [
    "@rulekitai/agent",
    "@rulekitai/corpus",
    "@rulekitai/pipeline",
    "@rulekitai/react",
    "@rulekitai/server",
    "@rulekitai/ui",
  ],
}
