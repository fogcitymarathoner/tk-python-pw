/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  moduleNameMapper: {
    "\\.(css)$": "identity-obj-proxy",
    "\\.(ico|png|svg|jpg|jpeg|gif)$": "<rootDir>/src/test/mocks/fileMock.ts",
    "^@tauri-apps/api/core$": "<rootDir>/src/test/mocks/tauri.ts",
    "^@tauri-apps/plugin-opener$": "<rootDir>/src/test/mocks/opener.ts",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.jest.json",
      },
    ],
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/main.ts",
    "!src/vite-env.d.ts",
    "!src/test/**",
    "!src/**/*.test.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90,
    },
  },
};
