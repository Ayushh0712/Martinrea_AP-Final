/**
 * End-to-end Jest config.
 *
 * Picks up `*.e2e-spec.ts` files anywhere under `test/` so end-to-end
 * suites can live alongside their fixtures without colliding with the
 * unit-test runner (`npm test`), which only collects `*.spec.ts`.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleDirectories: ['node_modules', '<rootDir>'],
  // No e2e specs exist yet -- the suite is added per channel as real
  // infrastructure (Graph, SFTP, Blob) lands. Don't fail the runner in the
  // meantime so CI can wire `npm run test:e2e` as a gate from day one.
  passWithNoTests: true,
};
