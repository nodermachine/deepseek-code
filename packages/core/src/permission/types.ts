export type PermissionDecision = 'allow' | 'deny' | 'ask' | 'forbidden';

export interface PermissionRule {
  tool: string;
  matcher: string;
  decision: 'allow' | 'deny' | 'ask';
}
