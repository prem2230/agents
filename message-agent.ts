import { GoogleGenAI, type Content } from "@google/genai";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.MODEL_API_KEY;
const model = process.env.MODEL_NAME || "gemini-3.1-flash-lite";

if (!apiKey) {
  throw new Error("MODEL_API_KEY is not defined in the environment variables.");
}

const ai = new GoogleGenAI({ apiKey });
const history: Content[] = [];
const readline = createInterface({ input: stdin, output: stdout });

async function answerMessage(message: string): Promise<string> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      ...history,
      { role: "user", parts: [{ text: message }] },
    ],
    config: {
      systemInstruction:
        "You are a helpful user-message assistant. Answer the user's questions clearly and directly. If the request is ambiguous, ask one concise clarifying question. If you are unsure of a fact, say so instead of inventing an answer.",
    },
  });

  const answer = response.text?.trim();
  if (!answer) {
    throw new Error("The model returned no text.");
  }

  // Preserve the model's returned content so conversation context stays intact.
  const modelTurn = response.candidates?.[0]?.content;
  history.push(
    { role: "user", parts: [{ text: message }] },
    modelTurn ?? { role: "model", parts: [{ text: answer }] },
  );

  // Keep only the latest 10 exchanges to limit context growth.
  if (history.length > 20) history.splice(0, history.length - 20);

  return answer;
}

try {
  console.log(`Message agent ready (${model}). Type "exit" to quit.`);

  while (true) {
    const message = (await readline.question("\nUser: ")).trim();
    if (message.toLowerCase() === "exit") break;
    if (!message) continue;

    try {
      console.log("\nAgent:", await answerMessage(message));
    } catch (error) {
      console.error("Agent error:", error);
    }
  }
} finally {
  readline.close();
}
