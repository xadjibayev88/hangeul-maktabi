import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const baseCss = readFileSync(new URL("../public/base.css", import.meta.url), "utf8");
const premiumCss = readFileSync(new URL("../public/premium.css", import.meta.url), "utf8");

test("speech-to-text composer is a wrapping textarea that grows to show its full value", () => {
  assert.match(html, /<textarea id="chat-input"[^>]*rows="1"[^>]*aria-label="Xabar">\$\{esc\(C\.draft\)\}<\/textarea>/);
  assert.match(baseCss, /\.chat-composer\s+textarea\{[^}]*overflow-y:hidden/);

  const resize = html.match(/function resizeChatInput\(input\)\{[^}]+\}/)?.[0];
  assert.ok(resize, "chat textarea needs a reusable resize helper");
  const input = { style: { height: "180px" }, scrollHeight: 246 };
  runInNewContext(`${resize}; resizeChatInput(input);`, { input });
  assert.equal(input.style.height, "246px");
  assert.match(html, /dict\.onPartial\(\(\{text\}\)=>\{[\s\S]*?resizeChatInput\(i\)/);
  assert.match(html, /dict\.onFinal\(\(\{text,confidence\}\)=>\{[\s\S]*?resizeChatInput\(i\)/);
});

test("chat scrolls its own history to the newest message instead of behind the composer", () => {
  const scroll = html.match(/function scrollChat\(\)\{[^}]+\}/)?.[0];
  assert.ok(scroll, "chat needs a contained scrolling helper");
  const chat = { scrollTop: 0, scrollHeight: 812, lastElementChild: {} };
  runInNewContext(`${scroll}; scrollChat();`, { $: () => chat });
  assert.equal(chat.scrollTop, 812);
  assert.match(premiumCss, /\.chat-view>\.chat\{[^}]*overflow-y:auto/);
});

test("mobile chat composer clears the bottom navigation and reserves scroll space", () => {
  assert.match(html, /<section class="view chat-view">/);
  assert.match(html, /<form class="send dock chat-composer" data-chat>/);
  assert.match(premiumCss, /\.mobile-nav\{position:fixed[^}]*bottom:calc\(10px \+ env\(safe-area-inset-bottom,0px\)\);height:70px/);
  assert.match(premiumCss, /@media\s*\(max-width:960px\)[\s\S]*?\.chat-view>\.chat-composer\{[^}]*bottom:calc\(88px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(premiumCss, /@media\s*\(max-width:620px\)[\s\S]*?\.chat-view>\.chat-composer\{[^}]*bottom:calc\(80px \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.match(premiumCss, /\.chat-view\{padding-bottom:calc\((?:88|80)px \+ env\(safe-area-inset-bottom,0px\)\)\}/);
});
