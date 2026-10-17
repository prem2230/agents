import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AVAILABLE_TOOLS, type AgentDefinition, type AgentTool } from "./agent-definition.js";
import { readFile, writeFile } from "node:fs/promises";


const projectDir = dirname(fileURLToPath(import.meta.url));

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDefinition(value: unknown): AgentDefinition {
    if (!isRecord(value)) {
        throw new Error("Agent definition must be a JSON object.");
    }

    const { name, description, instructions, tools } = value;

    if (
        typeof name !== "string" ||
        typeof description !== "string" ||
        typeof instructions !== "string" ||
        !Array.isArray(tools)
    ) {
        throw new Error("Agent definition must have 'name', 'description', 'instructions' as strings and 'tools' as an array.");
    }

    for (const tool of tools) {
        if (
            typeof tool !== "string" ||
            !AVAILABLE_TOOLS.includes(tool as AgentTool)
        ) {
            throw new Error(`Unsupported tool: ${String(tool)}`);
        }
    }

    return {
        name,
        description,
        instructions,
        tools: tools as AgentTool[],
    };
}

export async function loadAgentDefinition(id: string): Promise<AgentDefinition> {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new Error("Invalid agent ID. Only alphanumeric characters, underscores, and hyphens are allowed.");
    }

    const filePath = (join(projectDir, "saved-agents", `${id}.json`));
    const json = await readFile(filePath, "utf8");

    return validateDefinition(JSON.parse(json));
}

export async function saveAgentDefinition(
    id: string,
    value: unknown,
): Promise<AgentDefinition> {
    if (!/^[a-z0-9-]+$/.test(id)) {
        throw new Error(
            "Agent ID can contain only lowercase letters, numbers, and hyphens.",
        );
    }

    const definition = validateDefinition(value);
    const filePath = join(projectDir, "saved-agents", `${id}.json`);

    // "wx" prevents accidentally replacing an existing agent file.
    await writeFile(filePath, JSON.stringify(definition, null, 2), {
        encoding: "utf8",
        flag: "wx",
    });

    return definition;
}