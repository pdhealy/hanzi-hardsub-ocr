"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function command(file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function fixture(t, agents = [".claude"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "claude-audit-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "project with spaces");
  fs.mkdirSync(workspace);
  for (const file of agents.flatMap(agent => [
    `${agent}/hooks/log_activity.cjs`,
    `${agent}/hooks/run-audit.sh`,
    agent === ".claude" ? ".claude/settings.json" : ".github/hooks/copilot-tool-audit.json",
  ])) {
    const destination = path.join(workspace, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), destination);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith("GIT_") &&
    !["CLAUDE_AUDIT_PROJECT_ID", "COPILOT_AUDIT_PROJECT_ID"].includes(key)
  ));
  command("git", ["init", "--quiet", workspace], { env });
  const input = {
    hook_event_name: "PostToolUse",
    session_id: "test-session",
    tool_use_id: "toolu_test",
    cwd: workspace,
    tool_name: "Bash",
    tool_input: { command: "printf hello", description: "Print greeting" },
    tool_response: { stdout: "hello", stderr: "diagnostic", interrupted: false },
  };
  function invoke(payload = input, agent = ".claude", overrides = {}) {
    return command("bash", [path.join(workspace, agent, "hooks/run-audit.sh")], {
      cwd: root,
      env: { ...env, COPILOT_CLI: "1", ...overrides },
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }
  function logs(agent = ".claude") {
    const logRoot = path.join(workspace, agent, "logs");
    if (!fs.existsSync(logRoot)) return [];
    return fs.readdirSync(logRoot, { recursive: true })
      .filter(file => file.endsWith("tool-activity.jsonl"))
      .flatMap(file => {
        const logFile = path.join(logRoot, file);
        return fs.readFileSync(logFile, "utf8").trim().split("\n")
          .map(line => ({ entry: JSON.parse(line), directory: path.dirname(logFile) }));
      });
  }
  return { root, workspace, env, input, invoke, logs };
}

test("Claude-only installation keeps native names, metadata, stdout/stderr and private logs", t => {
  const f = fixture(t);
  assert.equal(fs.existsSync(path.join(f.workspace, ".copilot")), false);
  assert.equal(fs.existsSync(path.join(f.workspace, ".github")), false);
  const result = f.invoke({
    ...f.input,
    agent_id: "agent-test",
    agent_type: "test-agent",
    permission_mode: "default",
    transcript_path: "/not/read/by/logger.jsonl",
    duration_ms: 12,
  });
  assert.equal(result.stdout, "{}\n");
  assert.equal(result.stderr, "");
  const [{ entry, directory }] = f.logs();
  assert.equal(entry.hookEvent, "PostToolUse");
  assert.equal(entry.toolName, "Bash");
  assert.deepEqual(entry.toolArgs, f.input.tool_input);
  assert.equal(entry.bashCommand, "printf hello");
  assert.equal(entry.toolResultPreview, "hello\ndiagnostic");
  assert.equal(entry.sessionId, "test-session");
  assert.equal(entry.toolUseId, "toolu_test");
  assert.equal(entry.agentId, "agent-test");
  assert.equal(entry.agentType, "test-agent");
  assert.equal(entry.permissionMode, "default");
  assert.equal(entry.transcriptPath, "/not/read/by/logger.jsonl");
  assert.equal(entry.durationMs, 12);
  assert.equal(entry.projectRoot, fs.realpathSync(f.workspace));
  assert.equal(entry.projectResolution, "git");
  assert.match(entry.projectId, /^project-with-spaces-[a-f0-9]{12}$/);
  const markdown = fs.readFileSync(path.join(directory, "postToolUse.md"), "utf8");
  assert.match(markdown, /```bash\nprintf hello\n```/);
  assert.match(markdown, /hello\ndiagnostic/);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  for (const file of ["tool-activity.jsonl", "postToolUse.md"]) {
    assert.equal(fs.statSync(path.join(directory, file)).mode & 0o777, 0o600);
  }
  assert.deepEqual(f.logs(".copilot"), []);
  assert.equal(fs.existsSync(path.join(f.workspace, ".copilot")), false);
});

test("Claude failure logs error and interruption even if a response is also present", t => {
  const f = fixture(t);
  f.invoke({
    ...f.input,
    hook_event_name: "PostToolUseFailure",
    error: "Exit code 7\nexpected failure",
    is_interrupt: false,
  });
  const [{ entry, directory }] = f.logs();
  assert.equal(entry.hookEvent, "PostToolUseFailure");
  assert.equal(entry.error, "Exit code 7\nexpected failure");
  assert.equal(entry.isInterrupt, false);
  assert.equal(entry.toolResultPreview, undefined);
  assert.match(fs.readFileSync(path.join(directory, "postToolUse.md"), "utf8"),
    /\*\*Tool failed\*\*[\s\S]*Exit code 7\nexpected failure/);
});

test("Read, Write, Edit and MCP completions get JSONL records but no Bash markdown", t => {
  const f = fixture(t);
  for (const tool of ["Read", "Write", "Edit", "mcp__fixture__lookup"]) {
    f.invoke({
      ...f.input,
      tool_name: tool,
      tool_input: { file_path: "/fixture.txt" },
      tool_response: { type: "text", content: "fixture" },
    });
  }
  const records = f.logs();
  assert.equal(records.length, 4);
  for (const { entry, directory } of records) {
    assert.equal(entry.bashCommand, undefined);
    assert.equal(entry.toolResultType, "text");
    assert.equal(entry.toolResultPreview, '{"type":"text","content":"fixture"}');
    assert.equal(fs.existsSync(path.join(directory, "postToolUse.md")), false);
  }
});

test("pre-tool and session events are ignored before project discovery", t => {
  const f = fixture(t);
  for (const hook_event_name of ["PreToolUse", "SessionStart", "Stop"]) {
    const result = f.invoke({ hook_event_name, cwd: "/does-not-exist" });
    assert.equal(result.stdout, "{}\n");
    assert.equal(result.stderr, "");
  }
  assert.deepEqual(f.logs(), []);
});

test("malformed and incomplete native payloads warn without changing tool decisions", t => {
  const f = fixture(t);
  for (const payload of [
    "{broken", "null", "[]", "{}", { ...f.input, tool_input: [] },
    { ...f.input, tool_response: undefined },
    { ...f.input, hook_event_name: "PostToolUseFailure", error: undefined },
  ]) {
    const result = f.invoke(payload);
    assert.equal(result.stdout, "{}\n");
    assert.match(result.stderr, /invalid .*payload/);
  }
  const oversized = f.invoke("x".repeat(10 * 1024 * 1024 + 1));
  assert.equal(oversized.stdout, "{}\n");
  assert.match(oversized.stderr, /payload exceeded/);
  assert.deepEqual(f.logs(), []);
});

test("string, output and newline-delimited responses retain fenced and truncated output", t => {
  const f = fixture(t);
  const text = "```embedded\n" + "x".repeat(17_000) + "\n" + "line\n".repeat(40);
  f.invoke(`not JSON\n${JSON.stringify({ ...f.input, tool_response: text })}\n`);
  f.invoke({ ...f.input, tool_response: { output: "alternate output" } });
  const records = f.logs();
  assert.equal(records.length, 2);
  assert.equal(records[0].entry.toolResultPreview.length, 500);
  assert.equal(records[1].entry.toolResultPreview, "alternate output");
  const markdown = fs.readFileSync(path.join(records[0].directory, "postToolUse.md"), "utf8");
  assert.match(markdown, /````plaintext\n```embedded/);
  assert.match(markdown, /characters omitted/);
  assert.match(markdown, /lines omitted/);
  assert.ok(markdown.length < 18_000);
});

test("nested and symlink cwd group together while other checkouts stay separate", t => {
  const f = fixture(t);
  const nested = path.join(f.workspace, "nested");
  const alias = path.join(f.root, "alias");
  const other = path.join(f.root, "other-project");
  fs.mkdirSync(nested);
  fs.symlinkSync(nested, alias);
  command("git", ["init", "--quiet", other], { env: f.env });
  for (const cwd of [f.workspace, nested, alias, other]) {
    f.invoke({ ...f.input, cwd }, ".claude", { GIT_DIR: path.join(other, ".git") });
  }
  const records = f.logs().map(({ entry }) => entry);
  assert.equal(records.length, 4);
  const own = records.filter(entry => entry.projectRoot === fs.realpathSync(f.workspace));
  assert.equal(own.length, 3);
  assert.equal(new Set(own.map(entry => entry.projectId)).size, 1);
  assert.equal(new Set(records.map(entry => entry.projectId)).size, 2);
});

test("Claude project override is separate from Copilot and invalid identities warn", t => {
  const f = fixture(t);
  f.invoke(f.input, ".claude", { CLAUDE_AUDIT_PROJECT_ID: "claude-test", COPILOT_AUDIT_PROJECT_ID: "copilot-test" });
  const invalid = f.invoke(f.input, ".claude", { CLAUDE_AUDIT_PROJECT_ID: "../escape" });
  assert.match(invalid.stderr, /invalid CLAUDE_AUDIT_PROJECT_ID/);
  const fallback = f.invoke({ ...f.input, cwd: f.root });
  assert.match(fallback.stderr, /project detection failed/);
  const records = f.logs().map(({ entry }) => entry);
  assert.equal(records.length, 3);
  assert.ok(records.some(entry => entry.projectId === "claude-test"));
  assert.ok(records.some(entry => entry.projectId.startsWith("project-with-spaces-")));
  assert.ok(records.some(entry => entry.projectId.startsWith("unresolved-") && entry.projectResolution === "fallback"));
});

test("launcher reports missing Node and its own logger without failing tools", t => {
  const f = fixture(t);
  const launcher = path.join(f.workspace, ".claude/hooks/run-audit.sh");
  const emptyPath = path.join(f.root, "empty-path");
  fs.mkdirSync(emptyPath);
  const bash = command("bash", ["-c", "command -v bash"]).stdout.trim();
  const missingNode = command(bash, [launcher], {
    env: { ...f.env, PATH: emptyPath },
    input: JSON.stringify(f.input),
  });
  assert.equal(missingNode.stdout, "{}\n");
  assert.match(missingNode.stderr, /Claude Code audit logger failed/);
  fs.unlinkSync(path.join(f.workspace, ".claude/hooks/log_activity.cjs"));
  const missingLogger = f.invoke();
  assert.equal(missingLogger.stdout, "{}\n");
  assert.match(missingLogger.stderr, /Claude Code audit logger failed/);
});

test("unwritable log destinations warn without altering tool results", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.workspace, ".claude/logs"), "not a directory");
  const result = f.invoke();
  assert.equal(result.stdout, "{}\n");
  assert.match(result.stderr, /Failed to write activity log/);
  assert.match(result.stderr, /Failed to write markdown log/);
});

test("Copilot-only installation retains completion inference, payload and launcher behavior", t => {
  const f = fixture(t, [".copilot"]);
  assert.equal(fs.existsSync(path.join(f.workspace, ".claude")), false);
  const input = {
    cwd: f.workspace,
    sessionId: "copilot-session",
    toolName: "bash",
    toolArgs: JSON.stringify({ command: "printf copilot" }),
  };
  f.invoke(input, ".copilot");
  assert.deepEqual(f.logs(".copilot"), []);
  f.invoke({
    ...input,
    toolResult: { resultType: "success", textResultForLlm: "copilot output" },
  }, ".copilot");
  f.invoke({ ...input, error: "copilot failure" }, ".copilot");
  const records = f.logs(".copilot");
  assert.equal(records.length, 2);
  assert.equal(records[0].entry.hookEvent, "postToolUse");
  assert.equal(records[0].entry.toolResultPreview, "copilot output");
  assert.equal(records[0].entry.bashCommand, "printf copilot");
  assert.equal(records[1].entry.hookEvent, "postToolUseFailure");
  assert.equal(records[1].entry.error, "copilot failure");
  assert.match(fs.readFileSync(path.join(records[0].directory, "postToolUse.md"), "utf8"),
    /copilot output[\s\S]*\*\*Tool failed\*\*[\s\S]*copilot failure/);
  assert.deepEqual(f.logs(), []);
  assert.equal(fs.existsSync(path.join(f.workspace, ".claude")), false);
});

test("coexisting hooks isolate records, Markdown and project overrides in both directions", t => {
  const f = fixture(t, [".claude", ".copilot"]);
  function snapshot(agent) {
    return f.logs(agent).map(({ entry, directory }) => ({
      entry,
      markdown: fs.readFileSync(path.join(directory, "postToolUse.md"), "utf8"),
    }));
  }
  for (const overrides of [
    {},
    { CLAUDE_AUDIT_PROJECT_ID: "claude-only", COPILOT_AUDIT_PROJECT_ID: "copilot-only" },
    { CLAUDE_AUDIT_PROJECT_ID: "shared-id", COPILOT_AUDIT_PROJECT_ID: "shared-id" },
  ]) {
    const copilotBefore = snapshot(".copilot");
    const claudeResult = f.invoke(f.input, ".claude", overrides);
    assert.equal(claudeResult.stderr, "");
    assert.deepEqual(snapshot(".copilot"), copilotBefore);
    const claudeBefore = snapshot(".claude");
    const copilotResult = f.invoke({
      cwd: f.workspace,
      toolName: "bash",
      toolArgs: { command: "printf copilot" },
      toolResult: { resultType: "success", textResultForLlm: "copilot only" },
    }, ".copilot", overrides);
    assert.equal(copilotResult.stderr, "");
    assert.deepEqual(snapshot(".claude"), claudeBefore);
  }
  const claude = f.logs();
  const copilot = f.logs(".copilot");
  assert.equal(claude.length, 3);
  assert.equal(copilot.length, 3);
  assert.ok(claude.every(({ entry }) => entry.toolName === "Bash" && entry.toolResultPreview === "hello\ndiagnostic"));
  assert.ok(copilot.every(({ entry }) => entry.toolName === "bash" && entry.toolResultPreview === "copilot only"));
  assert.ok(claude.some(({ entry }) => entry.projectId === "claude-only"));
  assert.ok(copilot.some(({ entry }) => entry.projectId === "copilot-only"));
  const claudeShared = claude.find(({ entry }) => entry.projectId === "shared-id");
  const copilotShared = copilot.find(({ entry }) => entry.projectId === "shared-id");
  assert.notEqual(claudeShared.directory, copilotShared.directory);
});

test("a broken log destination cannot interfere with the other hook set", t => {
  for (const broken of [".claude", ".copilot"]) {
    const f = fixture(t, [".claude", ".copilot"]);
    const brokenPath = path.join(f.workspace, broken, "logs");
    fs.writeFileSync(brokenPath, "not a directory");
    for (const agent of [".claude", ".copilot"]) {
      const input = agent === ".claude" ? f.input : {
        cwd: f.workspace,
        toolName: "bash",
        toolArgs: { command: "printf copilot" },
        toolResult: { textResultForLlm: "copilot" },
      };
      const result = f.invoke(input, agent);
      assert.equal(result.stdout, "{}\n");
      if (agent === broken) {
        assert.match(result.stderr, /Failed to write activity log/);
        assert.equal(fs.readFileSync(brokenPath, "utf8"), "not a directory");
      } else {
        assert.equal(result.stderr, "");
        assert.equal(f.logs(agent).length, 1);
      }
    }
  }
});

test("configured Claude commands run from an unrelated cwd and match every tool", t => {
  const f = fixture(t);
  const settings = JSON.parse(fs.readFileSync(path.join(f.workspace, ".claude/settings.json"), "utf8"));
  assert.deepEqual(Object.keys(settings.hooks), ["PostToolUse", "PostToolUseFailure"]);
  for (const [event, groups] of Object.entries(settings.hooks)) {
    assert.equal(groups.length, 1);
    assert.equal(groups[0].matcher, "*");
    assert.equal(groups[0].hooks.length, 1);
    const hook = groups[0].hooks[0];
    const result = command("bash", ["-c", hook.command], {
      cwd: f.root,
      env: { ...f.env, CLAUDE_PROJECT_DIR: f.workspace },
      input: JSON.stringify({
        ...f.input,
        hook_event_name: event,
        ...(event === "PostToolUseFailure" ? { error: "configured failure" } : {}),
      }),
    });
    assert.equal(result.stdout, "{}\n");
    assert.equal(result.stderr, "");
  }
  assert.equal(f.logs().length, 2);
});

test("live Claude CLI without Copilot files logs Bash success/failure, Read, Write and Edit", {
  skip: process.env.CLAUDE_AUDIT_LIVE_TEST !== "1",
  timeout: 150_000,
}, t => {
  const f = fixture(t);
  assert.equal(fs.existsSync(path.join(f.workspace, ".copilot")), false);
  assert.equal(fs.existsSync(path.join(f.workspace, ".github")), false);
  const sample = path.join(f.workspace, "sample.txt");
  const output = path.join(f.workspace, "output.txt");
  fs.writeFileSync(sample, "CLAUDE_AUDIT_SAMPLE\n");
  const successCommand = "printf 'CLAUDE_AUDIT_OK\\n'; printf 'CLAUDE_AUDIT_STDERR\\n' >&2";
  const failureCommand = "printf 'CLAUDE_AUDIT_FAIL\\n' >&2; exit 7";
  const prompt = [
    "Perform exactly these five tool calls once each, in order, for a local hook smoke test.",
    `1. Bash: ${successCommand}`,
    `2. Bash: ${failureCommand}`,
    "The exit 7 is intentional. Do not retry, repair or change either command.",
    `3. Read: ${sample}`,
    `4. Write: ${output} with the exact content "before\\n".`,
    `5. Edit: ${output}, replacing "before" with "after".`,
    "Do not access other files or use any other commands. Finish with AUDIT_SMOKE_COMPLETE.",
  ].join("\n");
  const result = command("claude", [
    "-p", prompt,
    "--system-prompt", "You run only the explicit local tool calls requested for a hook smoke test.",
    "--tools", "Bash,Read,Write,Edit",
    "--allowedTools", "Bash(printf *)", "Bash(exit 7)", "Read", "Write", "Edit",
    "--permission-mode", "dontAsk",
    "--setting-sources", "project",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format", "json",
    "--max-budget-usd", "1",
  ], {
    cwd: f.workspace,
    env: { ...f.env, COPILOT_CLI: "1" },
    timeout: 120_000,
  });
  const response = JSON.parse(result.stdout);
  assert.equal(response.is_error, false, result.stdout);
  assert.match(response.result, /AUDIT_SMOKE_COMPLETE/);
  assert.equal(fs.readFileSync(output, "utf8"), "after\n");
  const records = f.logs();
  assert.equal(records.length, 5);
  const entries = records.map(({ entry }) => entry);
  assert.deepEqual(entries.map(entry => entry.toolName).sort(), ["Bash", "Bash", "Edit", "Read", "Write"]);
  assert.ok(entries.every(entry => entry.sessionId === response.session_id));
  assert.equal(new Set(entries.map(entry => entry.toolUseId)).size, 5);
  const success = entries.find(entry => entry.bashCommand === successCommand);
  assert.equal(success.hookEvent, "PostToolUse");
  assert.match(success.toolResultPreview, /CLAUDE_AUDIT_OK/);
  assert.match(success.toolResultPreview, /CLAUDE_AUDIT_STDERR/);
  const failure = entries.find(entry => entry.bashCommand === failureCommand);
  assert.equal(failure.hookEvent, "PostToolUseFailure");
  assert.match(failure.error, /CLAUDE_AUDIT_FAIL/);
  const markdown = fs.readFileSync(path.join(records[0].directory, "postToolUse.md"), "utf8");
  assert.match(markdown, /CLAUDE_AUDIT_OK/);
  assert.match(markdown, /\*\*Tool failed\*\*/);
  assert.deepEqual(f.logs(".copilot"), []);
  assert.equal(fs.existsSync(path.join(f.workspace, ".copilot")), false);
});
