// Логика страницы без привязки к браузеру: этот же файл запускают тесты.

export const TOPIC_LABELS = { delivery: "Доставка", pricing: "Цена", other: "Другое" };

export const MESSAGES = {
  loading: "Разбираем заявку…",
  ready: "Готово. Проверьте черновик перед отправкой клиенту.",
  manual: "Автоматический разбор не удался. Разберите заявку вручную: тема и черновик не заполнены.",
  invalid: "Введите текст заявки.",
};

const blank = (kind) => ({ kind, message: MESSAGES[kind], topic: "", draft: "" });

/**
 * Превращает ответ API в то, что нужно показать менеджеру.
 * Показываем черновик только при полном и понятном ответе ready.
 * Всё остальное, включая неизвестный формат, — ручной разбор с пустыми полями.
 */
export function viewFor(httpStatus, body) {
  if (httpStatus === 400 && body?.status === "invalid_input") return blank("invalid");
  const ready =
    httpStatus === 200 &&
    body?.status === "ready" &&
    Object.hasOwn(TOPIC_LABELS, body.topic) &&
    typeof body.draft === "string" &&
    body.draft.trim() !== "";
  if (!ready) return blank("manual");
  return { kind: "ready", message: MESSAGES.ready, topic: TOPIC_LABELS[body.topic], draft: body.draft };
}

/** Рисует состояние целиком: старые тема и черновик всегда перезаписываются. */
export function render(view, els) {
  els.status.textContent = view.message;
  els.status.className = `status ${view.kind}`;
  els.topic.textContent = view.topic;
  els.draft.textContent = view.draft;
  els.answer.hidden = view.kind !== "ready";
}

/**
 * Возвращает функцию submit(text) для формы.
 * request(text, signal) должен вернуть { httpStatus, body } или бросить ошибку.
 */
export function createController({ els, request, timeoutMs = 5000 }) {
  let latest = 0;
  let inFlight = null;

  return async function submit(text) {
    const id = ++latest; // номер запроса: на экран попадает ответ только на последний
    inFlight?.abort();

    if (typeof text !== "string" || text.trim() === "") {
      render(blank("invalid"), els);
      return;
    }
    // Прошлый результат убираем сразу: старый черновик не должен висеть рядом с новой заявкой.
    render(blank("loading"), els);

    const controller = new AbortController();
    inFlight = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let view;
    try {
      const { httpStatus, body } = await request(text, controller.signal);
      view = viewFor(httpStatus, body);
    } catch {
      view = blank("manual"); // сеть, таймаут, ответ не JSON — тоже ручной разбор
    } finally {
      clearTimeout(timer);
    }
    if (id !== latest) return; // пока ждали, отправили новую заявку: этот ответ устарел
    render(view, els);
  };
}
