// HTTP-обвязка: страница, её скрипт и POST /api/triage.
// Сервер создаётся без запуска, чтобы тесты поднимали его на свободном порту.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify as mockClassify } from "./mock-ai.mjs";
import { parseInput, triage } from "./triage.mjs";

const file = (name) => readFile(new URL(name, import.meta.url));

const pages = new Map([
  ["/", { type: "text/html; charset=utf-8", body: await file("./index.html") }],
  ["/ui.mjs", { type: "text/javascript; charset=utf-8", body: await file("./ui.mjs") }],
]);

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const logToConsole = (reason) => console.warn(`[triage] manual_review: ${reason}`);

export function createApp({ classify = mockClassify, timeoutMs, log = logToConsole } = {}) {
  return createServer(async (request, response) => {
    const page = request.method === "GET" ? pages.get(request.url) : undefined;
    if (page) {
      response.writeHead(200, { "Content-Type": page.type });
      response.end(page.body);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      const text = parseInput(await readBody(request));
      if (text === null) return json(response, 400, { status: "invalid_input" });
      // Сбой модели — штатный исход (200 manual_review), а не ошибка сервера.
      return json(response, 200, await triage(text, { classify, timeoutMs, log }));
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}
