export const AVAILABLE_TOOLS = ["search_notes"] as const;

export type AgentTool = (typeof AVAILABLE_TOOLS)[number];

export interface AgentDefinition {
    name: string;
    description: string;
    instructions: string;
    tools: AgentTool[];
}