import registryData from "./annotation-rules.json";

export type RuleStatus = "active" | "superseded" | "needs_review";
export type RuleAutomation = "implemented" | "planned" | "manual";
export type RuleSeverity = "error" | "warning" | "expert_review";

export type AnnotationRule = {
  id: string; title: string; description: string; status: RuleStatus;
  source: string; scope: string[]; severity: RuleSeverity; condition: string;
  requirement: string; validExamples: string[]; invalidExamples: string[];
  automation: RuleAutomation; validatorKey?: string; notes: string;
};

export type AnnotationRegistry = { version: number; rules: AnnotationRule[] };

export type AnnotationInput = {
  meter: string; formula: string; stopness: string; effects: string[];
  strophe: string; graphicStrophe: string; hasGraphicBreaks: boolean;
  lines: Array<{ meter: string; feet: number }>;
};

export type RuleIssue = {
  ruleId: string; level: "error" | "warning"; title: string; detail: string; line?: number;
};

const statuses = new Set<RuleStatus>(["active", "superseded", "needs_review"]);
const automations = new Set<RuleAutomation>(["implemented", "planned", "manual"]);
const severities = new Set<RuleSeverity>(["error", "warning", "expert_review"]);
const required = ["id", "title", "description", "status", "source", "scope", "severity", "condition", "requirement", "validExamples", "invalidExamples", "automation", "notes"] as const;

/** Runtime boundary: JSON imports are untrusted until this function succeeds. */
export function loadAnnotationRegistry(value: unknown = registryData): AnnotationRegistry {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { rules?: unknown }).rules)) throw new TypeError("Некорректный формат реестра правил");
  const registry = value as AnnotationRegistry;
  const ids = new Set<string>();
  for (const rule of registry.rules) {
    if (!rule || typeof rule !== "object" || required.some((key) => !(key in rule))) throw new TypeError("В правиле отсутствует обязательное поле");
    if (!/^R\d{3}$/.test(rule.id) || ids.has(rule.id)) throw new TypeError(`Некорректный или повторяющийся ID: ${rule.id}`);
    ids.add(rule.id);
    if (!statuses.has(rule.status) || !automations.has(rule.automation) || !severities.has(rule.severity)) throw new TypeError(`Некорректное перечисление в ${rule.id}`);
    if (rule.source !== "user-confirmed amendment" || !Array.isArray(rule.scope) || !Array.isArray(rule.validExamples) || !Array.isArray(rule.invalidExamples)) throw new TypeError(`Некорректные данные в ${rule.id}`);
    if (rule.automation === "implemented" ? !rule.validatorKey : rule.validatorKey !== undefined) throw new TypeError(`validatorKey не согласован с automation в ${rule.id}`);
  }
  return registry;
}

export const annotationRegistry = loadAnnotationRegistry();
export const ruleById = new Map(annotationRegistry.rules.map((rule) => [rule.id, rule]));

const issue = (ruleId: string, detail: string, line?: number): RuleIssue => ({
  ruleId, level: ruleById.get(ruleId)?.severity === "warning" ? "warning" : "error",
  title: `${ruleId}: ${ruleById.get(ruleId)?.title ?? "Нарушение правила"}`, detail, line,
});

export function validateAnnotation(input: AnnotationInput): RuleIssue[] {
  const result: RuleIssue[] = [];
  input.lines.forEach((line, index) => {
    if (line.meter === "Вл") result.push(issue("R001", "Замените построчный тег Вл конкретным метром после ручной проверки.", index + 1));
    if (!line.feet) result.push(issue("R003", "Определите фактическую стопность строки; значение 0 не подставляется автоматически.", index + 1));
  });
  if (/Вл/u.test(input.meter) && input.effects.includes("упрощённая разметка")) result.push(issue("R002", "Удалите помету «упрощённая разметка», если её единственное основание — Вл; подтвердите изменение вручную."));
  if (!input.stopness.trim() || input.stopness.trim() === "0") result.push(issue("R003", "Заполните @стопность фактическим значением; пустое значение и 0 требуют проверки."));
  const hasTk = input.lines.some((line) => line.meter === "Тк") || /Тк/u.test(input.formula);
  if (hasTk && !/Тк/u.test(input.meter)) result.push(issue("R004", "Добавьте Тк в @метр: он присутствует в строках или @формула."));
  const formulaCaesura = input.formula.includes("~");
  const effectCaesura = input.effects.some((value) => /^цезурные (наращения|усечения)$/u.test(value));
  if (formulaCaesura !== effectCaesura) result.push(issue("R005", formulaCaesura ? "Добавьте соответствующий цезурный эффект в @доп." : "Отразите заявленный в @доп цезурный эффект в @формула, включая обозначение ~."));
  if (/Вл/u.test(input.meter) && input.effects.includes("нарушения строфики")) result.push(issue("R006", "Удалите из @доп «нарушения строфики»: эта помета неприменима к Вл."));
  const heterometry = /гетерометри/u.test(input.meter);
  if ((heterometry && !/^гетерометрия\s*\|\s*\S/u.test(input.meter)) || (heterometry && input.effects.includes("переменная анакруса"))) result.push(issue("R007", "Оформите @метр как «гетерометрия | …» и удалите отдельную помету «переменная анакруса»."));
  const rare = input.formula.split(";").slice(1).join(";");
  if (rare && !rare.includes(",") && (rare.match(/(?:Ан|Аф|Дк|Тк|Ак|[ДХЯО])\d/gu) ?? []).length > 1) result.push(issue("R008", "Разделите редкие формулы после точки с запятой запятыми."));
  if (input.strophe.trim() === "0" && input.graphicStrophe.trim() === "0") result.push(issue("R009", "Не дублируйте @строфика 0: укажите @гр_строфика по реальному графическому членению (без отбивок оставьте пустым)."));
  if (input.strophe.trim() && input.strophe.trim() !== "0" && !input.hasGraphicBreaks && input.graphicStrophe.trim() !== "0") result.push(issue("R010", "При ненулевой @строфика без пробельных отбивок явно укажите @гр_строфика 0."));
  return result;
}
