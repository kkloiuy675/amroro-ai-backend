const express = require('express');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

// Load API key and PORT from environment variables for hosting
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const AVAILABLE_MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
];

const SYSTEM_INSTRUCTION = `You are an expert Roblox Luau script, Sound, and VFX generator.

YOUR CAPABILITIES & INTENTS:
1. If the user asks to IMPORT an asset, model, sound, or VFX:
   - Output ONLY a block formatted like this:
     ACTION_TYPE: IMPORT
     ASSET_NAME: <name of asset requested>
     ACTION_SUMMARY: Searching and importing requested asset or creating custom VFX/Sound.

2. If the user asks to EXPORT selected items:
   - Output ONLY a block formatted like this:
     ACTION_TYPE: EXPORT
     ACTION_SUMMARY: Exporting selected workspace objects.

3. Otherwise, for standard coding tasks:
   - Provide working, valid Roblox Luau code wrapped in standard markdown backticks (\`\`\`lua ... \`\`\`).
   - AT THE VERY END, outside the code block, provide a short summary starting with "ACTION_SUMMARY:".`;

function parseAIResponse(text) {
    let actionType = "CODE";
    let assetName = "";
    let luauCode = "";
    let actionSummary = "Action completed successfully!";

    if (text.includes("ACTION_TYPE: IMPORT")) {
        actionType = "IMPORT";
        const assetMatch = text.match(/ASSET_NAME:\s*(.*)/i);
        if (assetMatch) assetName = assetMatch[1].trim();
    } else if (text.includes("ACTION_TYPE: EXPORT")) {
        actionType = "EXPORT";
    } else {
        const codeMatch = text.match(/```(?:lua)?([\s\S]*?)```/i);
        if (codeMatch && codeMatch[1]) {
            luauCode = codeMatch[1].trim();
        } else {
            luauCode = text.replace(/ACTION_SUMMARY:[\s\S]*/i, '').trim();
        }
    }

    const summaryMatch = text.match(/ACTION_SUMMARY:\s*([\s\S]*)/i);
    if (summaryMatch && summaryMatch[1]) {
        actionSummary = summaryMatch[1].trim();
    }

    return { actionType, assetName, luauCode, actionSummary };
}

async function generateWithTimeout(promptText, timeoutMs = 8000) {
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out on server")), timeoutMs)
    );

    const apiPromise = (async () => {
        for (const modelName of AVAILABLE_MODELS) {
            try {
                const chatSession = ai.chats.create({
                    model: modelName,
                    config: { systemInstruction: SYSTEM_INSTRUCTION }
                });
                const response = await chatSession.sendMessage({ message: promptText });
                if (response && response.text) {
                    return { text: response.text, usedModel: modelName };
                }
            } catch (err) {
                console.error(`Model ${modelName} error:`, err.message);
            }
        }
        throw new Error("All AI models failed.");
    })();

    return Promise.race([apiPromise, timeoutPromise]);
}

app.post('/generate', async (req, res) => {
    const { prompt, gameContext, guiStyle, webUrl } = req.body;

    let userPrompt = `Context: ${gameContext}\nUI Style: ${guiStyle}\nTask: ${prompt}`;
    if (webUrl && webUrl.trim() !== "") {
        userPrompt += `\nReference Web URL: ${webUrl.trim()}`;
    }

    try {
        const result = await generateWithTimeout(userPrompt, 10000);
        const parsed = parseAIResponse(result.text || "");

        return res.json({
            success: true,
            provider: result.usedModel,
            actionType: parsed.actionType,
            assetName: parsed.assetName,
            code: parsed.luauCode,
            summary: parsed.actionSummary
        });
    } catch (err) {
        console.error("Generate Route Error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/auto-fix', async (req, res) => {
    const { brokenCode, errorMsg } = req.body;

    const fixPrompt = `Fix this Roblox Luau code.\nBroken Code:\n${brokenCode}\nError:\n${errorMsg}`;

    try {
        const result = await generateWithTimeout(fixPrompt, 8000);
        const parsed = parseAIResponse(result.text || "");

        return res.json({
            success: true,
            code: parsed.luauCode,
            summary: parsed.actionSummary
        });
    } catch (err) {
        console.error("Auto-Fix Route Error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`AMRORO Server running on port ${PORT}`);
});