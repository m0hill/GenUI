import { serveStatic } from "hono/bun";
import { Hono } from "hono";
import chat from "./pages/chat/index.js";
import sessions from "./pages/sessions.js";

const app = new Hono();

app.use("/public/*", serveStatic({ root: "./" }));

app.route("/", chat).route("/sessions", sessions);

app.notFound((c) => c.text("Not Found", 404));

const port = Number(process.env.PORT ?? "3000");
const server = Bun.serve({ port, fetch: app.fetch });
console.log(`Hono AI chat listening on ${server.url}`);
