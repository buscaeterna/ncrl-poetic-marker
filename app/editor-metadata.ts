export type DocumentMode = "auto" | "heterometry" | "polymetry" | "free";
export type MetadataKey = "meter" | "formula" | "stopness";

export type SourcedValue = {
  /** Undefined means that this is a new raw-text document, not an imported empty field. */
  original?: string;
  /** Empty string is an intentional manual value and must not fall through. */
  manual?: string;
};

export type EditorMetadata = {
  meter: SourcedValue;
  formula: SourcedValue;
  stopness: SourcedValue;
  clausula: string;
  rhyme: string;
  effects: string[];
  strophe: string;
  graphicStrophe: string;
  mode: DocumentMode;
};

export type AutomaticMetadata = { meter: string; formula: string; stopness: string };

const effectsFrom = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function modeFromMeter(meter: string): DocumentMode {
  if (/^\s*гетерометрия(?:\s|\||$)/u.test(meter)) return "heterometry";
  if (/^\s*полиметрия(?:\s|\||$)/u.test(meter)) return "polymetry";
  if (/(?:^|[|,\s])Вл(?:$|[|,\s])/u.test(meter)) return "free";
  return "auto";
}

export function metadataFromFields(fields: Record<string, string>, rawText = false): EditorMetadata {
  const sourced = (name: string): SourcedValue => rawText ? {} : { original: fields[name] ?? "" };
  return {
    meter: sourced("метр"), formula: sourced("формула"), stopness: sourced("стопность"),
    clausula: fields["клаузула"] ?? "", rhyme: fields["рифма"] ?? "",
    effects: effectsFrom(fields["доп"] ?? ""), strophe: fields["строфика"] ?? "0",
    graphicStrophe: fields["гр_строфика"] ?? "",
    mode: modeFromMeter(fields["метр"] ?? ""),
  };
}

export function effectiveValue(value: SourcedValue, automatic: string) {
  return value.manual !== undefined ? value.manual : value.original !== undefined ? value.original : automatic;
}

export function effectiveMetadata(state: EditorMetadata, automatic: AutomaticMetadata) {
  return {
    meter: effectiveValue(state.meter, automatic.meter),
    formula: effectiveValue(state.formula, automatic.formula),
    stopness: effectiveValue(state.stopness, automatic.stopness),
    clausula: state.clausula, rhyme: state.rhyme, effects: state.effects,
    strophe: state.strophe, graphicStrophe: state.graphicStrophe,
  };
}

export function setManualValue(state: EditorMetadata, key: MetadataKey, value: string): EditorMetadata {
  return { ...state, [key]: { ...state[key], manual: value } };
}

export function restoreOriginalValue(state: EditorMetadata, key: MetadataKey): EditorMetadata {
  const original = { ...state[key] };
  delete original.manual;
  return { ...state, [key]: original };
}
