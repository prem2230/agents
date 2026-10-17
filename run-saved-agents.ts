import { GoogleGenAI, type Content } from "@google/genai";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";
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

try {
    console.log(`${agent.name} is ready. Type "exit" to quit.`);

    if (agent.tools.length > 0) {
        console.log("Note: this first runner uses instructions only; tools are not connected yet.");
    }

    while (true) {
        const message = (await readline.question("\nYou: ")).trim();
        if (message.toLowerCase() === "exit") break;
        if (!message) continue;

        const response = await ai.models.generateContent({
            model,
            contents: [...history, { role: "user", parts: [{ text: message }] }],
            config: { systemInstruction: agent.instructions },
        });

        const answer = response.text?.trim() || "The model returned no text.";
        console.log(`\n${agent.name}:`, answer);

        history.push(
            { role: "user", parts: [{ text: message }] },
            response.candidates?.[0]?.content ?? {
                role: "model",
                parts: [{ text: answer }],
            },
        );

        if (history.length > 20) history.splice(0, history.length - 20);
    }
} finally {
    readline.close();
}