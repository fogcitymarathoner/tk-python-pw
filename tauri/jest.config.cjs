/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  moduleNameMapper: {
    "\\.(css|less|scss)$": "identity-obj-proxy",
    "^@tauri-apps/api/core$": "<rootDir>/src/test/mocks/tauri.ts",
  },
  transform: {
    "^.+\\.(t|j)sx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.jest.json",
      },
    ],
  },
  transformIgnorePatterns: ["node_modules/(?!(@tanstack)/)"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/main.tsx",
    "!src/vite-env.d.ts",
    "!src/test/**",
    "!src/**/*.test.{ts,tsx}",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80,
    },
  },
};
