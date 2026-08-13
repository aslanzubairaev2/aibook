// The failure this guards against is the one that actually happened: a feature
// shipped in the app, and the connected agent never learned it existed.
//
// Nothing here touches a database. It checks that what the server *advertises*
// stays in step with what it can do — tools with handlers, handlers with tools,
// and both with the capability map that the instructions, the guide resource
// and get_capabilities are all built from.

import assert from "node:assert/strict";
import test from "node:test";
import { MCP_TOOLS, buildGuideMarkdown, callMcpTool, findRegistryDrift } from "./tools.ts";
import { CAPABILITY_AREAS, buildInstructions } from "./capabilities.ts";
import { MCP_PROMPTS, getPrompt } from "./prompts.ts";

test("every tool is implemented, listed and described in the capability map", () => {
  assert.deepEqual(findRegistryDrift(), []);
});

test("tool definitions carry what a client needs to display and trust them", () => {
  for (const tool of MCP_TOOLS) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/, `${tool.name}: snake_case name`);
    assert.ok(tool.title, `${tool.name}: needs a human-readable title`);
    assert.ok(
      tool.description.length > 60,
      `${tool.name}: description too thin to tell an agent when to use it`,
    );
    assert.equal(tool.inputSchema.type, "object", `${tool.name}: input schema must be an object`);
    assert.ok(tool.annotations, `${tool.name}: needs annotations so clients can tell reads from writes`);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name}: readOnlyHint`);
  }
});

test("required arguments exist among the declared properties", () => {
  for (const tool of MCP_TOOLS) {
    const properties = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
    const required = (tool.inputSchema.required ?? []) as string[];
    for (const name of required) {
      assert.ok(properties.includes(name), `${tool.name}: required '${name}' is not a declared property`);
    }
  }
});

test("write tools are named as writes, and only deletion is destructive", () => {
  const destructive = MCP_TOOLS.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
  assert.deepEqual(destructive, ["delete_flashcards"]);

  for (const tool of MCP_TOOLS) {
    if (tool.annotations?.readOnlyHint) continue;
    assert.match(
      tool.name,
      /^(add|create|update|delete)_/,
      `${tool.name}: a tool that changes the learner's data should say so in its name`,
    );
  }
});

test("an unknown tool name comes back with the list of real ones", async () => {
  await assert.rejects(
    () => callMcpTool({} as never, "user", "make_coffee", {}),
    (err: Error) => err.message.includes("make_coffee") && err.message.includes("get_overview"),
  );
});

test("the instructions name every tool the server has", () => {
  const instructions = buildInstructions();
  for (const tool of MCP_TOOLS) {
    assert.ok(instructions.includes(tool.name), `instructions never mention ${tool.name}`);
  }
});

test("the guide resource describes every area and every tool", () => {
  const guide = buildGuideMarkdown();
  for (const area of CAPABILITY_AREAS) {
    assert.ok(guide.includes(area.area), `guide is missing the area ${area.area}`);
  }
  for (const tool of MCP_TOOLS) {
    assert.ok(guide.includes(`\`${tool.name}\``), `guide never mentions ${tool.name}`);
  }
});

test("prompts build a usable request and only mention tools that exist", () => {
  const toolNames = MCP_TOOLS.map((t) => t.name);
  for (const prompt of MCP_PROMPTS) {
    assert.ok(prompt.title, `${prompt.name}: needs a title the learner can read`);
    const text = prompt.build({});
    assert.ok(text.length > 80, `${prompt.name}: prompt text too thin`);
    for (const mentioned of text.match(/\b[a-z][a-z0-9_]*_[a-z0-9_]+\b/g) ?? []) {
      if (mentioned.startsWith("get_") || mentioned.startsWith("list_") || mentioned.startsWith("add_")
        || mentioned.startsWith("create_") || mentioned.startsWith("update_") || mentioned.startsWith("delete_")
        || mentioned.startsWith("search_")) {
        assert.ok(toolNames.includes(mentioned), `${prompt.name}: refers to a tool that does not exist: ${mentioned}`);
      }
    }
  }
});

test("prompt arguments are substituted when supplied", () => {
  const prompt = getPrompt("story_from_my_words");
  assert.ok(prompt);
  assert.ok(prompt.build({ topic: "поход к врачу" }).includes("поход к врачу"));
  assert.ok(!prompt.build({}).includes("undefined"));
});
