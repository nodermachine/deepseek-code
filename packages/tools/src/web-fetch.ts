/**
 * @file WebFetch 工具
 * 抓取网页内容，去除 HTML 标签返回纯文本
 * 限制 50KB 输出，网络访问需权限确认
 */
import { z } from 'zod';
import type { Tool } from '@deepseek-code/core';

const InputSchema = z.object({
  url: z.string().url(),
});

export interface WebFetchOutput {
  content: string;
  title?: string;
  truncated: boolean;
}

const MAX_CONTENT = 50 * 1024;

/** 去除 HTML 标签，提取纯文本 */
function htmlToText(html: string): { text: string; title?: string } {
  // 提取 title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim();
  // 移除 script/style 块
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // 移除 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ');
  // 清理多余空白
  text = text.replace(/\s+/g, ' ').trim();
  // 解码常见 HTML 实体
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return { text, title };
}

export const webFetchTool: Tool<z.infer<typeof InputSchema>, WebFetchOutput> = {
  name: 'WebFetch',
  description: '抓取指定 URL 的网页内容，返回去除 HTML 标签后的纯文本。用于查阅文档或获取在线信息。',
  inputSchema: InputSchema,
  needsPermission: (input) => ({ tool: 'WebFetch', matcher: new URL(input.url).hostname, summary: input.url }),
  async execute(input, ctx) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      // 合并外部 signal 和内部超时
      ctx.signal.addEventListener('abort', () => controller.abort(), { once: true });

      const resp = await fetch(input.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'deepseek-code/0.2 (CLI coding agent)' },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        return { ok: false, error: `http_${resp.status}`, recoverable: true };
      }
      const html = await resp.text();
      const { text, title } = htmlToText(html);
      const truncated = text.length > MAX_CONTENT;
      const content = truncated ? text.slice(0, MAX_CONTENT) + '\n...[截断]' : text;
      return {
        ok: true,
        output: { content, title, truncated },
        display: title ? `[${title}]\n${content.slice(0, 500)}...` : content.slice(0, 500),
      };
    } catch (e: any) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted', recoverable: false };
      return { ok: false, error: e.message ?? 'fetch_failed', recoverable: true };
    }
  },
};
