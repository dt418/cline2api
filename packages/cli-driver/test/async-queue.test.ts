import { describe, expect, it } from "vitest";
import { AsyncQueue } from "../src/async-queue.js";

describe("AsyncQueue", () => {
  it("delivers a pushed value to a pending reader", async () => {
    const queue = new AsyncQueue<string>();
    const pending = queue[Symbol.asyncIterator]().next();

    queue.push("chunk");

    await expect(pending).resolves.toEqual({ value: "chunk", done: false });
  });

  it("drains buffered values before reporting completion", async () => {
    const queue = new AsyncQueue<string>();
    queue.push("first");
    queue.close();

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: "first", done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it("rejects every pending reader when it closes with an error", async () => {
    const queue = new AsyncQueue<string>();
    const first = queue[Symbol.asyncIterator]().next();
    const second = queue[Symbol.asyncIterator]().next();

    queue.close(new Error("transport failed"));

    await expect(first).rejects.toThrow("transport failed");
    await expect(second).rejects.toThrow("transport failed");
  });
});
