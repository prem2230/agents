import { GoogleGenAI, Type } from "@google/genai";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";
import { AVAILABLE_TOOLS } from "./agent-definition.js";
import { saveAgentDefinition } from "./agent-store.js";

dotenv.config();

const apiKey = process.env.MODEL_API_KEY;
const model = process.env.MODEL_NAME || "gemini-3.1-flash-lite";

if (!apiKey) {
    throw new Error("MODEL_API_KEY is not defined in the environment variables.");
}

const ai = new GoogleGenAI({ apiKey });
const readline = createInterface({ input: stdin, output: stdout });

try {
    const prompt = await readline.question("Describe the agent you want to create: ");

    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            systemInstruction:
                `Turn the user's description into an agent definition. ` +
                `Choose tools only from this list: ${AVAILABLE_TOOLS.join(", ")}. ` +
                "Do not generate code. Return a concise name, description, and instructions.",
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING },
                    description: { type: Type.STRING },
                    instructions: { type: Type.STRING },
                    tools: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.STRING,
                            enum: [...AVAILABLE_TOOLS],
                        },
                    },
                },
                required: ["name", "description", "instructions", "tools"],
            },
        },
    });
    const definition = JSON.parse(response.text ?? "");
    console.log("\nGenerated agent definition:");
    console.log(JSON.stringify(definition, null, 2));

    const id = (
        await readline.question(
            "\nChoose a unique ID for this agent (lowercase letters, numbers, hyphens): ",
        )
    )
        .trim()
        .toLowerCase();

    if (!/^[a-z0-9-]+$/.test(id)) {
        throw new Error("Use only lowercase letters, numbers, and hyphens for the ID.");
    }

    const saved = await saveAgentDefinition(id, definition);
    console.log(`\nSaved "${saved.name}" as saved-agents/${id}.json`);
} finally {
    readline.close();
}