import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom has no layout: cmdk scrolls the active item into view, which only needs to exist here.
Element.prototype.scrollIntoView = () => undefined;
