/** INPUT: 固定公开错误信息。 OUTPUT: ApiError。 POSITION: EP7 HTTP 状态边界，不暴露底层异常。 SYNC: 同步 folder.md。 */
export class ApiError extends Error {
  // code 供前端按语言翻译;没有专门 code 的(多为输入校验)原样带回 message,前端直接显示，别吞掉"先存款开户"这类提示。
  constructor(public readonly status: number, message: string, public readonly code = 'API_ERROR', public readonly params?: Record<string, string>) { super(message); }
}
