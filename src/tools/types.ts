export interface ToolContent {
    type: "text";
    text: string;
}

export interface ToolResult {
    content: ToolContent[];
    details: unknown;
}

export interface AgentTool<TParams = unknown> {
    name: string;
    label: string;
    description: string;
    parameters: any;
    execute(id: string, params: TParams): Promise<ToolResult>;
}
