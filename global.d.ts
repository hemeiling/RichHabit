declare module '*.mjs' {
  export function validateReadOnlyProductionConfig(env?: Record<string, string | undefined>): string;
  export async function inspectProductionReadOnly(options?: {
    env?: Record<string, string | undefined>;
    client?: any;
  }): Promise<Record<string, any>>;
}
