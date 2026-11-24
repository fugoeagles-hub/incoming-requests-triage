import { createApp } from "./app.mjs";

const port = Number(process.env.PORT || 3000);

createApp().listen(port, "127.0.0.1", () => {
  console.log(`Входящие заявки: http://127.0.0.1:${port}`);
});
