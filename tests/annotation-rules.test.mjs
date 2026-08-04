import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { annotationRegistry, loadAnnotationRegistry, validateAnnotation } from "../app/annotation-rules.ts";

const base = () => ({ meter: "Я", formula: "Я4м", stopness: "4", effects: [], strophe: "0", graphicStrophe: "", hasGraphicBreaks: false, lines: [{ meter: "Я", feet: 4 }] });
const cases = [
  ["R001", {}, { lines: [{ meter: "Вл", feet: 4 }] }],
  ["R002", { meter: "тонический | Вл" }, { meter: "тонический | Вл", effects: ["упрощённая разметка"] }],
  ["R003", {}, { stopness: "0", lines: [{ meter: "Я", feet: 0 }] }],
  ["R004", { meter: "тонический | Дк, Тк", formula: "Дк4м; Тк3м" }, { meter: "тонический | Дк", formula: "Дк4м; Тк3м" }],
  ["R005", { formula: "Я4~м", effects: ["цезурные усечения"] }, { formula: "Я4~м" }],
  ["R006", { meter: "тонический | Вл" }, { meter: "тонический | Вл", effects: ["нарушения строфики"] }],
  ["R007", { meter: "гетерометрия | Ан, Я" }, { meter: "гетерометрия Ан Я" }],
  ["R008", { formula: "Я4м; Я3м, Х4ж" }, { formula: "Я4м; Я3м Х4ж" }],
  ["R009", {}, { graphicStrophe: "0" }],
  ["R010", { strophe: "4", graphicStrophe: "0" }, { strophe: "4", graphicStrophe: "" }],
];
for (const [id, valid, invalid] of cases) test(`${id}: positive, negative, Russian message and ID`, () => {
  assert.equal(validateAnnotation({ ...base(), ...valid }).some((item) => item.ruleId === id), false);
  const found = validateAnnotation({ ...base(), ...invalid }).find((item) => item.ruleId === id);
  assert.ok(found, `${id} must be reported`);
  assert.equal(found.ruleId, id);
  assert.match(`${found.title} ${found.detail}`, /[А-Яа-яЁё]/u);
  assert.match(found.title, new RegExp(id));
});

test("registry corresponds to its JSON Schema contract, has unique IDs and planned rules have no validatorKey", async () => {
  const schema = JSON.parse(await readFile(new URL("../app/annotation-rules.schema.json", import.meta.url)));
  const raw = JSON.parse(await readFile(new URL("../app/annotation-rules.json", import.meta.url)));
  const validateSchema = new Ajv2020({ strict: true }).compile(schema);
  assert.equal(validateSchema(raw), true, JSON.stringify(validateSchema.errors));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.properties.version, { const: 1 });
  assert.deepEqual(new Set(schema.$defs.rule.required), new Set(["id", "title", "description", "status", "source", "scope", "severity", "condition", "requirement", "validExamples", "invalidExamples", "automation", "notes"]));
  assert.equal(loadAnnotationRegistry(raw).rules.length, 17);
  assert.equal(new Set(annotationRegistry.rules.map((rule) => rule.id)).size, 17);
  assert.ok(annotationRegistry.rules.filter((rule) => rule.automation === "planned").every((rule) => !("validatorKey" in rule)));
  assert.deepEqual(annotationRegistry.rules.filter((rule) => rule.automation === "implemented").map((rule) => rule.id), cases.map(([id]) => id));
});

test("registry loader rejects duplicate IDs and invalid enumerations", () => {
  const duplicate = structuredClone({ version: 1, rules: annotationRegistry.rules });
  duplicate.rules[1].id = duplicate.rules[0].id;
  assert.throws(() => loadAnnotationRegistry(duplicate), /повторяющийся ID/);
  const invalid = structuredClone({ version: 1, rules: annotationRegistry.rules });
  invalid.rules[0].automation = "automatic";
  assert.throws(() => loadAnnotationRegistry(invalid), /перечисление/);
});
