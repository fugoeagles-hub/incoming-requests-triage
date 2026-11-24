// Разбор заявки: проверка ввода, вызов модели с ограничением по времени, проверка ответа.
// Это единственное место, где решается, можно ли показать результат AI менеджеру.

export const TOPICS = ["delivery", "pricing", "other"];
export const MODEL_TIMEOUT_MS = 300;

const manualReview = () => ({ status: "manual_review", topic: null, draft: null });

/**
 * Достаёт текст заявки из тела запроса.
 * Возвращает строку или null, если ввод некорректен: битый JSON, не объект,
 * нет поля text, text не строка, text пустой или из одних пробелов.
 */
export function parseInput(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  const { text } = body;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text;
}

/**
 * Проверяет сырой ответ модели.
 * Возвращает { topic, draft } или { reason } — почему ответ нельзя показывать.
 */
export function parseModelOutput(raw) {
  if (typeof raw !== "string") return { reason: "not_a_string" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { reason: "bad_json" };
  }
  if (data === null || typeof data !== "object") return { reason: "bad_shape" };
  if (!TOPICS.includes(data.topic)) return { reason: "bad_topic" };
  if (typeof data.draft !== "string" || data.draft.trim() === "") return { reason: "empty_draft" };
  return { topic: data.topic, draft: data.draft };
}

class ModelTimeout extends Error {}

/**
 * Вызывает модель и ждёт не дольше timeoutMs.
 * Сигнал отмены передаём модели, но на него не полагаемся: гонка с таймером
 * ограничивает ожидание, даже если модель отмену игнорирует.
 */
async function callModel(classify, text, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new ModelTimeout());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([classify(text, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Разбирает заявку. Всегда возвращает один из двух ответов API:
 * ready с проверенными темой и черновиком или manual_review с null-полями.
 * Причина ручного разбора уходит в log, в ответ API она не попадает.
 */
export async function triage(text, { classify, timeoutMs = MODEL_TIMEOUT_MS, log = () => {} } = {}) {
  let raw;
  try {
    raw = await callModel(classify, text, timeoutMs);
  } catch (error) {
    log(error instanceof ModelTimeout ? "timeout" : "model_error");
    return manualReview();
  }
  const parsed = parseModelOutput(raw);
  if (parsed.reason) {
    log(parsed.reason);
    return manualReview();
  }
  // Собираем ответ явно: лишние поля модели наружу не уходят и не могут подменить status.
  return { status: "ready", topic: parsed.topic, draft: parsed.draft };
}
