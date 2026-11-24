// Тесты поведения страницы без браузера: вместо DOM-узлов — простые объекты с теми же полями.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createController, MESSAGES } from "../ui.mjs";

const READY = { httpStatus: 200, body: { status: "ready", topic: "delivery", draft: "Черновик ответа" } };
const MANUAL = { httpStatus: 200, body: { status: "manual_review", topic: null, draft: null } };

function screen() {
  const node = () => ({ textContent: "", className: "", hidden: true });
  return { status: node(), topic: node(), draft: node(), answer: node() };
}

/** Обещание, которым тест управляет сам: когда и чем ответит «сервер». */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function assertManual(els) {
  assert.equal(els.status.textContent, MESSAGES.manual);
  assert.equal(els.draft.textContent, "");
  assert.equal(els.topic.textContent, "");
  assert.equal(els.answer.hidden, true);
}

test("успех: показаны тема по-русски и черновик", async () => {
  const els = screen();
  const submit = createController({ els, request: async () => READY });
  await submit("Когда доставка?");
  assert.equal(els.topic.textContent, "Доставка");
  assert.equal(els.draft.textContent, "Черновик ответа");
  assert.equal(els.answer.hidden, false);
  assert.equal(els.status.textContent, MESSAGES.ready);
});

test("manual_review после успеха: сообщение менеджеру, прошлый черновик очищен", async () => {
  const els = screen();
  const replies = [READY, MANUAL];
  const submit = createController({ els, request: async () => replies.shift() });
  await submit("Когда доставка?");
  assert.equal(els.draft.textContent, "Черновик ответа");
  await submit("Когда доставка? [error]");
  assertManual(els);
});

test("пока идёт новый запрос, прошлый черновик уже убран", async () => {
  const els = screen();
  const second = deferred();
  const replies = [Promise.resolve(READY), second.promise];
  const submit = createController({ els, request: () => replies.shift() });
  await submit("первая заявка");
  const pending = submit("вторая заявка");
  assert.equal(els.draft.textContent, "");
  assert.equal(els.answer.hidden, true);
  assert.equal(els.status.textContent, MESSAGES.loading);
  second.resolve(MANUAL);
  await pending;
  assertManual(els);
});

test("ответы пришли в обратном порядке: на экране остаётся результат последнего запроса", async () => {
  const els = screen();
  const first = deferred();
  const second = deferred();
  const replies = [first.promise, second.promise];
  const submit = createController({ els, request: () => replies.shift() });

  const a = submit("старая заявка");
  const b = submit("новая заявка");
  second.resolve({ httpStatus: 200, body: { status: "ready", topic: "pricing", draft: "Свежий черновик" } });
  await b;
  first.resolve(READY);
  await a;

  assert.equal(els.draft.textContent, "Свежий черновик");
  assert.equal(els.topic.textContent, "Цена");
});

test("опоздавшая ошибка старого запроса не затирает свежий результат", async () => {
  const els = screen();
  const first = deferred();
  const second = deferred();
  const replies = [first.promise, second.promise];
  const submit = createController({ els, request: () => replies.shift() });

  const a = submit("старая заявка");
  const b = submit("новая заявка");
  second.resolve(READY);
  await b;
  first.reject(new Error("сеть"));
  await a;

  assert.equal(els.draft.textContent, "Черновик ответа");
  assert.equal(els.status.textContent, MESSAGES.ready);
});

test("новый запрос отменяет предыдущий", async () => {
  const signals = [];
  const submit = createController({
    els: screen(),
    request: async (_text, signal) => {
      signals.push(signal);
      return READY;
    },
  });
  const a = submit("первая");
  const b = submit("вторая");
  await Promise.all([a, b]);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

test("сеть упала или ответ не JSON: ручной разбор, черновик очищен", async () => {
  const els = screen();
  const replies = [async () => READY, async () => { throw new TypeError("Failed to fetch"); }];
  const submit = createController({ els, request: () => replies.shift()() });
  await submit("первая");
  await submit("вторая");
  assertManual(els);
});

test("сервер не отвечает: по таймауту страницы — ручной разбор", async () => {
  const els = screen();
  const request = (_text, signal) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const submit = createController({ els, request, timeoutMs: 20 });
  await submit("заявка");
  assertManual(els);
});

const strangeReplies = {
  "500 server_error": { httpStatus: 500, body: { status: "server_error" } },
  "ready без черновика": { httpStatus: 200, body: { status: "ready", topic: "delivery", draft: "   " } },
  "ready с чужой темой": { httpStatus: 200, body: { status: "ready", topic: "refund", draft: "Ответ" } },
  "неизвестный статус": { httpStatus: 200, body: { status: "something_new" } },
  "тело null": { httpStatus: 200, body: null },
};

for (const [name, reply] of Object.entries(strangeReplies)) {
  test(`непонятный ответ API (${name}): ручной разбор`, async () => {
    const els = screen();
    const submit = createController({ els, request: async () => reply });
    await submit("заявка");
    assertManual(els);
  });
}

test("пустой ввод: запрос не уходит, прошлый черновик очищен, просим ввести текст", async () => {
  const els = screen();
  let calls = 0;
  const submit = createController({
    els,
    request: async () => {
      calls += 1;
      return READY;
    },
  });
  await submit("заявка");
  await submit("   ");
  assert.equal(calls, 1);
  assert.equal(els.status.textContent, MESSAGES.invalid);
  assert.equal(els.draft.textContent, "");
  assert.equal(els.answer.hidden, true);
});

test("сервер ответил 400 invalid_input: просим ввести текст", async () => {
  const els = screen();
  const submit = createController({
    els,
    request: async () => ({ httpStatus: 400, body: { status: "invalid_input" } }),
  });
  await submit("заявка");
  assert.equal(els.status.textContent, MESSAGES.invalid);
  assert.equal(els.answer.hidden, true);
});
