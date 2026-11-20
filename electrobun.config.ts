export default {
  app: {
    name: "LifeOS",
    identifier: "app.lifeos.desktop",
    version: process.env.LIFEOS_RELEASE_VERSION || "0.1.0",
  },
  build: {
    mainProcess: "zig",
    zig: { version: "0.17.0" },
    copy: { "dist/desktop-service": "lifeos-service" },
    win: { bundleCEF: false, bundleWGPU: false },
  },
  release: {
    baseUrl: process.env.LIFEOS_RELEASE_URL,
  },
};
