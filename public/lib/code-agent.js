/**
 * Code Agent — tool-calling agent loop that lets the LLM
 * read, write, list, and search the project's own source code.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { commitAndPush, triggerDeploy } = require("./git-ops");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MAX_ITERATIONS = 15;

// Paths that must never be read or written
const BLOCKED_PATTERNS = [".env", "node_modules", ".git"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if `relPath` touches a blocked location. */
function isBlocked(relPath) {
  const normalized = path.normalize(relPath);
  return BLOCKED_PATTERNS.some(
    (p) =>
      normalized === p ||
      normalized.startsWith(p + path.sep) ||
      normalized.includes(path.sep + p + path.sep) ||
      normalized.includes(path.sep + p)
  );
}

/** Resolve a user-supplied relative path to an absolute one inside the project. */
function safePath(relPath) {
  const abs = path.resolve(PROJECT_ROOT, relPath);
  if (!abs.startsWith(PROJECT_ROOT)) {
    throw new Error("Path escapes project root");
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * List files in a directory (non-recursive, single level).
 * Excludes blocked directories.
 */
function listFiles(directory = ".") {
  if (isBlocked(directory)) return "Access denied: blocked path.";
  try {
    const abs = safePath(directory);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const lines = entries
      .filter((e) => !BLOCKED_PATTERNS.includes(e.name))
      .map((e) => (e.isDirectory() ? e.name + "/" : e.name));
    return lines.join("\n") || "(empty directory)";
  } catch (err) {
    return `Error listing files: ${err.message}`;
  }
}

/**
 * Read a file's contents (relative to project root).
 */
function readFile(filePath) {
  if (isBlocked(filePath)) return "Access denied: blocked path.";
  try {
    const abs = safePath(filePath);
    const content = fs.readFileSync(abs, "utf-8");
    // Cap at ~60 KB to avoid blowing up context
    if (content.length > 60000) {
      return content.slice(0, 60000) + "\n\n... (truncated — file too large)";
    }
    return content;
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
}

/**
 * Write (or overwrite) a file. Creates parent directories as needed.
 * Returns confirmation or error.
 */
function writeFile(filePath, content) {
  if (isBlocked(filePath)) return "Access denied: blocked path.";
  try {
    const abs = safePath(filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
    return `File written: ${filePath}`;
  } catch (err) {
    return `Error writing file: ${err.message}`;
  }
}

/**
 * Search for a regex pattern across project files.
 * Optional glob-style filter (simple: checks if filename ends with the glob suffix).
 * Returns matching lines with file:line references.
 */
function searchCode(pattern, glob) {
  const results = [];
  let regex;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return `Invalid regex: ${pattern}`;
  }

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (BLOCKED_PATTERNS.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        // Optional glob filter — match against filename or relative path
        if (glob) {
          const rel = path.relative(PROJECT_ROOT, full);
          const suffix = glob.replace(/^\*+/, ""); // e.g. "*.js" → ".js"
          if (suffix && !rel.endsWith(suffix)) continue;
        }
        try {
          const content = fs.readFileSync(full, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const rel = path.relative(PROJECT_ROOT, full);
              results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
              if (results.length >= 80) return; // cap results
            }
          }
        } catch {
          // skip binary / unreadable files
        }
      }
    }
  }

  walk(PROJECT_ROOT);
  return results.length > 0
    ? results.join("\n")
    : "No matches found.";
}

// ---------------------------------------------------------------------------
// New tool implementations: run_command, edit_file, git_commit_and_deploy
// ---------------------------------------------------------------------------

/**
 * Whitelisted command prefixes the agent is allowed to run.
 */
const ALLOWED_COMMANDS = [
  "npm install", "npm test", "npm run", "npm ls", "npm outdated",
  "node -e", "node -p",
  "ls", "cat", "wc", "head", "tail", "find", "du -sh",
  "pwd", "echo",
];

/** Patterns that must never appear in a command. */
const BLOCKED_ARGS = [
  "rm -rf /", "rm -rf ~", "rm -rf .",
  "curl", "wget", "eval", "exec",
  ">/dev/", "| bash", "| sh",
  "sudo", "chmod 777",
  ".env", "GITHUB_PAT", "GROQ_API_KEY", "RENDER_API_KEY",
];

/**
 * Run a whitelisted shell command in the project root.
 * @param {string} command — the command to execute
 * @returns {string} stdout or error message
 */
function runCommand(command) {
  if (!command || typeof command !== "string") {
    return "Error: No command provided.";
  }

  const trimmed = command.trim();

  // Check against blocklist
  for (const blocked of BLOCKED_ARGS) {
    if (trimmed.includes(blocked)) {
      return `Blocked: command contains forbidden pattern "${blocked}".`;
    }
  }

  // Check against allowlist
  const allowed = ALLOWED_COMMANDS.some((prefix) => trimmed.startsWith(prefix));
  if (!allowed) {
    return `Blocked: command not in allowlist. Allowed prefixes: ${ALLOWED_COMMANDS.join(", ")}`;
  }

  try {
    const output = execSync(trimmed, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 1024 * 512, // 512 KB
    });
    const result = output || "(no output)";
    return result.length > 10000
      ? result.slice(0, 10000) + "\n... (truncated)"
      : result;
  } catch (err) {
    return `Command failed: ${err.message}`;
  }
}

/**
 * Edit a file by finding a search string and replacing it.
 * More precise than rewriting the whole file.
 * @param {string} filePath — relative path
 * @param {string} search — exact string to find
 * @param {string} replace — replacement string
 * @returns {string} confirmation or error
 */
function editFile(filePath, search, replace) {
  if (isBlocked(filePath)) return "Access denied: blocked path.";
  if (!search) return "Error: search string is required.";
  try {
    const abs = safePath(filePath);
    const content = fs.readFileSync(abs, "utf-8");
    if (!content.includes(search)) {
      return `Error: search string not found in ${filePath}. Use read_file to check the exact content first.`;
    }
    const count = content.split(search).length - 1;
    const newContent = content.replace(search, replace);
    fs.writeFileSync(abs, newContent, "utf-8");
    return `File edited: ${filePath} (replaced 1 of ${count} occurrence(s) of the search string)`;
  } catch (err) {
    return `Error editing file: ${err.message}`;
  }
}

/**
 * Commit all changes to git, push to GitHub, and optionally trigger a Render deploy.
 * @param {string} message — commit message
 * @param {boolean} deploy — whether to also trigger a deploy (default false)
 * @returns {Promise<string>} result summary
 */
async function gitCommitAndDeploy(message, deploy) {
  if (!message) return "Error: commit message is required.";

  const commitResult = commitAndPush(message);
  if (!commitResult.success) {
    return `Git commit/push failed: ${commitResult.error}`;
  }

  let output = commitResult.output;

  if (deploy) {
    const deployResult = await triggerDeploy();
    if (deployResult.success) {
      output += `\n${deployResult.output}`;
    } else {
      output += `\nDeploy trigger failed: ${deployResult.error}`;
    }
  }

  return output;
}

// ---------------------------------------------------------------------------
// Tool definitions for Groq / OpenAI function-calling
// ---------------------------------------------------------------------------

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        'List files and directories in a given directory (relative to project root). Defaults to "." for the root. Excludes node_modules, .git, .env.',
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description: 'Directory path relative to project root (default ".")',
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file (path relative to project root). Blocked for .env, node_modules, .git.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to project root" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write or overwrite a file (path relative to project root). Creates parent dirs as needed. Blocked for .env, node_modules, .git.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to project root" },
          content: { type: "string", description: "The full file content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Search for a regex pattern across project source files. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          glob: {
            type: "string",
            description: 'Optional file filter, e.g. "*.js" or "*.html"',
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a whitelisted shell command in the project root. Allowed: npm install/test/run, node -e/-p, ls, cat, wc, head, tail, find, du, pwd, echo. Blocked: rm -rf, curl, wget, sudo, and anything touching secrets.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Edit a file by finding an exact string and replacing it. More precise than write_file — use this for targeted changes. Only replaces the first occurrence.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to project root" },
          search: { type: "string", description: "The exact string to find in the file" },
          replace: { type: "string", description: "The string to replace it with" },
        },
        required: ["path", "search", "replace"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_commit_and_deploy",
      description:
        "Stage all changes, commit with the given message, push to GitHub, and optionally trigger a Render deploy. Use after making and verifying code changes.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Git commit message" },
          deploy: {
            type: "boolean",
            description: "Whether to also trigger a Render deploy after pushing (default false)",
          },
        },
        required: ["message"],
      },
    },
  },
];

// Map tool names to handler functions (some are async)
function executeTool(name, args) {
  switch (name) {
    case "list_files":
      return listFiles(args.directory);
    case "read_file":
      return readFile(args.path);
    case "write_file":
      return writeFile(args.path, args.content);
    case "search_code":
      return searchCode(args.pattern, args.glob);
    case "run_command":
      return runCommand(args.command);
    case "edit_file":
      return editFile(args.path, args.search, args.replace);
    case "git_commit_and_deploy":
      return gitCommitAndDeploy(args.message, args.deploy);
    default:
      return `Unknown tool: ${name}`;
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Alleyesonme-AI in Developer Mode. You have tools to read, write, edit, list, search, run commands, and deploy the project's source code. The project is a Node.js/Express web app.

When asked to make changes:
1. Read the relevant files first to understand the current code.
2. Prefer edit_file for targeted changes instead of rewriting entire files with write_file.
3. Use run_command to test changes (e.g. "node -e" to check syntax, "npm test" to run tests).
4. Always explain what you changed and why.
5. Be careful not to break the app.
6. Only use git_commit_and_deploy when you are confident the changes are correct.

Available tools:
- list_files: List directory contents
- read_file: Read a file
- write_file: Write/overwrite a full file
- edit_file: Find-and-replace within a file (preferred for small changes)
- search_code: Regex search across project files
- run_command: Run whitelisted shell commands (npm, node, ls, cat, etc.)
- git_commit_and_deploy: Commit, push to GitHub, and optionally trigger Render deploy

All paths are relative to the project root.`;

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

/**
 * Run the code agent with a user prompt.
 * @param {string} prompt — the admin's instruction
 * @param {Function} [onStep] — optional callback(stepObj) for live progress reporting
 * @returns {Promise<{ response: string, filesModified: string[], toolCalls: object[] }>}
 */
async function runCodeAgent(prompt, onStep) {
  const { default: OpenAI } = await import("openai");

  const step = onStep || (() => {});

  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const model = process.env.LLM_MODEL || "llama-3.3-70b-versatile";
  const filesModified = [];
  const toolCallLog = [];

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    step({ type: "thinking", iteration: i + 1, label: i === 0 ? "Analyzing your request..." : `Iteration ${i + 1} — thinking...` });

    const resp = await client.chat.completions.create({
      model,
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      max_tokens: 4096,
      temperature: 0.2,
    });

    const choice = resp.choices[0];

    // If the LLM finishes with a text response (no tool calls), we're done
    if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
      step({ type: "done", label: "Complete" });
      return {
        response: choice.message.content || "(no response)",
        filesModified: [...new Set(filesModified)],
        toolCalls: toolCallLog,
      };
    }

    // Append the assistant message (with tool_calls) to conversation
    messages.push(choice.message);

    // Execute each tool call and feed results back
    for (const tc of choice.message.tool_calls) {
      let args;
      try {
        args = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
      } catch {
        args = {};
      }

      // Describe the tool call for the live feed
      const toolLabel = describeToolCall(tc.function.name, args);
      step({ type: "tool_call", name: tc.function.name, args, label: toolLabel });

      const result = await Promise.resolve(executeTool(tc.function.name, args));

      // Track modified files
      if (tc.function.name === "write_file" && args.path && !result.startsWith("Error") && !result.startsWith("Access denied")) {
        filesModified.push(args.path);
      }
      if (tc.function.name === "edit_file" && args.path && typeof result === "string" && result.startsWith("File edited:")) {
        filesModified.push(args.path);
      }

      const logEntry = {
        name: tc.function.name,
        args,
        result: typeof result === "string" && result.length > 2000
          ? result.slice(0, 2000) + "... (truncated in log)"
          : result,
      };
      toolCallLog.push(logEntry);

      // Report tool result
      const success = typeof result === "string" && !result.startsWith("Error") && !result.startsWith("Blocked") && !result.startsWith("Access denied");
      step({ type: "tool_result", name: tc.function.name, success, label: success ? toolLabel + " ✓" : toolLabel + " ✗" });

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
  }

  // Hit iteration limit
  step({ type: "done", label: "Reached iteration limit" });
  return {
    response: "Reached maximum iterations (15). The task may be incomplete.",
    filesModified: [...new Set(filesModified)],
    toolCalls: toolCallLog,
  };
}

/** Human-readable description of a tool call. */
function describeToolCall(name, args) {
  switch (name) {
    case "list_files": return `Listing files in ${args.directory || "."}`;
    case "read_file": return `Reading ${args.path}`;
    case "write_file": return `Writing ${args.path}`;
    case "edit_file": return `Editing ${args.path}`;
    case "search_code": return `Searching for "${(args.pattern || "").slice(0, 40)}"`;
    case "run_command": return `Running: ${(args.command || "").slice(0, 50)}`;
    case "git_commit_and_deploy": return `Committing: ${(args.message || "").slice(0, 50)}`;
    default: return `Calling ${name}`;
  }
}

module.exports = { runCodeAgent };
