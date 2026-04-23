const PRIMARY_AI_KEY = process.env.GEMINI_API_KEY;
const BACKUP_AI_KEY = process.env.GROQ_API_KEY;
const PRIMARY_PROVIDER = process.env.PRIMARY_LLM_PROVIDER || 'google';

console.log("Alleyesonme-AI: Systems Online.");
console.log("Active Provider:", PRIMARY_PROVIDER);

// Your logic to handle AI requests starts here
async function getAIResponse(prompt) {
    const key = PRIMARY_AI_KEY || BACKUP_AI_KEY;
    if (!key) return "Error: No API Key found in Environment.";
    
    // The server will now use your Render keys automatically
    console.log("Processing request with " + PRIMARY_PROVIDER);
}
