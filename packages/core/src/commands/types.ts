export type CommandSource = 'builtin' | 'project' | 'user' | 'skill';

export interface Command {
  name: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  body: string;
  source: CommandSource;
  filePath?: string;
}
