/** A skill the user invoked (`/skill:name args`): pi sends it to the model as one user message wrapping the whole SKILL.md. */
export interface SkillInvocation {
  name: string;
  location: string;
  /** The SKILL.md text pi inlined. */
  body: string;
  /** What the user typed after the skill name; may be empty. */
  args: string;
}

const SKILL = /^<skill name="([^"]*)" location="([^"]*)">\r?\n([\s\S]*)\r?\n<\/skill>(?:\r?\n\r?\n([\s\S]*))?$/;

/** Splits such a message into the skill and the user's own words; null for any other text. */
export function parseSkillMessage(text: string): SkillInvocation | null {
  const m = SKILL.exec(text.trim());
  if (!m) return null;
  return { name: m[1], location: m[2], body: m[3].trim(), args: (m[4] ?? "").trim() };
}

/** One-line description of a prompt for lists, previews and copying: the skill shows as `/skill:name`, not as its text. */
export function promptLabel(text: string, skill: { name: string } | undefined): string {
  return skill ? `/skill:${skill.name}${text ? ` ${text}` : ""}` : text;
}
