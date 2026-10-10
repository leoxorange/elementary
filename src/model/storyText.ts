import { tIn } from "../i18n";
import type { StoryText } from "./types";

/// The base language of a BCP 47 identifier, e.g. `zh` for `zh-Hans`.
function baseLanguage(identifier: string): string {
  return identifier.split(/[-_]/)[0].toLowerCase();
}

/// The best translation for `language`, falling back to the source language (the first translation).
export function resolve(text: StoryText, language: string): string {
  if (text.length === 0) return "";
  const exact = text.find((t) => t.language === language);
  if (exact) return exact.value;
  const base = baseLanguage(language);
  const sameLanguage = text.find((t) => baseLanguage(t.language) === base);
  return (sameLanguage ?? text[0]).value;
}

/// The translation for an exact language identifier, if there is one.
export function translation(text: StoryText, language: string): string | undefined {
  return text.find((t) => t.language === language)?.value;
}

/// Replaces the translation for `language`; `undefined` removes it.
export function withTranslation(text: StoryText, language: string, value: string | undefined): StoryText {
  const index = text.findIndex((t) => t.language === language);
  if (value === undefined) {
    return index === -1 ? text : text.filter((_, i) => i !== index);
  }
  if (index === -1) return [...text, { language, value }];
  return text.map((t, i) => (i === index ? { language, value } : t));
}

/// True when no translation has any visible characters.
export function isBlank(text: StoryText | null | undefined): boolean {
  return !text || text.every((t) => t.value.trim() === "");
}

export function textEquals(a: StoryText, b: StoryText): boolean {
  return a.length === b.length && a.every((t, i) => t.language === b[i].language && t.value === b[i].value);
}

/// Splits text into paragraphs at blank lines.
export function paragraphs(text: StoryText, language: string): string[] {
  return resolve(text, language)
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/// Text holding one translation: an interface string looked up in `language`.
export function localizedText(key: string, language: string): StoryText {
  return [{ language, value: tIn(language, key) }];
}

/// Text holding one translation, as is.
export function plainText(value: string, language: string): StoryText {
  return [{ language, value }];
}
