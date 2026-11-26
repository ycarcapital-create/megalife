import test from "node:test";
import assert from "node:assert/strict";
import { buildResultsMessage, resolveChatId } from "./telegram.js";

test("homework chat id matches legacy send_homework.php", () => {
  assert.equal(resolveChatId("homework"), process.env.TELEGRAM_CHAT_ID_HOMEWORK || "-695447439");
  assert.equal(resolveChatId("main"), process.env.TELEGRAM_CHAT_ID_MAIN || "-447087970");
});

test("buildResultsMessage mirrors legacy PHP field order", () => {
  const lines = buildResultsMessage({
    name: "Иван",
    surname: "Петров",
    title: "Математика",
    test: "Тест 8",
    result: "12/12",
  });
  assert.deepEqual(lines, [
    "<u>Иван Петров</u>",
    "<b>Математика</b>",
    "<b>Тест 8</b>",
    "12/12",
  ]);
});

test("buildResultsMessage requires name and surname", () => {
  assert.equal(buildResultsMessage({ name: "A" }), null);
  assert.equal(buildResultsMessage({ surname: "B" }), null);
});

test("buildResultsMessage works with file-only homework posts (no result text)", () => {
  const lines = buildResultsMessage({
    name: "A",
    surname: "B",
    title: "Урок",
    test: "Тест 2",
  });
  assert.deepEqual(lines, ["<u>A B</u>", "<b>Урок</b>", "<b>Тест 2</b>"]);
});