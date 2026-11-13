/** Longest bookmark name we keep from the model. */
export const NAME_MAX = 24;

const KIND_LABEL = { user: "用户的提问", agent: "AI 的回答" } as const;

/**
 * The prompt asking the forked pi for a bookmark name. The fork carries the whole main conversation, so
 * it is told to stay out of it; the text to name is included in full because the fork may have been
 * taken before that text existed.
 */
export function namePrompt(kind: keyof typeof KIND_LABEL, text: string): string {
  return [
    "【书签命名】你是从主会话分出来的旁路助手，不是主 agent。主会话里未完成的任务、还没返回结果的工具调用都与你无关，不要继续它们，也不要调用任何工具。",
    `请给下面这段「${KIND_LABEL[kind]}」起一个书签名：用中文，不超过 ${NAME_MAX / 2} 个字，说清它在讲什么，方便以后在书签列表里认出来。只输出名称本身：不要引号、不要句号、不要解释。`,
    "内容：\n<<<\n" + text + "\n>>>",
  ].join("\n\n");
}

/** Reduces the model's reply to a bare name: first line, no label, quotes or trailing punctuation. */
export function cleanName(raw: string): string {
  let s = raw.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
  s = s.replace(/^(书签名|书签|名称|标题)\s*[:：]\s*/, "");
  s = s.replace(/^["'“”‘’「『《【\[(（`*#\s]+/, "").replace(/["'“”‘’」』》】\])）`*。.！!，,；;：:\s]+$/, "");
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX) : s;
}
