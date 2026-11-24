// Тесты логики разбора с подставной моделью: случаи, которых нет в выданном имитаторе.

import { test } from "node:test";
import assert from "node:assert/strict";
import { triage } from "../triage.mjs";

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

async function run(classify, options = {}) {
  const reasons = [];
  const result = await triage("Заявка", { classify, log: (reason) => reasons.push(reason), ...options });
  return { result, reasons };
}

test("корректный ответ модели: ready, причин ручного разбора нет", async () => {
  const { result, reasons } = await run(async () => JSON.stringify({ topic: "delivery", draft: "Ответ" }));
  assert.deepEqual(result, { status: "ready", topic: "delivery", draft: "Ответ" });
  assert.deepEqual(reasons, []);
});

test("лишние поля модели не попадают в ответ и не подменяют status", async () => {
  const model = async () =>
    JSON.stringify({ topic: "other", draft: "Ответ", status: "manual_review", internal: "секрет" });
  const { result } = await run(model);
  assert.deepEqual(result, { status: "ready", topic: "other", draft: "Ответ" });
});

test("модель зависла и игнорирует отмену: manual_review по таймеру", async () => {
  const started = performance.now();
  const { result, reasons } = await run(() => new Promise(() => {}), { timeoutMs: 50 });
  assert.deepEqual(result, MANUAL_REVIEW);
  assert.deepEqual(reasons, ["timeout"]);
  assert.ok(performance.now() - started < 500);
});

test("при таймауте модель получает сигнал отмены", async () => {
  let aborted = false;
  const model = (_text, { signal }) =>
    new Promise(() => signal.addEventListener("abort", () => (aborted = true)));
  await run(model, { timeoutMs: 20 });
  assert.equal(aborted, true);
});

const brokenModels = {
  "бросила ошибку": [async () => { throw new Error("недоступна"); }, "model_error"],
  "бросила ошибку синхронно": [() => { throw new Error("недоступна"); }, "model_error"],
  "вернула не строку": [async () => ({ topic: "other", draft: "Ответ" }), "not_a_string"],
  "вернула не JSON": [async () => "model output is not JSON", "bad_json"],
  "вернула JSON null": [async () => "null", "bad_shape"],
  "вернула JSON-строку": [async () => '"текст"', "bad_shape"],
  "вернула массив": [async () => "[]", "bad_topic"],
  "неизвестная тема": [async () => JSON.stringify({ topic: "refund", draft: "Ответ" }), "bad_topic"],
  "нет темы": [async () => JSON.stringify({ draft: "Ответ" }), "bad_topic"],
  "тема-массив": [async () => JSON.stringify({ topic: ["other"], draft: "Ответ" }), "bad_topic"],
  "черновик из пробелов": [async () => JSON.stringify({ topic: "other", draft: " \n\t " }), "empty_draft"],
  "нет черновика": [async () => JSON.stringify({ topic: "other" }), "empty_draft"],
  "черновик не строка": [async () => JSON.stringify({ topic: "other", draft: 123 }), "empty_draft"],
};

for (const [name, [model, reason]] of Object.entries(brokenModels)) {
  test(`модель ${name}: manual_review, причина ${reason}`, async () => {
    const { result, reasons } = await run(model);
    assert.deepEqual(result, MANUAL_REVIEW);
    assert.deepEqual(reasons, [reason]);
  });
}
