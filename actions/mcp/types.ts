export type ActionHandlerResult = {
  content: { type: "text"; text: string }[];
  [key: string]: any;
};

export interface Action {
  name: string;
  version: string;
  definition: {
    title: string;
    description: string;
    inputSchema: {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };
    annotations?: {
      destructiveHint?: boolean;
      openWorldHint?: boolean;
      readOnlyHint?: boolean;
      idempotentHint?: boolean;
    };
  };
  handler: (args: any) => Promise<ActionHandlerResult>;
}
