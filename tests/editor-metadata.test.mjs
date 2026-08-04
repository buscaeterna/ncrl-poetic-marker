import test from "node:test";
import assert from "node:assert/strict";
import { effectiveMetadata, metadataFromFields, modeFromMeter, restoreOriginalValue, setManualValue } from "../app/editor-metadata.ts";
import { validateAnnotation } from "../app/annotation-rules.ts";

const automatic = { meter: "тонический | Тк", formula: "Тк3м", stopness: "3" };
const annotation = (meta, effects = []) => validateAnnotation({ ...meta, effects, strophe: "0", graphicStrophe: "", hasGraphicBreaks: false, lines: [{ meter: "Тк", feet: 3 }] });

test("imported values win over automatic suggestions and a manual meter fixes R004", () => {
  const imported = metadataFromFields({ "метр": "тонический | Дк", "формула": "Тк3м", "стопность": "3" });
  const original = effectiveMetadata(imported, automatic);
  assert.equal(original.meter, "тонический | Дк");
  assert.ok(annotation(original).some((item) => item.ruleId === "R004"));
  const fixed = effectiveMetadata(setManualValue(imported, "meter", "тонический | Дк, Тк"), automatic);
  assert.equal(annotation(fixed).some((item) => item.ruleId === "R004"), false);
  assert.equal(effectiveMetadata(restoreOriginalValue(setManualValue(imported, "meter", "Тк"), "meter"), automatic).meter, "тонический | Дк");
});

test("both directions of the caesura rule can be fixed explicitly", () => {
  const base = { meter: "Я", stopness: "4" };
  assert.ok(annotation({ ...base, formula: "Я4~м" }).some((item) => item.ruleId === "R005"));
  assert.equal(annotation({ ...base, formula: "Я4~м" }, ["цезурные усечения"]).some((item) => item.ruleId === "R005"), false);
  assert.ok(annotation({ ...base, formula: "Я4м" }, ["цезурные наращения"]).some((item) => item.ruleId === "R005"));
  assert.equal(annotation({ ...base, formula: "Я4~м" }, ["цезурные наращения"]).some((item) => item.ruleId === "R005"), false);
});

test("heterometry and comma-separated rare variants retain registry validation", () => {
  assert.ok(annotation({ meter: "гетерометрия Ан Я", formula: "Ан3м", stopness: "3" }).some((item) => item.ruleId === "R007"));
  assert.ok(annotation({ meter: "Я, Х", formula: "Я4м; Я3м Х4ж", stopness: "4" }).some((item) => item.ruleId === "R008"));
});

test("unknown effects survive import, can be removed, and mode follows imported meter", () => {
  const state = metadataFromFields({ "метр": "тонический | Вл", "доп": "упрощённая разметка, авторская помета" });
  assert.deepEqual(state.effects, ["упрощённая разметка", "авторская помета"]);
  assert.deepEqual(state.effects.filter((item) => item !== "упрощённая разметка"), ["авторская помета"]);
  assert.equal(modeFromMeter("гетерометрия | Я, Х"), "heterometry");
  assert.equal(modeFromMeter("полиметрия | Я # Х"), "polymetry");
  assert.equal(modeFromMeter("тонический | Вл"), "free");
  assert.equal(modeFromMeter("Я"), "auto");
});

test("manual metadata is serializable for IndexedDB and remains isolated per poem", () => {
  const first = setManualValue(metadataFromFields({ "метр": "Я" }), "meter", "Я, Тк");
  const second = metadataFromFields({ "метр": "Х" });
  const restored = structuredClone({ first, second });
  assert.equal(restored.first.meter.manual, "Я, Тк");
  assert.equal(restored.second.meter.original, "Х");
  assert.equal(restored.second.meter.manual, undefined);
});
