import { initStore } from "./store";
import { createApp } from "./app";
await initStore();
const app = await createApp();
app.listen(Number(process.env.PORT || 4310), "127.0.0.1", () =>
  console.log(`News Card Studio http://127.0.0.1:${process.env.PORT || 4310}`),
);
