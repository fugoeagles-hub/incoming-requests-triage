// Тесты API «снаружи»: поднимаем настоящий `node server.mjs` с выданным имитатором
// и ходим в него по HTTP. Так проверяется тот же путь, которым пользуется страница.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

let child;
let base;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitUntilUp(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("сервер не поднялся за 5 секунд");
}

async function post(rawBody) {
  const started = performance.now();
  const reply = await fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
  return { status: reply.status, body: await reply.json(), ms: performance.now() - started };
}

const triage = (text) => post(JSON.stringify({ text }));

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  await waitUntilUp(base);
});

after(() => {
  child?.kill();
});

test("обычная заявка: 200 ready, тема из списка и непустой черновик", async () => {
  const { status, body } = await triage("Какая стоимость доставки до Казани?");
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["draft", "status", "topic"]);
  assert.equal(body.status, "ready");
  assert.equal(body.topic, "pricing");
  assert.ok(body.draft.trim().length > 0);
});

test("темы имитатора: доставка, цена, прочее", async () => {
  assert.equal((await triage("Когда будет доставка?")).body.topic, "delivery");
  assert.equal((await triage("Какая цена за штуку?")).body.topic, "pricing");
  assert.equal((await triage("Здравствуйте, есть вопрос")).body.topic, "other");
});

const invalidBodies = {
  "пустое тело": "",
  "битый JSON": '{"text": ',
  "нет поля text": "{}",
  "пустая строка": '{"text": ""}',
  "одни пробелы": '{"text": "  \\n\\t "}',
  "text — число": '{"text": 42}',
  "text — null": '{"text": null}',
  "text — массив": '{"text": ["заявка"]}',
  "тело — null": "null",
  "тело — массив": "[]",
  "тело — строка": '"заявка"',
};

for (const [name, rawBody] of Object.entries(invalidBodies)) {
  test(`некорректный ввод (${name}): 400 invalid_input`, async () => {
    const { status, body } = await post(rawBody);
    assert.equal(status, 400);
    assert.deepEqual(body, { status: "invalid_input" });
  });
}

for (const label of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`сбой модели ${label}: 200 manual_review без темы и черновика`, async () => {
    const { status, body } = await triage(`Вопрос по доставке ${label}`);
    assert.equal(status, 200);
    assert.deepEqual(body, MANUAL_REVIEW);
  });
}

test("таймаут модели [timeout]: manual_review примерно через 300 мс, а не через 1200", async () => {
  const { status, body, ms } = await triage("Когда доставка? [timeout]");
  assert.equal(status, 200);
  assert.deepEqual(body, MANUAL_REVIEW);
  assert.ok(ms >= 250, `ответ пришёл раньше лимита ожидания: ${Math.round(ms)} мс`);
  assert.ok(ms < 900, `ответ ждали дольше лимита: ${Math.round(ms)} мс`);
});

test("после сбоя сервер продолжает работать", async () => {
  await triage("[error]");
  const { status, body } = await triage("Когда доставка?");
  assert.equal(status, 200);
  assert.equal(body.status, "ready");
});

test("страница и её скрипт отдаются, чужие адреса — 404", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);

  const script = await fetch(`${base}/ui.mjs`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);

  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/triage`)).status, 404);
});
