import { GoogleGenAI } from "@google/genai";
import { AppSettings, ProviderType } from "../types";

// Helper to interact with Local LLM (OpenAI compatible /v1/chat/completions)
const generateLocal = async (
  systemPrompt: string,
  userPrompt: string,
  settings: AppSettings
): Promise<string> => {
  try {
    const response = await fetch(`${settings.localBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.localModelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Local LLM Error: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (error: any) {
    console.error("Local Generation failed", error);
    throw new Error(error.message || "Failed to connect to Local LLM");
  }
};

// Helper to interact with Gemini
const generateGemini = async (
  systemPrompt: string,
  userPrompt: string,
  settings: AppSettings
): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Choose appropriate model based on availability logic or user setting
    // Using a reliable Flash model for speed in a spreadsheet context
    const modelName = settings.geminiModelName || 'gemini-2.5-flash';

    const response = await ai.models.generateContent({
      model: modelName,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini");
    }
    return text;
  } catch (error: any) {
    console.error("Gemini Generation failed", error);
    throw new Error(error.message || "Failed to generate with Gemini");
  }
};

export const generateContent = async (
  systemPrompt: string,
  userPrompt: string,
  settings: AppSettings
): Promise<string> => {
  if (settings.provider === ProviderType.LOCAL) {
    return generateLocal(systemPrompt, userPrompt, settings);
  } else {
    return generateGemini(systemPrompt, userPrompt, settings);
  }
};