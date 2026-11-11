import { beforeEach, describe, expect, it } from "vitest";
import { noticeTtl, useNoticesStore } from "./notices-store";

const store = () => useNoticesStore.getState();

describe("notices store", () => {
  beforeEach(() => useNoticesStore.setState({ notices: [] }));

  it("returns a distinct id for each notice", () => {
    const a = store().notify({ tone: "info", title: "a" });
    expect(store().notify({ tone: "info", title: "b" })).not.toBe(a);
  });

  it("turns a loading notice into its outcome", () => {
    const id = store().notify({ tone: "loading", title: "Pushing…" });
    store().update(id, { tone: "success", title: "Pushed" });
    expect(store().notices).toEqual([{ id, tone: "success", title: "Pushed" }]);
  });

  it("ignores an update of a notice already gone", () => {
    const id = store().notify({ tone: "loading", title: "Pushing…" });
    store().dismiss(id);
    store().update(id, { tone: "success" });
    expect(store().notices).toEqual([]);
  });

  it("dismisses only the given notice", () => {
    const a = store().notify({ tone: "info", title: "a" });
    store().notify({ tone: "info", title: "b" });
    store().dismiss(a);
    expect(store().notices.map((n) => n.title)).toEqual(["b"]);
  });

  it("keeps the five newest notices", () => {
    for (let i = 0; i < 7; i++) store().notify({ tone: "info", title: String(i) });
    expect(store().notices.map((n) => n.title)).toEqual(["2", "3", "4", "5", "6"]);
  });
});

describe("noticeTtl", () => {
  it("keeps errors until dismissed", () => expect(noticeTtl({ tone: "error" })).toBeNull());
  it("keeps loading notices until updated", () => expect(noticeTtl({ tone: "loading" })).toBeNull());
  it("closes a success after a few seconds", () => expect(noticeTtl({ tone: "success" })).toBe(4000));
  it("leaves time to reach for an action", () =>
    expect(noticeTtl({ tone: "info", action: { label: "Undo", run: () => {} } })).toBe(10_000));
});
