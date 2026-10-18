import { GoogleGenAI, Type, type Content } from "@google/genai";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAgentDefinition } from "./agent-store.js";

dotenv.config();

const apiKey = process.env.MODEL_API_KEY;
const model = process.env.MODEL_NAME || "gemini-3.1-flash-lite";
const agentId = process.argv[2];

if (!apiKey) throw new Error("MODEL_API_KEY is not set in .env.");
if (!agentId) throw new Error("Pass the saved agent ID, for example: lyric123.");

const agent = await loadAgentDefinition(agentId);
const ai = new GoogleGenAI({ apiKey });
const history: Content[] = [];
const readline = createInterface({ input: stdin, output: stdout });

async function searchNotes(query: string): Promise<string> {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
        return "No search query was provided.";
    }

    const notesDir = join(process.cwd(), "notes");
    const files = await readdir(notesDir);
    const matches: string[] = [];

    for (const file of files.filter((name) => name.endsWith(".txt"))) {
        const text = await readFile(join(notesDir, file), "utf8");

        text.split(/\r?\n/).forEach((line, index) => {
            if (line.toLowerCase().includes(normalizedQuery)) {
                matches.push(`${file}:${index + 1}: ${line}`);
            }
        });
    }

    return matches.length > 0 ? matches.join("\n") : "No matching lines found.";
}

const searchNotesTool = {
    functionDeclarations: [
        {
            name: "search_notes",
            description: "Search the user's text notes for a word or phrase.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: {
                        type: Type.STRING,
                        description: "The word or phrase to search for",
                    },
                },
                required: ["query"],
            },
        },
    ],
};

const addNumbersTool = {
    functionDeclarations: [
        {
            name: "add_numbers",
            description: "Add two numbers and return their sum.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    a: { type: Type.NUMBER, description: "The first number" },
                    b: { type: Type.NUMBER, description: "The second number" },
                },
                required: ["a", "b"],
            },
        },
    ],
};

const delegateToAgentTool = {
    functionDeclarations: [
        {
            name: "delegate_to_agent",
            description: "Send a task to another saved specialist agent and return its answer.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    agentId: {
                        type: Type.STRING,
                        description: "The ID of the saved specialist agent",
                        enum: ["lyric123"],
                    },
                    task: {
                        type: Type.STRING,
                        description: "The specific task to give that agent",
                    },
                },
                required: ["agentId", "task"],
            },
        },
    ],
};

const functionDeclarations = [
    ...(agent.tools.includes("search_notes")
        ? searchNotesTool.functionDeclarations
        : []),
    ...(agent.tools.includes("add_numbers")
        ? addNumbersTool.functionDeclarations
        : []),
    ...(agent.tools.includes("delegate_to_agent")
        ? delegateToAgentTool.functionDeclarations
        : []),
];

const modelConfig = {
    systemInstruction: agent.instructions,
    ...(functionDeclarations.length > 0
        ? { tools: [{ functionDeclarations }] }
        : {}),
};

async function delegateToSavedAgent(
    targetAgentId: string,
    task: string,
): Promise<string> {
    if (targetAgentId !== "lyric123") {
        throw new Error(`Delegation to "${targetAgentId}" is not enabled yet.`);
    }

    const specialist = await loadAgentDefinition(targetAgentId);

    if (specialist.tools.length > 0) {
        throw new Error(
            "This first delegation version only supports agents without tools.",
        );
    }

    console.log(`[Handoff] Sending task to ${specialist.name} (${targetAgentId}).`);

    const response = await ai.models.generateContent({
        model,
        contents: task,
        config: {
            systemInstruction: specialist.instructions,
        },
    });

    const answer = response.text?.trim();
    if (!answer) {
        throw new Error(`${specialist.name} returned no text.`);
    }

    console.log(`[Handoff] ${specialist.name} replied.`);

    return answer;
}

async function answerMessage(message: string): Promise<string> {
    const userTurn: Content = {
        role: "user",
        parts: [{ text: message }],
    };

    const firstResponse = await ai.models.generateContent({
        model,
        contents: [...history, userTurn],
        config: modelConfig,
    });

    const toolCall = firstResponse.functionCalls?.[0];

    // The model answered without calling a tool.
    if (!toolCall) {
        const answer = firstResponse.text?.trim();

        if (!answer) {
            throw new Error("The model returned no text.");
        }

        history.push(
            userTurn,
            firstResponse.candidates?.[0]?.content ?? {
                role: "model",
                parts: [{ text: answer }],
            },
        );

        if (history.length > 20) {
            history.splice(0, history.length - 20);
        }

        return answer;
    }

    // Preserve Gemini's original tool-call content and thought signature.
    const modelToolTurn = firstResponse.candidates?.[0]?.content;

    if (!modelToolTurn) {
        throw new Error("Gemini returned a tool call without model content.");
    }

    let toolResult: Record<string, unknown>;

    if (toolCall.name === "search_notes") {
        const result = await searchNotes(
            String(toolCall.args?.query ?? ""),
        );
        toolResult = { result };
    } else if (toolCall.name === "add_numbers") {
        const a = Number(toolCall.args?.a);
        const b = Number(toolCall.args?.b);

        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            throw new Error("add_numbers requires two valid numbers.");
        }

        toolResult = { sum: a + b };
    }
    else if (toolCall.name === "delegate_to_agent") {
        const targetAgentId = String(toolCall.args?.agentId ?? "");
        const task = String(toolCall.args?.task ?? "");

        if (!task.trim()) {
            throw new Error("delegate_to_agent requires a task.");
        }

        const result = await delegateToSavedAgent(targetAgentId, task);
        toolResult = { agentId: targetAgentId, result };
    } else {
        throw new Error(`Unsupported tool requested: ${toolCall.name}`);
    }

    const functionResponseTurn: Content = {
        role: "user",
        parts: [
            {
                functionResponse: {
                    name: toolCall.name,
                    response: toolResult,
                },
            },
        ],
    };

    const finalResponse = await ai.models.generateContent({
        model,
        contents: [
            ...history,
            userTurn,
            modelToolTurn,
            functionResponseTurn,
        ],
        config: modelConfig,
    });

    const answer = finalResponse.text?.trim();

    if (!answer) {
        throw new Error("The model returned no text after the tool call.");
    }

    history.push(
        userTurn,
        finalResponse.candidates?.[0]?.content ?? {
            role: "model",
            parts: [{ text: answer }],
        },
    );

    if (history.length > 20) {
        history.splice(0, history.length - 20);
    }

    return answer;
}

try {
    console.log(`${agent.name} is ready. Type "exit" to quit.`);

    if (agent.tools.includes("search_notes")) {
        console.log("This agent can search .txt files in the notes folder.");
    }

    while (true) {
        const message = (await readline.question("\nYou: ")).trim();

        if (message.toLowerCase() === "exit") {
            break;
        }

        if (!message) {
            continue;
        }

        try {
            const answer = await answerMessage(message);
            console.log(`\n${agent.name}:`, answer);
        } catch (error) {
            console.error("Agent error:", error);
        }
    }
} finally {
    readline.close();
}