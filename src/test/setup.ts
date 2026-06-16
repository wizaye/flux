/**
 * Global test setup — imported before every test file via
 * `vitest.config.ts → test.setupFiles`.
 *
 * Extends Vitest's expect with @testing-library/jest-dom matchers
 * (toBeInTheDocument, toHaveTextContent, toBeVisible, …) so they
 * are available in all tests without per-file imports.
 */
import "@testing-library/jest-dom/vitest";
