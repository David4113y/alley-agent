/**
 * Git & deployment operations — status, diff, commit/push, deploy, revert.
 */
const { execSync } = require("child_process");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

/** Helper: run a shell command in the project root and return stdout. */
function run(cmd) {
  return execSync(cmd, { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 30000 });
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

/**
 * Get list of changed files via `git status --porcelain`.
 * @returns {{ files: string[] }}
 */
function getStatus() {
  try {
    const output = run("git status --porcelain");
    const files = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return { files };
  } catch (err) {
    return { files: [], error: err.message };
  }
}

/**
 * Get the current diff of all unstaged + staged changes.
 * @returns {{ diff: string }}
 */
function getDiff() {
  try {
    // Show both staged and unstaged
    const diff = run("git diff HEAD");
    return { diff: diff || "(no changes)" };
  } catch (err) {
    return { diff: "", error: err.message };
  }
}

/**
 * Stage all changes, commit with the given message, and push to origin main.
 * Uses GITHUB_PAT env var for authentication.
 * @param {string} message — commit message
 * @returns {{ success: boolean, output?: string, error?: string }}
 */
function commitAndPush(message) {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    return { success: false, error: "GITHUB_PAT environment variable is not set." };
  }

  try {
    // Get the current remote URL to extract username/repo
    let remoteUrl;
    try {
      remoteUrl = run("git remote get-url origin").trim();
    } catch {
      return { success: false, error: "No git remote 'origin' configured." };
    }

    // Parse username and repo from various URL formats:
    //   https://github.com/user/repo.git
    //   git@github.com:user/repo.git
    let username, repo;
    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);

    if (httpsMatch) {
      username = httpsMatch[1];
      repo = httpsMatch[2];
    } else if (sshMatch) {
      username = sshMatch[1];
      repo = sshMatch[2];
    } else {
      return { success: false, error: `Could not parse GitHub remote URL: ${remoteUrl}` };
    }

    // Set authenticated remote URL for the push
    const authUrl = `https://${username}:${token}@github.com/${username}/${repo}.git`;

    // Stage, commit, push
    run("git add -A");
    // Ensure git user is configured for the commit
    run('git config user.email "alley-agent@users.noreply.github.com"');
    run('git config user.name "Alley Agent"');
    run(`git commit -m ${JSON.stringify(message)}`);
    run(`git push ${authUrl} HEAD:main`);

    return { success: true, output: `Committed and pushed: "${message}"` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Trigger a deploy on Render by finding the "alley-agent" service
 * and POSTing to its deploy endpoint.
 * @returns {Promise<{ success: boolean, output?: string, error?: string }>}
 */
async function triggerDeploy() {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) {
    return { success: false, error: "RENDER_API_KEY environment variable is not set." };
  }

  try {
    // Step 1 — find the service ID by listing services
    const listResp = await fetch("https://api.render.com/v1/services?limit=50", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!listResp.ok) {
      const body = await listResp.text();
      return { success: false, error: `Render API error listing services: ${listResp.status} — ${body}` };
    }

    const services = await listResp.json();
    // Render returns [{ service: { id, name, ... } }, ...]
    const match = services.find(
      (s) => (s.service?.name || s.name || "").toLowerCase() === "alley-agent"
    );

    if (!match) {
      return { success: false, error: 'Could not find a Render service named "alley-agent".' };
    }

    const serviceId = match.service?.id || match.id;

    // Step 2 — trigger a deploy
    const deployResp = await fetch(
      `https://api.render.com/v1/services/${serviceId}/deploys`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ clearCache: false }),
      }
    );

    if (!deployResp.ok) {
      const body = await deployResp.text();
      return { success: false, error: `Render deploy trigger failed: ${deployResp.status} — ${body}` };
    }

    const deployData = await deployResp.json();
    return {
      success: true,
      output: `Deploy triggered for service ${serviceId}. Deploy ID: ${deployData.id || deployData.deploy?.id || "unknown"}`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Revert all uncommitted changes.
 * @returns {{ success: boolean, output?: string, error?: string }}
 */
function revertChanges() {
  try {
    run("git checkout -- .");
    // Also remove any untracked files that were added
    run("git clean -fd");
    return { success: true, output: "All uncommitted changes reverted." };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { getStatus, getDiff, commitAndPush, triggerDeploy, revertChanges };
