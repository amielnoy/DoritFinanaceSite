import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest does not auto-clean between tests the way Jest's RTL preset does.
afterEach(() => cleanup());
