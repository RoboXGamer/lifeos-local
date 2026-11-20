import assert from "node:assert/strict";
import { createStore } from "solid-js";
import { configureServerFunctionsClient, createServerReference } from "../node_modules/@solidjs/web/server-functions/dist/client.dev.js";
import { toTransportValue } from "../src/local/transport.ts";

let sent;
configureServerFunctionsClient({
  fetch: (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(null, { status: 204, headers: { "X-Content-Raw": "1" } });
  },
});

const call = createServerReference("transport-check");
const [store] = createStore({ name: "Work", optional: undefined, nested: { text: "draft", empty: null }, tags: ["one"] });
await assert.rejects(() => call("areas.create", store), /not JSON-serializable/);
await call("areas.create", toTransportValue(store));
assert.deepEqual(sent, ["areas.create", { name: "Work", nested: { text: "draft", empty: null }, tags: ["one"] }]);
assert.throws(() => toTransportValue([undefined]), /undefined/);
assert.throws(() => toTransportValue([,]), /Missing array element/);
assert.throws(() => toTransportValue({ value: NaN }), /Unsupported number/);
const circular = {}; circular.self = circular;
assert.throws(() => toTransportValue(circular), /Circular/);
console.log("Solid mutation transport accepts normalized form arguments.");
