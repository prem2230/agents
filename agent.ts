import { GoogleGenAI, Type, type Content } from "@google/genai";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.MODEL_API_KEY;
const model: string = process.env.MODEL_NAME || "gemini-3.1-flash-lite";

if (!apiKey) {
    throw new Error("MODEL_API_KEY is not defined in the environment variables.");
}

if (!model) {
    throw new Error("MODEL_NAME is not defined in the environment variables.");
}

const ai = new GoogleGenAI({ apiKey });

async function searchNotes(query: string): Promise<string> {
    const notesDir = join(process.cwd(), "notes");
    const files = (await import("fs/promises")).readdir;
    const names = await files(notesDir);
    const matches: string[] = [];

    for (const name of names.filter((name) => name.endsWith(".txt"))) {
        const contents = await readFile(join(notesDir, name), "utf-8");

        contents.split(/\r?\n/).forEach((line, index) => {
            if (line.toLowerCase().includes(query.toLowerCase())) {
                matches.push(`${name}:${index + 1}: ${line}`);
            }
        });
    }

    return matches.length ? matches.join("\n") : "No matching lines found.";

}

const tools = [
    {
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
                }
            }
        ]
    }
];

async function askAgent(question: string): Promise<string> {
    const first = await ai.models.generateContent({
        model,
        contents: question,
        config: {
            systemInstruction:
                "You are a notes assistant. Search the user's notes when needed. If the notes do not contain the answer, say so.",
            tools,
        }
    });

    const call = first.functionCalls?.[0];

    if (!call || call.name !== "search_notes") {
        return first.text ?? "The model returned no text.";
    }

    const modelTurn = first.candidates?.[0]?.content;
    if (!modelTurn) {
        throw new Error("Gemini returned a tool call without model content.");
    }

    const query = String(call.args?.query ?? "");
    const searchResult = await searchNotes(query);

    const contents: Content[] = [
        { role: "user", parts: [{ text: question }] },
        modelTurn,
        {
            role: "user",
            parts: [
                {
                    functionResponse: {
                        name: "search_notes",
                        response: { result: searchResult },
                    },
                },
            ],
        },
    ];

    const followUp = await ai.models.generateContent({
        model,
        contents,
        config: {
            systemInstruction:
                "Answer using the notes search result. If it does not contain the answer, say so.",
            tools,
        }
    });

    return followUp.text ?? "The model returned no text.";
}

while (true) {
    const question = (await import("node:readline/promises")).createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const input = await question.question("\nYou (type exit to quit): ");
    question.close();

    if (input.trim().toLowerCase() === "exit") break;

    try {
        console.log("\nAgent:", await askAgent(input));
    } catch (error) {
        console.error("Agent error:", error);
    }
}