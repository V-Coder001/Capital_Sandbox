import { test } from "node:test";
import assert from "node:assert/strict";
import { orderPruefen, agentFragen, schluesselVorhanden } from "./agent.js";

const kurse = { Stahl: 10, Brot: 5 };
const bestand = { Stahl: 100, Brot: 0 };
const ctx = { bestand, bargeld: 1000, kurse };

test("ungültiges JSON wird verworfen", () => {
  assert.equal(orderPruefen("kein json", ctx), null);
});
test("unbekannte Firma wird verworfen", () => {
  assert.deepEqual(orderPruefen('{"orders":[{"firma":"X","menge":5}]}', ctx), []);
});
test("Verkauf wird auf 4 % des Bestands begrenzt", () => {
  const r = orderPruefen('{"orders":[{"firma":"Stahl","menge":-100}]}', ctx);
  assert.deepEqual(r, [{ firma: "Stahl", menge: -4 }]);
});
test("Kauf wird auf 4 % des Bargelds begrenzt", () => {
  const r = orderPruefen('{"orders":[{"firma":"Brot","menge":100000}]}', ctx);
  assert.deepEqual(r, [{ firma: "Brot", menge: 8 }]);
});
test("ohne Schlüssel wird nichts gefragt", async () => {
  assert.equal(await agentFragen("x", { apiKey: "" }), null);
  assert.equal(schluesselVorhanden({}), false);
});
test("Fehler der API ergibt null, nicht Absturz", async () => {
  const f = async () => { throw new Error("netz"); };
  assert.equal(await agentFragen("x", { apiKey: "k", fetchFn: f }), null);
});
