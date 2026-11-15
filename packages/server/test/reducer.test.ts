import { describe, expect, it } from 'vitest';
import type { AgentView, RoomId } from '@agent-office/shared';
import {
  DONE_CLI_SESSION_TTL_MS,
  DONE_SUBAGENT_TTL_MS,
  HISTORY_LIMIT,
  HOOK_AUTHORITY_MS,
  SUBAGENT_SILENCE_MS,
  agentPost,
  applyHook,
  applyInventory,
  createState,
  environmentsView,
  hookEventSchema,
  prune,
  rosterView,
  sessionsView,
  summarize,
  toolDetail,
  toolRoom,
  truncate,
  workRoom,
  type OfficeState,
} from '../src/reducer.ts';
import { CLI_A, CLI_B, ENVS, LOCAL_A, LOCAL_B, desk, hook, inventory, proc } from './fixtures/builders.ts';

const NO_ENV = 'hors-environnement';
const CLI_KEY = `cli:${CLI_A}`;

/** A state that knows the environments but holds no session yet. */
function stateWithEnvs(): OfficeState {
  const state = createState();
  applyInventory(state, inventory(), 0);
  return state;
}

/** Applies hooks in order, each at its own timestamp, and returns the resulting cli session. */
function run(state: OfficeState, steps: [number, ReturnType<typeof hook>][]) {
  for (const [at, ev] of steps) applyHook(state, ev, at);
  return state.sessions.get(CLI_KEY)!;
}

/** Spawns subagent `ag-1` of type Explore described as 'Scan repo' in the cli session. */
function withSubagent(state: OfficeState, at = 1000) {
  return run(state, [
    [at, hook('UserPromptSubmit', { prompt: 'Fix the bug' })],
    [at + 10, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Scan repo' } })],
    [at + 20, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' })],
  ]);
}

describe('helpers', () => {
  /**
   * Verifies that read, edit and shell tools map to their rooms and others to none
   */
  it('toolRoom maps tools to rooms', () => {
    expect(toolRoom('Read')).toBe('biblio');
    expect(toolRoom('Grep')).toBe('biblio');
    expect(toolRoom('Edit')).toBe('atelier');
    expect(toolRoom('Write')).toBe('atelier');
    expect(toolRoom('Bash')).toBe('machines');
    expect(toolRoom('PowerShell')).toBe('machines');
    expect(toolRoom('Frobnicate')).toBeUndefined();
    expect(toolRoom(undefined)).toBeUndefined();
  });

  /**
   * Verifies that truncate collapses whitespace and cuts at max with an ellipsis
   */
  it('truncate collapses whitespace and respects the max length', () => {
    expect(truncate(undefined)).toBeUndefined();
    expect(truncate('  a \n\t b  ')).toBe('a b');
    expect(truncate('x'.repeat(200))).toBe('x'.repeat(200));
    const cut = truncate('x'.repeat(201))!;
    expect(cut).toHaveLength(200);
    expect(cut.endsWith('…')).toBe(true);
    expect(truncate('abcdef', 4)).toBe('abc…');
  });

  /**
   * Verifies that toolDetail picks the first meaningful key in priority order
   */
  it('toolDetail picks file_path before command and skips empty values', () => {
    expect(toolDetail({ file_path: 'C:/work/alpha/a.ts', command: 'ls' })).toBe('C:/work/alpha/a.ts');
    expect(toolDetail({ command: 'npm test' })).toBe('npm test');
    expect(toolDetail({ file_path: '', pattern: 'TODO' })).toBe('TODO');
    expect(toolDetail({ file_path: 42, other: 'x' })).toBeUndefined();
  });

  /**
   * Verifies that toolDetail returns undefined for non-object input
   */
  it.each([[undefined], [null], ['text'], [7]])('toolDetail(%j) is undefined', (input) => {
    expect(toolDetail(input)).toBeUndefined();
  });

  /**
   * Verifies that a long tool argument is truncated to 200 characters
   */
  it('toolDetail truncates to 200 characters', () => {
    const d = toolDetail({ file_path: 'C:/' + 'a'.repeat(500) })!;
    expect(d).toHaveLength(200);
    expect(d.endsWith('…')).toBe(true);
  });
});

describe('hookEventSchema', () => {
  /**
   * Verifies that a minimal hook payload is accepted and unknown fields are kept
   */
  it('accepts a minimal event and passes unknown fields through', () => {
    const r = hookEventSchema.safeParse({ hook_event_name: 'Stop', session_id: 's1', permission_mode: 'default' });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).permission_mode).toBe('default');
  });

  /**
   * Verifies that payloads missing or with invalid required fields are rejected
   */
  it.each([
    [{ hook_event_name: 'Stop' }],
    [{ hook_event_name: 'Stop', session_id: '' }],
    [{ session_id: 's1' }],
    [{ hook_event_name: 3, session_id: 's1' }],
    [{ hook_event_name: 'Stop', session_id: 's1', prompt: 5 }],
    [[]],
    [null],
  ])('rejects %j', (raw) => {
    expect(hookEventSchema.safeParse(raw).success).toBe(false);
  });
});

describe('applyInventory', () => {
  /**
   * Verifies that startedFromEnvironmentId wins over a folder match
   */
  it('attaches a desktop session to its declared environment', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk({ envId: 'env-beta' })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.envId).toBe('env-beta');
  });

  /**
   * Verifies that a declared but unknown environment falls back to folder matching
   */
  it('falls back to folder match when the declared env is unknown', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk({ envId: 'env-deleted' })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.envId).toBe('env-alpha');
  });

  /**
   * Verifies that the longest matching folder wins, case-insensitively on Windows paths
   */
  it('matches the most specific environment by folder', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk({ matchFolders: ['c:/WORK/alpha/API/src'] })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.envId).toBe('env-alpha-api');
  });

  /**
   * Verifies that a session outside every environment has no env
   */
  it('leaves envId null without match', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk({ matchFolders: ['D:\\elsewhere'] })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.envId).toBeNull();
  });

  /**
   * Verifies that desktop fields (title, archived, parent, dates) are copied to the session
   */
  it('copies desktop metadata', () => {
    const state = createState();
    const parent = { sessionId: 'local_parent', title: 'Parent' };
    applyInventory(
      state,
      inventory({ desktopSessions: [desk({ title: 'T', archived: true, parent, createdAt: 50, lastActivityAt: 5000 })] }),
      1,
    );
    expect(state.sessions.get(LOCAL_A)).toMatchObject({
      origin: 'desktop',
      title: 'T',
      archived: true,
      parent,
      createdAt: 50,
      lastActivityAt: 5000,
      live: false,
      cliSessionIds: [CLI_A],
    });
    expect(state.sessions.get(LOCAL_A)?.main.state).toBe('done');
  });

  /**
   * Verifies that a busy live process makes the main agent working
   */
  it('marks main working for a busy process', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'busy' })] }), 1000);
    const s = state.sessions.get(LOCAL_A)!;
    expect(s.live).toBe(true);
    expect(s.main).toMatchObject({ state: 'working', since: 1000 });
    expect(s.main.waitReason).toBeUndefined();
  });

  /**
   * Verifies that an idle live process makes the main agent wait for a prompt
   */
  it('marks main waiting for a prompt for an idle process', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'idle' })] }), 1000);
    expect(state.sessions.get(LOCAL_A)?.main).toMatchObject({ state: 'waiting', waitReason: 'prompt', room: 'taverne' });
  });

  /**
   * Verifies that a process without hostSessionId links to the desktop session by cli id
   */
  it('links a live process by cli session id', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ hostSessionId: undefined })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.live).toBe(true);
    expect([...state.sessions.keys()]).toEqual([LOCAL_A]);
  });

  /**
   * Verifies that a new cli id reported by the host process routes later hooks to the session
   */
  it('learns the cli id of a host process', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk({ cliSessionIds: [] })], live: [proc({ cliSessionId: CLI_B })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.cliSessionIds).toEqual([CLI_B]);
    const s = applyHook(state, hook('Stop', { session_id: CLI_B }), 2);
    expect(s.id).toBe(LOCAL_A);
    expect(state.sessions.size).toBe(1);
  });

  /**
   * Verifies that a vanished process ends the session when no hook is recent
   */
  it('marks the session done when its process disappears', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc()] }), 1000);
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 100_000);
    const s = state.sessions.get(LOCAL_A)!;
    expect(s.live).toBe(false);
    expect(s.main).toMatchObject({ state: 'done', since: 100_000 });
  });

  /**
   * Verifies that a recent hook keeps the session live until HOOK_AUTHORITY_MS has passed
   */
  it('keeps the session live while a hook is fresh', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc()] }), 1000);
    applyHook(state, hook('PreToolUse', { tool_name: 'Read' }), 50_000);
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 50_000 + HOOK_AUTHORITY_MS);
    expect(state.sessions.get(LOCAL_A)).toMatchObject({ live: true, main: { state: 'working', tool: 'Read' } });
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 50_000 + HOOK_AUTHORITY_MS + 1);
    expect(state.sessions.get(LOCAL_A)).toMatchObject({ live: false, main: { state: 'done' } });
  });

  /**
   * Verifies that the busy/idle status is ignored while a hook is fresh, then applied
   */
  it('lets hooks override the live status during HOOK_AUTHORITY_MS', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'busy' })] }), 0);
    applyHook(state, hook('PreToolUse', { tool_name: 'Edit' }), 10_000);
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'idle' })] }), 20_000);
    expect(state.sessions.get(LOCAL_A)?.main.state).toBe('working');
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'idle' })] }), 10_000 + HOOK_AUTHORITY_MS + 1);
    expect(state.sessions.get(LOCAL_A)?.main).toMatchObject({ state: 'waiting', waitReason: 'prompt', room: 'taverne' });
  });

  /**
   * Verifies that an idle status does not erase a pending permission request
   */
  it('keeps a permission wait when the process reports idle', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc()] }), 0);
    applyHook(state, hook('PermissionRequest', { tool_name: 'Bash' }), 10_000);
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'idle' })] }), 100_000);
    expect(state.sessions.get(LOCAL_A)?.main).toMatchObject({ state: 'waiting', waitReason: 'permission' });
  });

  /**
   * Verifies that a terminal process without desktop record becomes a cli: session
   */
  it('creates a cli session for a process without desktop record', () => {
    const state = createState();
    applyInventory(
      state,
      inventory({ live: [proc({ cliSessionId: CLI_B, hostSessionId: undefined, cwd: 'C:/work/beta/src', status: 'idle' })] }),
      1000,
    );
    const s = state.sessions.get(`cli:${CLI_B}`)!;
    expect(s).toMatchObject({ origin: 'cli', title: 'src', envId: 'env-beta', live: true, cliSessionIds: [CLI_B] });
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'prompt' });
    expect(applyHook(state, hook('Stop', { session_id: CLI_B }), 1001).id).toBe(`cli:${CLI_B}`);
    expect(state.sessions.size).toBe(1);
  });

  /**
   * Verifies that a named terminal process uses its name as title
   */
  it('uses the process name as cli session title', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, name: 'nightly-job' })] }), 1);
    expect(state.sessions.get(CLI_KEY)?.title).toBe('nightly-job');
  });

  /**
   * Verifies that an unnamed terminal process with empty cwd gets a null title
   */
  it('gives a null title to an unnamed cli process without cwd', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, cwd: '', name: undefined })] }), 1);
    const s = state.sessions.get(CLI_KEY);
    expect(s).toBeDefined();
    expect(s?.title).toBeNull();
  });

  /**
   * Verifies that an empty process name falls back to the cwd folder name
   */
  it('falls back to the folder name when the process name is empty', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, cwd: 'C:/work/beta', name: '' })] }), 1);
    expect(state.sessions.get(CLI_KEY)?.title).toBe('beta');
  });

  /**
   * Verifies that an untitled desktop record yields a session with a null title
   */
  it('keeps a null desktop title as null', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk({ title: null })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.title).toBeNull();
  });

  /**
   * Verifies that a cli session whose process vanished is kept but marked done
   */
  it('marks a cli session done when its process disappears', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined })] }), 1000);
    applyInventory(state, inventory(), 1000 + HOOK_AUTHORITY_MS + 1);
    expect(state.sessions.get(CLI_KEY)).toMatchObject({ live: false, main: { state: 'done' } });
  });

  /**
   * Verifies that a cli session with a fresh hook survives a missing process
   */
  it('keeps a cli session live when a hook is fresh', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined })] }), 1000);
    applyHook(state, hook('PreToolUse', { tool_name: 'Bash' }), 5000);
    applyInventory(state, inventory(), 6000);
    expect(state.sessions.get(CLI_KEY)?.live).toBe(true);
  });

  /**
   * Verifies that a desktop session whose record vanished is removed
   */
  it('removes a deleted desktop session', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk(), desk({ localId: LOCAL_B, cliSessionIds: [] })] }), 1);
    applyInventory(state, inventory({ desktopSessions: [desk({ localId: LOCAL_B, cliSessionIds: [] })] }), 2);
    expect([...state.sessions.keys()]).toEqual([LOCAL_B]);
  });

  /**
   * Verifies that environments are replaced by each inventory read
   */
  it('replaces the environment list', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ environments: [ENVS[2]] }), 1);
    expect(state.environments.map((e) => e.id)).toEqual(['env-beta']);
  });

  /**
   * Verifies that a cli session created by early hooks merges into the desktop session
   */
  it('absorbs an early cli session into the desktop session', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    applyHook(state, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', description: 'Draft plan' } }), 1300);
    expect(state.sessions.has(CLI_KEY)).toBe(true);

    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'idle' })] }), 2000);

    expect(state.sessions.has(CLI_KEY)).toBe(false);
    expect([...state.sessions.keys()]).toEqual([LOCAL_A]);
    const s = state.sessions.get(LOCAL_A)!;
    expect(s.live).toBe(true);
    // The hook is fresh: the idle status must not override the working agent.
    // The main agent keeps its id through the merge, so its figure, colour and selection survive.
    expect(s.main).toMatchObject({ id: `${CLI_KEY}#main`, sessionId: LOCAL_A, state: 'working', description: 'Fix the bug' });
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0]).toMatchObject({ id: 'ag-1', sessionId: LOCAL_A, agentType: 'Explore', description: 'Scan repo' });

    // Pending spawns follow the session, and later hooks land on the desktop session.
    const after = applyHook(state, hook('SubagentStart', { agent_id: 'ag-2', agent_type: 'Plan' }), 2100);
    expect(after.id).toBe(LOCAL_A);
    expect(after.subagents[1]).toMatchObject({ id: 'ag-2', description: 'Draft plan' });
    expect(state.sessions.size).toBe(1);
  });

  /**
   * Verifies that the absorbed session inherits hook freshness and stays live
   */
  it('keeps hook authority after absorbing', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('UserPromptSubmit', { prompt: 'go' }), 1000);
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 2000);
    expect(state.sessions.get(LOCAL_A)?.live).toBe(true);
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 1000 + HOOK_AUTHORITY_MS + 1);
    expect(state.sessions.get(LOCAL_A)?.live).toBe(false);
  });
});

describe('applyHook: main agent', () => {
  /**
   * Verifies that a hook from an unknown session creates a live cli session in its env
   */
  it('creates a cli session from the first hook', () => {
    const state = stateWithEnvs();
    const s = applyHook(state, hook('SessionStart', { cwd: 'C:/work/alpha/src' }), 500);
    expect(s).toMatchObject({
      id: CLI_KEY,
      origin: 'cli',
      title: 'src',
      envId: 'env-alpha',
      live: true,
      createdAt: 500,
      lastActivityAt: 500,
      cliSessionIds: [CLI_A],
    });
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'prompt' });
  });

  /**
   * Verifies that a hook without cwd creates an env-less terminal session
   */
  it('creates an env-less session without cwd', () => {
    const state = stateWithEnvs();
    const s = applyHook(state, { hook_event_name: 'Stop', session_id: CLI_A }, 1);
    expect(s).toMatchObject({ envId: null, title: null, cwd: '' });
  });

  /**
   * Verifies that a user prompt sets the main agent working with the prompt as detail
   */
  it('UserPromptSubmit sets main working', () => {
    const s = run(stateWithEnvs(), [[1000, hook('UserPromptSubmit', { prompt: 'Fix\n the  bug' })]]);
    expect(s.main).toMatchObject({ state: 'working', toolDetail: 'Fix the bug', description: 'Fix the bug', since: 1000 });
    expect(s.main.tool).toBeUndefined();
    expect(s.lastActivityAt).toBe(1000);
  });

  /**
   * Verifies that each tool family moves the main agent to its room with its detail
   */
  it.each([
    ['Read', { file_path: 'C:/work/alpha/a.ts' }, 'biblio', 'C:/work/alpha/a.ts'],
    ['Edit', { file_path: 'C:/work/alpha/b.ts' }, 'atelier', 'C:/work/alpha/b.ts'],
    ['Bash', { command: 'npm test' }, 'machines', 'npm test'],
  ])('PreToolUse %s moves main to its room', (tool, input, room, detail) => {
    const s = run(stateWithEnvs(), [[1, hook('PreToolUse', { tool_name: tool, tool_input: input })]]);
    expect(s.main).toMatchObject({ state: 'working', tool, room, toolDetail: detail });
  });

  /**
   * Verifies that an unknown tool keeps the agent in its current room
   */
  it('unknown tool keeps the current room', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a' } })],
      [2, hook('PreToolUse', { tool_name: 'Frobnicate' })],
    ]);
    expect(s.main).toMatchObject({ tool: 'Frobnicate', room: 'atelier' });
  });

  /**
   * Verifies that PostToolUse keeps the agent working on its tool
   */
  it('PostToolUse keeps main working', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a' } })],
      [2, hook('PostToolUseFailure', { tool_name: 'Read' })],
    ]);
    expect(s.main).toMatchObject({ state: 'working', tool: 'Read', room: 'biblio' });
  });

  /**
   * Verifies that a permission request makes main wait in the lobby with the tool
   */
  it('PermissionRequest sets waiting permission at the altar', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })],
      [2, hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })],
    ]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'permission', room: 'autel', tool: 'Bash', toolDetail: 'rm -rf build' });
  });

  /**
   * Verifies that AskUserQuestion makes main wait on a question showing its text
   */
  it('AskUserQuestion sets waiting question with the question text', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which DB?' }, { question: 'Other' }] } })],
    ]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'question', room: 'autel', tool: 'AskUserQuestion', toolDetail: 'Which DB?' });
  });

  /**
   * Verifies that AskUserQuestion without questions leaves no detail
   */
  it('AskUserQuestion without questions has no detail', () => {
    const s = run(stateWithEnvs(), [[1, hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {} })]]);
    expect(s.main.waitReason).toBe('question');
    expect(s.main.toolDetail).toBeUndefined();
  });

  /**
   * Verifies that Stop makes main wait for a prompt and records the last message
   */
  it('Stop sets waiting prompt with lastMessage and clears the tool', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a' } })],
      [2, hook('Stop', { last_assistant_message: 'All  done.' })],
    ]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'prompt', room: 'taverne', lastMessage: 'All done.' });
    expect(s.main.tool).toBeUndefined();
    expect(s.main.toolDetail).toBeUndefined();
  });

  /**
   * Verifies that the last message is truncated to 400 characters
   */
  it('Stop truncates lastMessage to 400 characters', () => {
    const s = run(stateWithEnvs(), [[1, hook('Stop', { last_assistant_message: 'm'.repeat(1000) })]]);
    expect(s.main.lastMessage).toHaveLength(400);
  });

  /**
   * Verifies that a new prompt after Stop clears the wait reason
   */
  it('UserPromptSubmit after Stop clears waitReason', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('Stop')],
      [2, hook('UserPromptSubmit', { prompt: 'next' })],
    ]);
    expect(s.main.state).toBe('working');
    expect(s.main.waitReason).toBeUndefined();
  });

  /**
   * Verifies that StopFailure makes main wait on an error with its message
   */
  it('StopFailure sets waiting error', () => {
    const s = run(stateWithEnvs(), [[1, hook('StopFailure', { error: 'rate_limit' })]]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'error', toolDetail: 'rate_limit' });
  });

  /**
   * Verifies that a non-string error leaves no detail, so the client shows a translated message
   */
  it('StopFailure with structured error leaves the detail to the client', () => {
    const s = run(stateWithEnvs(), [[1, hook('StopFailure', { error: { code: 500 } })]]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'error' });
    expect(s.main.toolDetail).toBeUndefined();
  });

  /**
   * Verifies that StopFailure clears the last tool, so the panel shows the error and not that tool
   */
  it('StopFailure after a tool call clears the tool', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } })],
      [2, hook('StopFailure', { error: { code: 500 } })],
    ]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'error' });
    expect(s.main.tool).toBeUndefined();
    expect(s.main.toolDetail).toBeUndefined();
  });

  /**
   * Verifies that a permission notification sets a permission wait with its message
   */
  it('Notification permission_prompt sets waiting permission', () => {
    const s = run(stateWithEnvs(), [[1, hook('Notification', { notification_type: 'permission_prompt', message: 'Allow Bash?' })]]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'permission', toolDetail: 'Allow Bash?' });
  });

  /**
   * Verifies that an idle notification does not interrupt a working agent
   */
  it('Notification idle_prompt is ignored while working', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('UserPromptSubmit', { prompt: 'go' })],
      [2, hook('Notification', { notification_type: 'idle_prompt' })],
    ]);
    expect(s.main.state).toBe('working');
  });

  /**
   * Verifies that SessionStart does not interrupt a working agent
   */
  it('SessionStart keeps a working main agent', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('UserPromptSubmit', { prompt: 'go' })],
      [2, hook('SessionStart')],
    ]);
    expect(s.main.state).toBe('working');
  });

  /**
   * Verifies that SessionEnd ends the session and every agent in it
   */
  it('SessionEnd marks the session not live and all agents done', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    const s = run(state, [
      [1100, hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a' } })],
      [1200, hook('SessionEnd')],
    ]);
    expect(s.live).toBe(false);
    expect(s.main).toMatchObject({ state: 'done', room: 'taverne', since: 1200 });
    expect(s.main.tool).toBeUndefined();
    expect(s.subagents.map((a) => a.state)).toEqual(['done']);
  });

  /**
   * Verifies that a SessionEnd for a never-seen session does not mark it live
   */
  it('SessionEnd on a new session leaves it not live', () => {
    const s = run(stateWithEnvs(), [[1, hook('SessionEnd')]]);
    expect(s.live).toBe(false);
  });

  /**
   * Verifies that an unknown event only refreshes activity and liveness
   */
  it('unknown events change no agent state', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('Stop')],
      [5, hook('SomethingNew')],
    ]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: 'prompt', since: 1 });
    expect(s.lastActivityAt).toBe(5);
  });
});

describe('applyHook: since', () => {
  /**
   * Verifies that since is kept when state, tool and wait reason are unchanged
   */
  it('does not reset on an identical activity', () => {
    const s = run(stateWithEnvs(), [
      [100, hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a' } })],
      [200, hook('PostToolUse', { tool_name: 'Read' })],
      [300, hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'b' } })],
    ]);
    expect(s.main).toMatchObject({ since: 100, toolDetail: 'b' });
  });

  /**
   * Verifies that since resets when the tool changes
   */
  it('resets when the tool changes', () => {
    const s = run(stateWithEnvs(), [
      [100, hook('PreToolUse', { tool_name: 'Read' })],
      [300, hook('PreToolUse', { tool_name: 'Grep' })],
    ]);
    expect(s.main.since).toBe(300);
  });

  /**
   * Verifies that since resets when the state or the wait reason changes
   */
  it('resets on state and wait reason changes', () => {
    const state = stateWithEnvs();
    let s = run(state, [
      [100, hook('PreToolUse', { tool_name: 'Bash' })],
      [200, hook('PermissionRequest', { tool_name: 'Bash' })],
    ]);
    expect(s.main.since).toBe(200);
    s = run(state, [[300, hook('Stop')]]);
    expect(s.main.since).toBe(300);
    s = run(state, [[400, hook('Notification', { notification_type: 'idle_prompt' })]]);
    expect(s.main.since).toBe(300);
  });
});

describe('applyHook: subagents', () => {
  /**
   * Verifies that an Agent call then SubagentStart creates a described subagent
   */
  it('creates a subagent with the description of the matching Agent call', () => {
    const s = withSubagent(stateWithEnvs(), 1000);
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0]).toMatchObject({
      id: 'ag-1',
      sessionId: CLI_KEY,
      kind: 'sub',
      agentType: 'Explore',
      description: 'Scan repo',
      state: 'working',
      room: 'biblio',
      since: 1020,
    });
  });

  /**
   * Verifies that SubagentStart picks the pending spawn of the same agent type
   */
  it('matches pending spawns by agent type', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan', description: 'P' } })],
      [2, hook('PreToolUse', { tool_name: 'Task', tool_input: { subagent_type: 'Explore', description: 'E' } })],
      [3, hook('SubagentStart', { agent_id: 'ag-e', agent_type: 'Explore' })],
      [4, hook('SubagentStart', { agent_id: 'ag-p', agent_type: 'Plan' })],
    ]);
    expect(s.subagents.map((a) => [a.id, a.description])).toEqual([
      ['ag-e', 'E'],
      ['ag-p', 'P'],
    ]);
  });

  /**
   * Verifies that an Agent call without subagent_type is matched as general-purpose
   */
  it('defaults the pending spawn type to general-purpose', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Agent', tool_input: { description: 'G' } })],
      [2, hook('SubagentStart', { agent_id: 'ag-g', agent_type: 'general-purpose' })],
    ]);
    expect(s.subagents[0]?.description).toBe('G');
  });

  /**
   * Verifies that a SubagentStart without a pending spawn has no description
   */
  it('creates a subagent without description when no spawn matches', () => {
    const s = run(stateWithEnvs(), [[1, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' })]]);
    expect(s.subagents[0]?.agentType).toBe('Explore');
    expect(s.subagents[0]?.description).toBeUndefined();
  });

  /**
   * Verifies that a spawn is consumed once and a repeated SubagentStart adds nothing
   */
  it('ignores a duplicate SubagentStart', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    const s = run(state, [[2000, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' })]]);
    expect(s.subagents).toHaveLength(1);
  });

  /**
   * Verifies that internal agents with an empty or missing type are not shown
   */
  it.each([[{ agent_id: 'ag-int', agent_type: '' }], [{ agent_id: 'ag-int' }], [{ agent_type: 'Explore' }]])(
    'ignores SubagentStart %j',
    (extra) => {
      const s = run(stateWithEnvs(), [[1, hook('SubagentStart', extra)]]);
      expect(s.subagents).toEqual([]);
    },
  );

  /**
   * Verifies that tool events carrying agent_id update the subagent, not main
   */
  it('routes tool events with agent_id to the subagent', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    const s = run(state, [[1100, hook('PreToolUse', { agent_id: 'ag-1', tool_name: 'Grep', tool_input: { pattern: 'TODO' } })]]);
    expect(s.subagents[0]).toMatchObject({ tool: 'Grep', room: 'biblio', toolDetail: 'TODO', since: 1100 });
    expect(s.main).toMatchObject({ tool: 'Agent', since: 1010 });

    run(state, [[1200, hook('PermissionRequest', { agent_id: 'ag-1', tool_name: 'Bash' })]]);
    expect(s.subagents[0]).toMatchObject({ state: 'waiting', waitReason: 'permission' });
    expect(s.main.state).toBe('working');
  });

  /**
   * Verifies that a subagent's question makes only that subagent wait
   */
  it('AskUserQuestion from a subagent only affects the subagent', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    const s = run(state, [
      [1100, hook('PreToolUse', { agent_id: 'ag-1', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q?' }] } })],
    ]);
    expect(s.subagents[0]).toMatchObject({ state: 'waiting', waitReason: 'question', toolDetail: 'Q?' });
    expect(s.main.state).toBe('working');
  });

  /**
   * Verifies that an Agent call made by a subagent is not queued as a main spawn
   */
  it('does not queue spawns from a subagent Agent call', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    const s = run(state, [
      [1100, hook('PreToolUse', { agent_id: 'ag-1', tool_name: 'Agent', tool_input: { subagent_type: 'Plan', description: 'nested' } })],
      [1200, hook('SubagentStart', { agent_id: 'ag-2', agent_type: 'Plan' })],
    ]);
    expect(s.subagents[1]?.description).toBeUndefined();
  });

  /**
   * Verifies that SubagentStop finishes the subagent with its last message
   */
  it('SubagentStop marks the subagent done with lastMessage', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    run(state, [[1100, hook('PreToolUse', { agent_id: 'ag-1', tool_name: 'Read' })]]);
    const s = run(state, [[1200, hook('SubagentStop', { agent_id: 'ag-1', last_assistant_message: 'Found 3 files' })]]);
    expect(s.subagents[0]).toMatchObject({ state: 'done', room: 'taverne', lastMessage: 'Found 3 files', since: 1200 });
    expect(s.subagents[0]?.tool).toBeUndefined();
    expect(s.main.state).toBe('working');
  });

  /**
   * Verifies that a late PostToolUse does not revive a finished subagent
   */
  it('PostToolUse does not revive a done subagent', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    const s = run(state, [
      [1100, hook('SubagentStop', { agent_id: 'ag-1' })],
      [1200, hook('PostToolUse', { agent_id: 'ag-1', tool_name: 'Read' })],
    ]);
    expect(s.subagents[0]?.state).toBe('done');
  });

  /**
   * Verifies that a tool event from an unseen agent_id creates that subagent
   */
  // An agent_id without agent_type is an internal agent (prompt suggestions…): it gets no figure.
  it('creates the subagent from a tool event when SubagentStart was missed', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { agent_id: 'ag-x', agent_type: 'dexter', tool_name: 'Write', tool_input: { file_path: 'C:/work/alpha/t.ts' } })],
      [2, hook('PostToolUse', { agent_id: 'ag-y', tool_name: 'Read' })],
    ]);
    expect(s.subagents.map((a) => [a.id, a.agentType, a.room])).toEqual([
      ['ag-x', 'dexter', 'epreuves'],
    ]);
    expect(s.subagents[0]).toMatchObject({ kind: 'sub', state: 'working', toolDetail: 'C:/work/alpha/t.ts' });
  });

  /**
   * Verifies that non-tool events from an unknown agent_id create no subagent
   */
  it('does not create a subagent from SubagentStop of an unknown agent', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('UserPromptSubmit', { prompt: 'go' })],
      [2, hook('SubagentStop', { agent_id: 'ghost' })],
    ]);
    expect(s.subagents).toEqual([]);
    expect(s.main.state).toBe('working');
  });
});

describe('prune', () => {
  /**
   * Verifies that done subagents disappear exactly after DONE_SUBAGENT_TTL_MS
   */
  it('removes done subagents after their TTL', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    run(state, [[5000, hook('SubagentStop', { agent_id: 'ag-1' })]]);
    prune(state, 5000 + DONE_SUBAGENT_TTL_MS - 1);
    expect(state.sessions.get(CLI_KEY)?.subagents).toHaveLength(1);
    prune(state, 5000 + DONE_SUBAGENT_TTL_MS);
    expect(state.sessions.get(CLI_KEY)?.subagents).toEqual([]);
  });

  /**
   * Verifies that working subagents are never pruned
   */
  it('keeps working subagents', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    prune(state, 1000 + DONE_SUBAGENT_TTL_MS * 10);
    expect(state.sessions.get(CLI_KEY)?.subagents).toHaveLength(1);
  });

  /**
   * Verifies that finished cli sessions are forgotten after DONE_CLI_SESSION_TTL_MS
   */
  it('removes old finished cli sessions', () => {
    const state = stateWithEnvs();
    run(state, [
      [1000, hook('UserPromptSubmit', { prompt: 'go' })],
      [2000, hook('SessionEnd')],
    ]);
    prune(state, 2000 + DONE_CLI_SESSION_TTL_MS);
    expect(state.sessions.has(CLI_KEY)).toBe(true);
    prune(state, 2000 + DONE_CLI_SESSION_TTL_MS + 1);
    expect(state.sessions.has(CLI_KEY)).toBe(false);

    // A later hook with the same id starts a fresh session.
    const later = 2000 + DONE_CLI_SESSION_TTL_MS + 10;
    const s = applyHook(state, hook('Stop'), later);
    expect(s).toMatchObject({ id: CLI_KEY, createdAt: later, subagents: [] });
  });

  /**
   * Verifies that live cli sessions and finished desktop sessions are kept
   */
  it('keeps live cli sessions and desktop sessions', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ desktopSessions: [desk({ localId: LOCAL_B, cliSessionIds: [] })] }), 1);
    run(state, [[1000, hook('UserPromptSubmit', { prompt: 'go' })]]);
    prune(state, 1000 + DONE_CLI_SESSION_TTL_MS * 2);
    expect([...state.sessions.keys()].sort()).toEqual([CLI_KEY, LOCAL_B].sort());
  });
});

describe('environmentsView', () => {
  /**
   * Verifies that each environment counts its live sessions and no virtual env appears
   */
  it('counts active sessions per environment without orphans', () => {
    const state = createState();
    applyInventory(
      state,
      inventory({
        desktopSessions: [desk(), desk({ localId: LOCAL_B, cliSessionIds: [] })],
        live: [proc()],
      }),
      1,
    );
    expect(environmentsView(state)).toEqual([
      { id: 'env-alpha', name: 'Alpha', folders: ['C:\\work\\alpha'], activeSessions: 1 },
      { id: 'env-alpha-api', name: 'Alpha API', folders: ['C:\\Work\\Alpha\\api'], activeSessions: 0 },
      { id: 'env-beta', name: 'Beta', folders: ['C:\\work\\beta'], activeSessions: 0 },
    ]);
  });

  /**
   * Verifies that a session outside every env adds the virtual environment last
   */
  it('adds the virtual environment when a session has no env', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('UserPromptSubmit', { cwd: 'D:/elsewhere', prompt: 'go' }), 1);
    const list = environmentsView(state);
    expect(list).toHaveLength(ENVS.length + 1);
    expect(list.at(-1)).toEqual({ id: NO_ENV, name: 'Hors environnement', folders: [], virtual: true, activeSessions: 1 });
  });

  /**
   * Verifies that a finished orphan session still shows the virtual env with 0 active
   */
  it('shows the virtual environment for finished orphans', () => {
    const state = stateWithEnvs();
    run(state, [
      [1, hook('Stop', { cwd: 'D:/elsewhere' })],
      [2, hook('SessionEnd')],
    ]);
    expect(environmentsView(state).at(-1)).toMatchObject({ id: NO_ENV, activeSessions: 0 });
  });

  /**
   * Verifies that an empty state lists only the known environments
   */
  it('returns [] for an empty state', () => {
    expect(environmentsView(createState())).toEqual([]);
  });
});

describe('sessionsView', () => {
  /**
   * Verifies ordering and filtering: live by creation, then recent non-archived history
   */
  it('returns live sessions first, then at most HISTORY_LIMIT newest finished ones', () => {
    const state = createState();
    const finished = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) =>
      desk({ localId: `local_hist_${i}`, cliSessionIds: [], envId: 'env-alpha', lastActivityAt: 1000 + i }),
    );
    applyInventory(
      state,
      inventory({
        desktopSessions: [
          desk({ localId: 'local_live_late', cliSessionIds: [], envId: 'env-alpha', createdAt: 500 }),
          desk({ localId: 'local_live_early', cliSessionIds: [], envId: 'env-alpha', createdAt: 300 }),
          desk({ localId: 'local_archived', cliSessionIds: [], envId: 'env-alpha', archived: true, lastActivityAt: 999_999 }),
          desk({ localId: 'local_beta', cliSessionIds: [], envId: 'env-beta', lastActivityAt: 999_999 }),
          ...finished,
        ],
        live: [
          proc({ pid: 1, cliSessionId: 'c-late', hostSessionId: 'local_live_late' }),
          proc({ pid: 2, cliSessionId: 'c-early', hostSessionId: 'local_live_early' }),
        ],
      }),
      1,
    );

    const ids = sessionsView(state, 'env-alpha').map((s) => s.id);
    const expectedHistory = Array.from({ length: HISTORY_LIMIT }, (_, k) => `local_hist_${HISTORY_LIMIT + 4 - k}`);
    expect(ids).toEqual(['local_live_early', 'local_live_late', ...expectedHistory]);
    expect(ids).not.toContain('local_archived');
    expect(ids).not.toContain('local_beta');
  });

  /**
   * Verifies that the virtual env id returns sessions without environment
   */
  it('returns orphan sessions for the virtual environment', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('Stop', { cwd: 'D:/elsewhere' }), 1);
    expect(sessionsView(state, NO_ENV).map((s) => s.id)).toEqual([CLI_KEY]);
    expect(sessionsView(state, 'env-alpha')).toEqual([]);
  });

  /**
   * Verifies that an unknown env id yields an empty list
   */
  it('returns [] for an unknown environment', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('Stop'), 1);
    expect(sessionsView(state, 'env-unknown')).toEqual([]);
  });
});

describe('summarize', () => {
  /**
   * Verifies that a tool event summary carries ids, env and the tool detail
   */
  it('summarises a tool event', () => {
    const state = stateWithEnvs();
    const ev = hook('PreToolUse', { agent_id: 'ag-1', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'npm test' } });
    const s = applyHook(state, ev, 42);
    expect(summarize(ev, s, 42)).toEqual({
      seq: 0,
      at: 42,
      event: 'PreToolUse',
      sessionId: CLI_KEY,
      envId: 'env-alpha',
      agentId: 'ag-1',
      agentType: 'Explore',
      tool: 'Bash',
      detail: 'npm test',
    });
  });

  /**
   * Verifies that without tool input the prompt, then the message, is the detail (120 max)
   */
  it('falls back to prompt then message, truncated to 120', () => {
    const state = stateWithEnvs();
    const p = hook('UserPromptSubmit', { prompt: 'p'.repeat(300) });
    const detail = summarize(p, applyHook(state, p, 1), 1).detail!;
    expect(detail).toHaveLength(120);
    const n = hook('Notification', { message: 'Need input' });
    expect(summarize(n, applyHook(state, n, 2), 2).detail).toBe('Need input');
    const e = hook('Stop');
    expect(summarize(e, applyHook(state, e, 3), 3).detail).toBeUndefined();
  });
});

describe('review regressions', () => {
  /** A desktop session whose file is listed but unreadable (mid-write) keeps its live state. */
  it('keeps a desktop session whose file is present but did not parse', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'busy' })] }), 1000);
    applyHook(state, hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'a.ts' } }), 1100);
    applyInventory(state, inventory({ desktopSessions: [], live: [proc({ status: 'busy' })], presentIds: new Set([LOCAL_A]), complete: true }), 1200);
    const s = state.sessions.get(LOCAL_A)!;
    expect(s).toBeDefined();
    expect(s.main).toMatchObject({ state: 'working', tool: 'Edit', room: 'atelier' });
  });

  /** An incomplete listing (folder unreadable, desktop data not found) proves no deletion. */
  it('keeps desktop sessions when the listing is incomplete', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 1000);
    applyInventory(state, inventory({ desktopSessions: [], presentIds: new Set(), complete: false }), 1100);
    expect(state.sessions.has(LOCAL_A)).toBe(true);
    applyInventory(state, inventory({ desktopSessions: [], presentIds: new Set(), complete: true }), 1200);
    expect(state.sessions.has(LOCAL_A)).toBe(false);
  });

  /** An unreadable presets file keeps the environments already known. */
  it('keeps environments when the presets file could not be read', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ environments: [], presetsOk: false }), 1000);
    expect(state.environments).toEqual(ENVS);
  });

  /** The process status never overrides a question or error wait, and an unknown status is ignored. */
  it('protects hook-reported waits from the inventory status', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'busy' })] }), 1000);
    applyHook(state, hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?' }] } }), 1100);
    const later = 1100 + HOOK_AUTHORITY_MS + 1;
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'busy' })] }), later);
    expect(state.sessions.get(LOCAL_A)!.main).toMatchObject({ state: 'waiting', waitReason: 'question' });

    applyHook(state, hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'npm test' } }), later + 1);
    const silent = later + 1 + HOOK_AUTHORITY_MS + 1;
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'unknown' as 'busy' })] }), silent);
    expect(state.sessions.get(LOCAL_A)!.main).toMatchObject({ state: 'working', room: 'machines' });
  });

  /** A permission notification does not paint the main agent when a subagent is the one waiting. */
  it('keeps the main agent working when a subagent asked for permission', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    applyHook(state, hook('PermissionRequest', { agent_id: 'ag-1', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'rm x' } }), 1200);
    const s = applyHook(state, hook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' }), 1300);
    expect(s.subagents[0]).toMatchObject({ state: 'waiting', waitReason: 'permission' });
    expect(s.main.state).not.toBe('waiting');
  });

  /** A subagent whose SubagentStop was missed retires after SUBAGENT_SILENCE_MS. */
  it('retires silent subagents', () => {
    const state = stateWithEnvs();
    const s = withSubagent(state, 1000);
    prune(state, 1000 + SUBAGENT_SILENCE_MS + 1000);
    expect(s.subagents[0]?.state ?? 'done').toBe('done');
  });

  /** Pending spawns are cleared at the end of a turn, so a later subagent never inherits an old description. */
  it('clears pending spawns on Stop', () => {
    const state = stateWithEnvs();
    run(state, [
      [1, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'Old task' } })],
      [2, hook('Stop')],
    ]);
    const s = applyHook(state, hook('SubagentStart', { agent_id: 'ag-new', agent_type: 'Explore' }), 3);
    expect(s.subagents.find((a) => a.id === 'ag-new')!.description).toBeUndefined();
  });

  /** Merging keeps a live session live even when a stale temporary copy was finished. */
  it('never downgrades live when absorbing a stale temporary session', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('UserPromptSubmit', { prompt: 'old', session_id: CLI_B }), 100);
    applyHook(state, hook('SessionEnd', { session_id: CLI_B }), 200);
    applyHook(state, hook('UserPromptSubmit', { prompt: 'current' }), 300);
    applyInventory(
      state,
      inventory({ desktopSessions: [desk({ cliSessionIds: [CLI_A, CLI_B] })], live: [proc({ status: 'busy' })] }),
      400,
    );
    const s = state.sessions.get(LOCAL_A)!;
    expect(s.live).toBe(true);
    expect(s.main).toMatchObject({ state: 'working', description: 'current' });
    expect(state.sessions.size).toBe(1);
  });
});

describe('re-review regressions', () => {
  /** A subagent waiting on the user is never retired for silence. */
  it('keeps a silent subagent that waits for permission', () => {
    const state = stateWithEnvs();
    const s = withSubagent(state, 1000);
    applyHook(state, hook('PermissionRequest', { agent_id: 'ag-1', agent_type: 'Explore', tool_name: 'Bash' }), 1100);
    prune(state, 1100 + SUBAGENT_SILENCE_MS + 1000);
    expect(s.subagents[0]).toMatchObject({ state: 'waiting', waitReason: 'permission' });
  });
});

/** A bare agent for the pure room functions. */
function agent(kind: 'main' | 'sub', agentType: string, room: RoomId = 'atelier'): AgentView {
  return { id: 'ag', sessionId: 's', kind, agentType, state: 'working', room, since: 0 };
}

describe('dungeon rooms: toolRoom', () => {
  /**
   * Verifies that every tool of the table maps to its dungeon room
   */
  it.each([
    ['Read', 'biblio'],
    ['Grep', 'biblio'],
    ['Glob', 'biblio'],
    ['LS', 'biblio'],
    ['WebFetch', 'observatoire'],
    ['WebSearch', 'observatoire'],
    ['Edit', 'atelier'],
    ['MultiEdit', 'atelier'],
    ['Write', 'atelier'],
    ['NotebookEdit', 'atelier'],
    ['Bash', 'machines'],
    ['PowerShell', 'machines'],
    ['BashOutput', 'machines'],
    ['KillShell', 'machines'],
    ['Monitor', 'machines'],
    ['EnterPlanMode', 'cartes'],
    ['ExitPlanMode', 'cartes'],
    ['TodoWrite', 'cartes'],
  ])('%s → %s', (tool, room) => {
    expect(toolRoom(tool)).toBe(room);
  });

  /**
   * Verifies that tools outside the table, wrong case or prototype keys, have no room
   */
  it.each([['read'], ['AskUserQuestion'], ['Agent'], ['']])('%j has no room', (tool) => {
    expect(toolRoom(tool)).toBeUndefined();
  });

  /**
   * Verifies that tool names equal to Object prototype keys get no room
   */
  // SPEC CONFLICT: agentPost guards prototype keys with Object.hasOwn, toolRoom does not:
  // TOOL_ROOMS['constructor'] is Object itself, so a hook with tool_name "constructor" would
  // put a function in AgentView.room. This test fails until toolRoom uses Object.hasOwn too.
  it.each([['constructor'], ['toString'], ['__proto__'], ['hasOwnProperty']])('prototype key %j has no room', (tool) => {
    expect(toolRoom(tool)).toBeUndefined();
    expect(workRoom(agent('main', 'Session principale', 'biblio'), tool)).toBe('biblio');
  });
});

describe('dungeon rooms: agentPost', () => {
  /**
   * Verifies that each specialist agent type has its fixed post
   */
  it.each([
    ['barbapapa', 'atelier'],
    ['butt-stallion', 'detente'],
    ['samuel-morse', 'pigeonnier'],
    ['neo', 'garde'],
    ['oracle', 'observatoire'],
    ['dexter', 'epreuves'],
    ['hermione', 'epreuves'],
    ['gatsby', 'heraut'],
    ['timmy', 'heraut'],
    ['hancock', 'concierge'],
    ['curator', 'scriptorium'],
    ['otis', 'scriptorium'],
    ['turing', 'arithmetique'],
    ['plan', 'cartes'],
    ['claude-code-guide', 'autel'],
  ])('%s → %s', (type, room) => {
    expect(agentPost(type)).toBe(room);
  });

  /**
   * Verifies that agent types are matched case-insensitively
   */
  it.each([
    ['Plan', 'cartes'],
    ['NEO', 'garde'],
    ['Hermione', 'epreuves'],
    ['Claude-Code-Guide', 'autel'],
  ])('%s → %s', (type, room) => {
    expect(agentPost(type)).toBe(room);
  });

  /**
   * Verifies that generic types, empty strings and prototype keys have no post
   */
  it.each([['Explore'], ['general-purpose'], ['Session principale'], [''], ['constructor'], ['toString'], ['__proto__'], ['hasOwnProperty'], ['valueOf']])(
    '%j has no post',
    (type) => {
      expect(agentPost(type)).toBeUndefined();
    },
  );
});

describe('dungeon rooms: workRoom', () => {
  /**
   * Verifies that a specialist subagent stays at its post whatever the tool
   */
  it.each([['Read'], ['Bash'], ['Edit'], ['WebFetch'], ['Frobnicate'], [undefined]])('neo stays in garde with tool %j', (tool) => {
    expect(workRoom(agent('sub', 'neo', 'autel'), tool)).toBe('garde');
  });

  /**
   * Verifies that the janitor goes to the workshop only for editing tools
   */
  it.each([
    ['Edit', 'atelier'],
    ['MultiEdit', 'atelier'],
    ['Write', 'atelier'],
    ['NotebookEdit', 'atelier'],
    ['Read', 'concierge'],
    ['Bash', 'concierge'],
    [undefined, 'concierge'],
  ])('hancock with %j goes to %s', (tool, room) => {
    expect(workRoom(agent('sub', 'hancock', 'concierge'), tool)).toBe(room);
    expect(workRoom(agent('sub', 'Hancock', 'atelier'), tool)).toBe(room);
  });

  /**
   * Verifies that specialist types are recognised case-insensitively
   */
  it('recognises specialist types whatever their case', () => {
    expect(workRoom(agent('sub', 'Oracle'), 'Bash')).toBe('observatoire');
    expect(workRoom(agent('sub', 'TURING'), 'Read')).toBe('arithmetique');
  });

  /**
   * Verifies that the main agent and generic subagents follow their tool
   */
  it.each([
    ['main', 'Session principale'],
    ['sub', 'Explore'],
    ['sub', 'general-purpose'],
  ] as const)('%s %s goes by tool', (kind, type) => {
    const a = agent(kind, type, 'autel');
    expect(workRoom(a, 'Read')).toBe('biblio');
    expect(workRoom(a, 'Bash')).toBe('machines');
    expect(workRoom(a, 'WebSearch')).toBe('observatoire');
    expect(workRoom(a, 'TodoWrite')).toBe('cartes');
  });

  /**
   * Verifies that the main agent never takes a specialist post, even with a specialist name
   */
  it('ignores posts for the main agent', () => {
    expect(workRoom(agent('main', 'neo', 'machines'), undefined)).toBe('machines');
    expect(workRoom(agent('main', 'neo', 'autel'), undefined)).toBe('cartes');
  });

  /**
   * Verifies that without a tool room an agent keeps a working room
   */
  it.each(['biblio', 'machines', 'atelier', 'observatoire', 'garde'] as const)('keeps room %s without tool room', (room) => {
    expect(workRoom(agent('main', 'Session principale', room), undefined)).toBe(room);
    expect(workRoom(agent('sub', 'Explore', room), 'Frobnicate')).toBe(room);
  });

  /**
   * Verifies that agents at the altar or the tavern go home when no tool gives a room
   */
  it.each([
    ['main', 'Session principale', 'autel', 'cartes'],
    ['main', 'Session principale', 'taverne', 'cartes'],
    ['sub', 'Explore', 'autel', 'biblio'],
    ['sub', 'explore', 'taverne', 'biblio'],
    ['sub', 'general-purpose', 'autel', 'atelier'],
    ['sub', 'statusline-setup', 'taverne', 'atelier'],
    ['sub', 'constructor', 'autel', 'atelier'],
  ] as const)('%s %s in %s goes home to %s', (kind, type, from, home) => {
    expect(workRoom(agent(kind, type, from), undefined)).toBe(home);
    expect(workRoom(agent(kind, type, from), 'AskUserQuestion')).toBe(home);
  });
});

describe('dungeon rooms: applyHook', () => {
  /**
   * Verifies that a new specialist subagent starts at its post, generic ones at home
   */
  it.each([
    ['neo', 'garde'],
    ['Oracle', 'observatoire'],
    ['hancock', 'concierge'],
    ['curator', 'scriptorium'],
    ['claude-code-guide', 'autel'],
    ['Explore', 'biblio'],
    ['general-purpose', 'atelier'],
    ['constructor', 'atelier'],
    ['toString', 'atelier'],
  ])('SubagentStart %s starts in %s', (type, room) => {
    const s = run(stateWithEnvs(), [[1, hook('SubagentStart', { agent_id: 'ag-s', agent_type: type })]]);
    expect(s.subagents[0]).toMatchObject({ agentType: type, kind: 'sub', state: 'working', room });
  });

  /**
   * Verifies that a specialist subagent stays at its post while using any tool
   */
  it('keeps a specialist at its post whatever the tool', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('SubagentStart', { agent_id: 'ag-n', agent_type: 'neo' })]]);
    for (const [at, tool] of [[2, 'Read'], [3, 'Bash'], [4, 'Edit'], [5, 'WebFetch']] as const) {
      const s = run(state, [[at, hook('PreToolUse', { agent_id: 'ag-n', tool_name: tool })]]);
      expect(s.subagents[0]).toMatchObject({ tool, room: 'garde', state: 'working' });
    }
  });

  /**
   * Verifies that hancock walks to the workshop to edit and back to his closet otherwise
   */
  it('sends hancock on rounds to the workshop while editing', () => {
    const state = stateWithEnvs();
    let s = run(state, [
      [1, hook('SubagentStart', { agent_id: 'ag-h', agent_type: 'hancock' })],
      [2, hook('PreToolUse', { agent_id: 'ag-h', tool_name: 'Edit', tool_input: { file_path: 'a.ts' } })],
    ]);
    expect(s.subagents[0].room).toBe('atelier');
    s = run(state, [[3, hook('PostToolUse', { agent_id: 'ag-h', tool_name: 'Edit' })]]);
    expect(s.subagents[0].room).toBe('atelier');
    s = run(state, [[4, hook('PreToolUse', { agent_id: 'ag-h', tool_name: 'Grep' })]]);
    expect(s.subagents[0].room).toBe('concierge');
  });

  /**
   * Verifies that a generic subagent follows its tools and keeps its room for unknown tools
   */
  it('moves a generic subagent by tool', () => {
    const state = stateWithEnvs();
    let s = run(state, [
      [1, hook('SubagentStart', { agent_id: 'ag-g', agent_type: 'general-purpose' })],
      [2, hook('PreToolUse', { agent_id: 'ag-g', tool_name: 'Bash' })],
    ]);
    expect(s.subagents[0].room).toBe('machines');
    s = run(state, [[3, hook('PreToolUse', { agent_id: 'ag-g', tool_name: 'Frobnicate' })]]);
    expect(s.subagents[0].room).toBe('machines');
  });

  /**
   * Verifies that agent types are matched case-insensitively in the event flow
   */
  it('matches specialist types case-insensitively on hooks', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'HANCOCK' })],
      [2, hook('SubagentStart', { agent_id: 'ag-2', agent_type: 'Neo' })],
      [3, hook('PreToolUse', { agent_id: 'ag-1', tool_name: 'Write' })],
      [4, hook('PreToolUse', { agent_id: 'ag-2', tool_name: 'Read' })],
    ]);
    expect(s.subagents.map((a) => a.room)).toEqual(['atelier', 'garde']);
  });

  /**
   * Verifies that a prototype-key agent type behaves as a generic subagent
   */
  it('treats prototype-key agent types as generic', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('SubagentStart', { agent_id: 'ag-c', agent_type: 'constructor' })],
      [2, hook('PreToolUse', { agent_id: 'ag-c', tool_name: 'Read' })],
    ]);
    expect(s.subagents[0]).toMatchObject({ agentType: 'constructor', room: 'biblio', state: 'working' });
  });

  /**
   * Verifies that a new prompt sends the main agent to the map room
   */
  it('UserPromptSubmit moves main to cartes', () => {
    const state = stateWithEnvs();
    let s = run(state, [
      [1, hook('Stop')],
      [2, hook('UserPromptSubmit', { prompt: 'go' })],
    ]);
    expect(s.main).toMatchObject({ state: 'working', room: 'cartes' });
    s = run(state, [
      [3, hook('PreToolUse', { tool_name: 'Bash' })],
      [4, hook('UserPromptSubmit', { prompt: 'again' })],
    ]);
    expect(s.main.room).toBe('cartes');
  });

  /**
   * Verifies that after a permission the main agent leaves the altar for its tool room
   */
  it.each([['PostToolUse'], ['PostToolUseFailure']])('%s after PermissionRequest moves main back to work', (post) => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })],
      [2, hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })],
      [3, hook(post, { tool_name: 'Bash' })],
    ]);
    expect(s.main).toMatchObject({ state: 'working', room: 'machines', tool: 'Bash', since: 3 });
    expect(s.main.waitReason).toBeUndefined();
  });

  /**
   * Verifies that after answering a question main leaves the altar for the map room
   */
  it('PostToolUse after AskUserQuestion moves main home to cartes', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which?' }] } })],
      [2, hook('PostToolUse', { tool_name: 'AskUserQuestion' })],
    ]);
    expect(s.main).toMatchObject({ state: 'working', room: 'cartes' });
  });

  /**
   * Verifies that a specialist subagent returns to its post after a permission
   */
  it('PostToolUse after PermissionRequest sends a specialist back to its post', () => {
    const state = stateWithEnvs();
    let s = run(state, [
      [1, hook('SubagentStart', { agent_id: 'ag-n', agent_type: 'neo' })],
      [2, hook('PermissionRequest', { agent_id: 'ag-n', tool_name: 'Bash' })],
    ]);
    expect(s.subagents[0]).toMatchObject({ state: 'waiting', waitReason: 'permission', room: 'autel' });
    s = run(state, [[3, hook('PostToolUse', { agent_id: 'ag-n', tool_name: 'Bash' })]]);
    expect(s.subagents[0]).toMatchObject({ state: 'working', room: 'garde' });
    expect(s.subagents[0].waitReason).toBeUndefined();
  });

  /**
   * Verifies that a generic subagent goes home when its tool gives no room after a wait
   */
  it('PostToolUse after a wait on a roomless tool sends Explore home to biblio', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    const s = run(state, [
      [1100, hook('PermissionRequest', { agent_id: 'ag-1', tool_name: 'Frobnicate' })],
      [1200, hook('PostToolUse', { agent_id: 'ag-1', tool_name: 'Frobnicate' })],
    ]);
    expect(s.subagents[0]).toMatchObject({ state: 'working', room: 'biblio' });
  });

  /**
   * Verifies that a finished specialist goes to the tavern and stays there
   */
  it('sends a done subagent to the tavern and keeps it there', () => {
    const state = stateWithEnvs();
    let s = run(state, [
      [1, hook('SubagentStart', { agent_id: 'ag-n', agent_type: 'neo' })],
      [2, hook('PreToolUse', { agent_id: 'ag-n', tool_name: 'Read' })],
      [3, hook('SubagentStop', { agent_id: 'ag-n' })],
    ]);
    expect(s.subagents[0]).toMatchObject({ state: 'done', room: 'taverne' });
    s = run(state, [[4, hook('PostToolUse', { agent_id: 'ag-n', tool_name: 'Read' })]]);
    expect(s.subagents[0]).toMatchObject({ state: 'done', room: 'taverne' });
  });

  /**
   * Verifies that a busy process moves an idle main agent out of the altar to the map room
   */
  it('moves main out of the tavern when the inventory reports busy', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'idle' })] }), 1000);
    expect(state.sessions.get(LOCAL_A)!.main).toMatchObject({ state: 'waiting', room: 'taverne' });
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ status: 'busy' })] }), 100_000);
    expect(state.sessions.get(LOCAL_A)!.main).toMatchObject({ state: 'working', room: 'cartes' });
  });
});

describe('tavern cycle: wait rooms', () => {
  /**
   * Verifies that waiting for a prompt rests in the tavern, and any other wait queues at the altar
   */
  it.each([
    ['Stop', {}, 'prompt', 'taverne'],
    ['SessionStart', {}, 'prompt', 'taverne'],
    ['Notification', { notification_type: 'idle_prompt' }, 'prompt', 'taverne'],
    ['PermissionRequest', { tool_name: 'Bash' }, 'permission', 'autel'],
    ['Notification', { notification_type: 'permission_prompt', message: 'Allow?' }, 'permission', 'autel'],
    ['PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q?' }] } }, 'question', 'autel'],
    ['StopFailure', { error: 'rate_limit' }, 'error', 'autel'],
  ] as const)('%s %j waits on %s in %s', (event, extra, reason, room) => {
    const s = run(stateWithEnvs(), [[1, hook(event, extra)]]);
    expect(s.main).toMatchObject({ state: 'waiting', waitReason: reason, room });
  });

  /**
   * Verifies that a failure after a finished turn moves main from the tavern to the altar
   */
  it('moves main from the tavern to the altar on StopFailure', () => {
    const state = stateWithEnvs();
    expect(run(state, [[1, hook('Stop')]]).main.room).toBe('taverne');
    expect(run(state, [[2, hook('StopFailure', { error: 'overloaded' })]]).main).toMatchObject({
      waitReason: 'error',
      room: 'autel',
    });
  });

  /**
   * Verifies that a turn ending after a permission wait sends main from the altar to the tavern
   */
  it('moves main from the altar to the tavern on Stop', () => {
    const state = stateWithEnvs();
    expect(run(state, [[1, hook('PermissionRequest', { tool_name: 'Bash' })]]).main.room).toBe('autel');
    expect(run(state, [[2, hook('Stop')]]).main).toMatchObject({ waitReason: 'prompt', room: 'taverne' });
  });

  /**
   * Verifies that a specialist subagent asking a question queues at the altar, not at its post
   */
  it('sends a subagent asking a question to the altar', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('SubagentStart', { agent_id: 'ag-n', agent_type: 'neo' })],
      [2, hook('PreToolUse', { agent_id: 'ag-n', tool_name: 'AskUserQuestion', tool_input: {} })],
    ]);
    expect(s.subagents[0]).toMatchObject({ state: 'waiting', waitReason: 'question', room: 'autel' });
  });

  /**
   * Verifies that a new prompt takes main out of the tavern to the map room
   */
  it('takes main out of the tavern on a new prompt', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('Stop')]]);
    expect(run(state, [[2, hook('UserPromptSubmit', { prompt: 'next' })]]).main).toMatchObject({ state: 'working', room: 'cartes' });
  });
});

describe('tavern cycle: seen types and rosterView', () => {
  /**
   * Verifies that an empty state has an empty roster for any environment
   */
  it('returns [] for an empty state', () => {
    expect(rosterView(createState(), 'env-alpha')).toEqual([]);
    expect(rosterView(createState(), NO_ENV)).toEqual([]);
  });

  /**
   * Verifies that a started subagent's type joins the roster of its session's environment only
   */
  it('records the type of a started subagent in its environment', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' })]]);
    expect(rosterView(state, 'env-alpha')).toEqual(['Explore']);
    expect(rosterView(state, 'env-beta')).toEqual([]);
  });

  /**
   * Verifies that a hook type that is not a valid agent name never reaches the broadcast roster
   */
  it('ignores an invalid hook agent type', () => {
    const state = stateWithEnvs();
    run(state, [
      [1, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'x'.repeat(65) })],
      [2, hook('SubagentStart', { agent_id: 'ag-2', agent_type: '<script>' })],
    ]);
    expect(rosterView(state, 'env-alpha')).toEqual([]);
  });

  /**
   * Verifies that a subagent created from its first tool call also joins the roster
   */
  it('records the type when SubagentStart was missed', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('PreToolUse', { agent_id: 'ag-x', agent_type: 'dexter', tool_name: 'Read' })]]);
    expect(rosterView(state, 'env-alpha')).toEqual(['dexter']);
  });

  /**
   * Verifies that internal agents without a type never join the roster
   */
  it('ignores agents without a type', () => {
    const state = stateWithEnvs();
    run(state, [
      [1, hook('SubagentStart', { agent_id: 'ag-i', agent_type: '' })],
      [2, hook('PreToolUse', { agent_id: 'ag-j', tool_name: 'Read' })],
      [3, hook('SubagentStart', { agent_id: 'ag-k' })],
    ]);
    expect(rosterView(state, 'env-alpha')).toEqual([]);
  });

  /**
   * Verifies that the main agent's tool calls never add a roster entry
   */
  it('does not record the main agent', () => {
    const state = stateWithEnvs();
    run(state, [
      [1, hook('UserPromptSubmit', { prompt: 'go' })],
      [2, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Plan' } })],
    ]);
    expect(rosterView(state, 'env-alpha')).toEqual([]);
  });

  /**
   * Verifies that a type seen twice in different cases is kept once, in its first spelling
   */
  it('dedupes seen types case-insensitively, first spelling wins', () => {
    const state = stateWithEnvs();
    run(state, [
      [1, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' })],
      [2, hook('SubagentStart', { agent_id: 'ag-2', agent_type: 'EXPLORE' })],
      [3, hook('SubagentStart', { agent_id: 'ag-3', agent_type: 'explore' })],
    ]);
    expect(rosterView(state, 'env-alpha')).toEqual(['Explore']);
  });

  /**
   * Verifies that each environment, the virtual one included, keeps its own seen types
   */
  it('keeps seen types per environment', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('SubagentStart', { agent_id: 'ag-a', agent_type: 'neo' }), 1);
    applyHook(state, hook('SubagentStart', { session_id: CLI_B, cwd: 'C:/work/beta', agent_id: 'ag-b', agent_type: 'oracle' }), 2);
    applyHook(state, hook('SubagentStart', { session_id: 'cli-orphan', cwd: 'D:/elsewhere', agent_id: 'ag-o', agent_type: 'turing' }), 3);
    expect(rosterView(state, 'env-alpha')).toEqual(['neo']);
    expect(rosterView(state, 'env-beta')).toEqual(['oracle']);
    expect(rosterView(state, NO_ENV)).toEqual(['turing']);
    expect(rosterView(state, 'env-alpha-api')).toEqual([]);
  });

  /**
   * Verifies that at most 32 types are remembered per environment, the oldest forgotten first
   */
  it('caps seen types at 32 per environment, dropping the oldest', () => {
    const state = stateWithEnvs();
    const type = (i: number) => `t${String(i).padStart(2, '0')}`;
    for (let i = 0; i < 40; i++) applyHook(state, hook('SubagentStart', { agent_id: `ag-${i}`, agent_type: type(i) }), i + 1);
    expect(rosterView(state, 'env-alpha')).toEqual(Array.from({ length: 32 }, (_, k) => type(k + 8)));

    // A forgotten type seen again comes back as the newest, pushing out the next oldest.
    applyHook(state, hook('SubagentStart', { agent_id: 'ag-again', agent_type: type(0) }), 100);
    const roster = rosterView(state, 'env-alpha');
    expect(roster).toHaveLength(32);
    expect(roster).toContain(type(0));
    expect(roster).not.toContain(type(8));
    expect(roster).toContain(type(9));
  });

  /**
   * Verifies that the roster merges global, environment and seen types, deduped and sorted
   */
  it('merges defined and seen types, first spelling wins, sorted by lower-case name', () => {
    const state = createState();
    applyInventory(
      state,
      inventory({
        definedAgents: {
          global: ['zeta', 'Dexter'],
          byEnv: new Map([
            ['env-alpha', ['dexter', 'beta']],
            ['env-beta', ['onlyBeta']],
          ]),
        },
      }),
      0,
    );
    run(state, [
      [1, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' })],
      [2, hook('SubagentStart', { agent_id: 'ag-2', agent_type: 'BETA' })],
      [3, hook('SubagentStart', { agent_id: 'ag-3', agent_type: 'DEXTER' })],
    ]);
    expect(rosterView(state, 'env-alpha')).toEqual(['beta', 'Dexter', 'Explore', 'zeta']);
    expect(rosterView(state, 'env-beta')).toEqual(['Dexter', 'onlyBeta', 'zeta']);
    expect(rosterView(state, 'env-unknown')).toEqual(['Dexter', 'zeta']);
  });

  /**
   * Verifies that duplicates inside a single source are also collapsed
   */
  it('dedupes within the global definitions', () => {
    const state = createState();
    applyInventory(state, inventory({ definedAgents: { global: ['Neo', 'neo', 'NEO'], byEnv: new Map() } }), 0);
    expect(rosterView(state, 'env-alpha')).toEqual(['Neo']);
  });
});

describe('tavern cycle: applyInventory definedAgents', () => {
  const defs = (global: string[], byEnv: [string, string[]][]) => ({ global, byEnv: new Map(byEnv) });

  /**
   * Verifies that a fresh state starts with no defined agents
   */
  it('starts with empty definitions', () => {
    expect(createState().definedAgents).toEqual({ global: [], byEnv: new Map() });
  });

  /**
   * Verifies that each inventory read replaces both global and per-environment definitions
   */
  it('replaces the definitions on each read', () => {
    const state = createState();
    applyInventory(state, inventory({ definedAgents: defs(['g1'], [['env-alpha', ['a1']]]) }), 1);
    expect(rosterView(state, 'env-alpha')).toEqual(['a1', 'g1']);
    applyInventory(state, inventory({ definedAgents: defs(['g2'], []) }), 2);
    expect(rosterView(state, 'env-alpha')).toEqual(['g2']);
  });

  /**
   * Verifies that an inventory without definitions keeps the previous ones
   */
  it('keeps the previous definitions when the inventory has none', () => {
    const state = createState();
    applyInventory(state, inventory({ definedAgents: defs(['g1'], [['env-alpha', ['a1']]]) }), 1);
    applyInventory(state, inventory(), 2);
    expect(rosterView(state, 'env-alpha')).toEqual(['a1', 'g1']);
  });

  /**
   * Verifies that an unreadable presets file keeps per-env definitions but updates global ones
   */
  it('keeps byEnv but updates global when presetsOk is false', () => {
    const state = createState();
    applyInventory(state, inventory({ definedAgents: defs(['g1'], [['env-alpha', ['a1']]]) }), 1);
    applyInventory(state, inventory({ environments: [], presetsOk: false, definedAgents: defs(['g2'], []) }), 2);
    expect(rosterView(state, 'env-alpha')).toEqual(['a1', 'g2']);
    expect(state.definedAgents.global).toEqual(['g2']);

    // Once the presets read again, the fresh per-env definitions apply.
    applyInventory(state, inventory({ presetsOk: true, definedAgents: defs(['g2'], [['env-alpha', ['a2']]]) }), 3);
    expect(rosterView(state, 'env-alpha')).toEqual(['a2', 'g2']);
  });

  /**
   * Verifies that inventory reads never erase the types seen at work
   */
  it('keeps seen types across inventory reads', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('SubagentStart', { agent_id: 'ag-1', agent_type: 'Explore' })]]);
    applyInventory(state, inventory({ definedAgents: defs([], []) }), 2);
    expect(rosterView(state, 'env-alpha')).toEqual(['Explore']);
  });
});

describe('tavern follow-ups: hookEventSchema agent_id and agent_type', () => {
  const base = { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: 'a.ts' } };

  /**
   * Verifies that well-formed agent ids and types, up to their maximum length, are kept as sent
   */
  it.each([
    ['ag-1', 'Explore'],
    ['a0f3c9e1b2d4', 'general-purpose'],
    ['A.b_c-9', 'v1.2'],
    ['a'.repeat(128), 'a'.repeat(64)],
    ['ag-2', 'rest:dexter'],
    ['ag-3', 'my-plugin:reviewer'],
    ['ag-4', `${'p'.repeat(64)}:${'r'.repeat(64)}`],
  ])('keeps agent_id %s and agent_type %s', (id, type) => {
    const r = hookEventSchema.safeParse({ ...base, agent_id: id, agent_type: type });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ agent_id: id, agent_type: type });
  });

  /**
   * Verifies that absent agent fields stay undefined, never null
   */
  it('leaves absent agent_id and agent_type undefined', () => {
    const r = hookEventSchema.parse(base);
    expect(r.agent_id).toBeUndefined();
    expect(r.agent_type).toBeUndefined();
  });

  /**
   * Verifies that an invalid agent_id becomes null while the rest of the payload is kept
   */
  it.each([
    [42],
    [true],
    [{}],
    [['ag-1']],
    [''],
    ['rest:dexter'],
    ['x#main'],
    [`cli:${CLI_A}#main`],
    ['-lead'],
    ['.hidden'],
    ['_x'],
    ['a b'],
    ['ag/1'],
    ['é'],
    ['a'.repeat(129)],
  ])('maps agent_id %j to null without rejecting the event', (id) => {
    const r = hookEventSchema.safeParse({ ...base, agent_id: id, agent_type: 'Explore' });
    expect(r.success).toBe(true);
    expect(r.data!.agent_id).toBeNull();
    expect(r.data).toMatchObject({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read', agent_type: 'Explore' });
  });

  /**
   * Verifies that an invalid agent_type becomes null while the rest of the payload is kept
   */
  it.each([
    [7],
    [{}],
    [''],
    ['x#main'],
    ['-lead'],
    ['.hidden'],
    ['my agent'],
    ['<script>'],
    ['é'],
    ['a'.repeat(65)],
    // Plugin namespacing allows exactly one colon between two valid names.
    ['a::b'],
    [':a'],
    ['a:'],
    [':'],
    ['a:b:c'],
    ['a:-b'],
    ['a:.b'],
    ['p:#x'],
    ['a#b:c'],
    [`p:${'r'.repeat(65)}`],
    [`${'p'.repeat(65)}:r`],
  ])('maps agent_type %j to null without rejecting the event', (type) => {
    const r = hookEventSchema.safeParse({ ...base, agent_id: 'ag-1', agent_type: type });
    expect(r.success).toBe(true);
    expect(r.data!.agent_type).toBeNull();
    expect(r.data).toMatchObject({ agent_id: 'ag-1', tool_name: 'Read' });
  });

  /**
   * Verifies that a JSON null reads as absent, so a main-agent event that sends null still counts
   */
  it('treats a JSON null agent_id or agent_type as absent', () => {
    const r = hookEventSchema.parse({ ...base, agent_id: null, agent_type: null });
    expect(r.agent_id).toBeUndefined();
    expect(r.agent_type).toBeUndefined();
    const state = createState();
    const s = applyHook(state, hookEventSchema.parse({ ...base, agent_id: null }), 1000);
    expect(s.main).toMatchObject({ state: 'working', tool: 'Read' });
  });

  /**
   * Verifies that agent_id allows 128 characters but agent_type only 64 (different limits)
   */
  it('applies the 128-character limit to ids and the 64-character limit to types', () => {
    const r = hookEventSchema.parse({ ...base, agent_id: 'a'.repeat(100), agent_type: 'a'.repeat(100) });
    expect(r.agent_id).toBe('a'.repeat(100));
    expect(r.agent_type).toBeNull();
  });

  /**
   * Verifies that a namespaced type is not accepted as an id (ids still forbid the colon)
   */
  it('refuses a colon in agent_id even where agent_type accepts it', () => {
    const r = hookEventSchema.parse({ ...base, agent_id: 'my-plugin:reviewer', agent_type: 'my-plugin:reviewer' });
    expect(r.agent_id).toBeNull();
    expect(r.agent_type).toBe('my-plugin:reviewer');
  });

  /**
   * Verifies that summaries map refused ids and types to undefined, never null
   */
  it('keeps crafted values out of the event summary', () => {
    const state = stateWithEnvs();
    const ev = hookEventSchema.parse(hook('PreToolUse', { agent_id: 'x#main', agent_type: 'a::b', tool_name: 'Bash' }));
    expect(ev).toMatchObject({ agent_id: null, agent_type: null });
    const sum = summarize(ev, applyHook(state, ev, 5), 5);
    expect(sum.agentId).toBeUndefined();
    expect(sum.agentType).toBeUndefined();
    expect(sum.tool).toBe('Bash');
  });

  /**
   * Verifies that a valid namespaced type is carried as is in the event summary
   */
  it('keeps a namespaced agent type in the event summary', () => {
    const state = stateWithEnvs();
    const ev = hookEventSchema.parse(hook('SubagentStart', { agent_id: 'ag-p', agent_type: 'my-plugin:reviewer' }));
    const sum = summarize(ev, applyHook(state, ev, 5), 5);
    expect(sum).toMatchObject({ agentId: 'ag-p', agentType: 'my-plugin:reviewer' });
  });
});

describe('tavern follow-ups: events with a refused agent_id', () => {
  /** Parses a hook like the HTTP route does, so crafted fields become null. */
  const parsed = (name: string, extra: Record<string, unknown> = {}) => hookEventSchema.parse(hook(name, extra));

  /**
   * Verifies that a tool event with a refused agent_id leaves the main agent unchanged
   */
  it('never applies a tool event with a crafted agent_id to the main agent', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('UserPromptSubmit', { prompt: 'go' })]]);
    const s = applyHook(
      state,
      parsed('PreToolUse', { agent_id: 'rest:dexter', agent_type: 'dexter', tool_name: 'Read', tool_input: { file_path: 'a.ts' } }),
      50,
    );
    expect(s.main).toMatchObject({ state: 'working', room: 'cartes', since: 1, toolDetail: 'go' });
    expect(s.main.tool).toBeUndefined();
    expect(s.subagents).toEqual([]);
    expect(rosterView(state, 'env-alpha')).toEqual([]);
  });

  /**
   * Verifies that a permission request with a refused agent_id never sends main to the altar
   */
  it('never sets the main agent waiting on a crafted PermissionRequest', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } })]]);
    const s = applyHook(state, parsed('PermissionRequest', { agent_id: 'x#main', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }), 60);
    expect(s.main).toMatchObject({ state: 'working', room: 'machines', tool: 'Bash', toolDetail: 'ls', since: 1 });
    expect(s.main.waitReason).toBeUndefined();
  });

  /**
   * Verifies that a refused agent_id still counts as session activity (hook time, activity, live)
   */
  it('still refreshes the session activity', () => {
    const state = stateWithEnvs();
    const s = applyHook(state, parsed('PreToolUse', { agent_id: 42, agent_type: 'neo', tool_name: 'Read' }), 700);
    expect(s).toMatchObject({ id: CLI_KEY, live: true, lastActivityAt: 700, everActive: true });
    expect(state.lastHookAt.get(CLI_KEY)).toBe(700);
    // A new session's main agent stays as created: nothing was applied to it.
    expect(s.main.state).toBe('done');
    expect(s.subagents).toEqual([]);
  });

  /**
   * Verifies that a fresh crafted hook keeps the session live against a missing process
   */
  it('keeps hook authority over the inventory like any other hook', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc()] }), 1000);
    applyHook(state, parsed('PreToolUse', { agent_id: 'x#main', tool_name: 'Read' }), 50_000);
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 50_000 + HOOK_AUTHORITY_MS);
    expect(state.sessions.get(LOCAL_A)?.live).toBe(true);
  });

  /**
   * Verifies that SubagentStart or SubagentStop with a refused id or type affects no figure
   */
  it.each([
    [{ agent_id: 'x#main', agent_type: 'neo' }],
    [{ agent_id: 'rest:neo', agent_type: 'neo' }],
    [{ agent_id: 'ag-1', agent_type: 'a::b' }],
    [{ agent_id: 'ag-1', agent_type: 7 }],
  ])('ignores SubagentStart %j after parsing', (extra) => {
    const state = stateWithEnvs();
    const s = applyHook(state, parsed('SubagentStart', extra), 1);
    expect(s.subagents).toEqual([]);
    expect(rosterView(state, 'env-alpha')).toEqual([]);
  });

  /**
   * Verifies that a refused id never stops a running subagent nor touches main
   */
  it('ignores a SubagentStop with a refused id', () => {
    const state = stateWithEnvs();
    withSubagent(state, 1000);
    const s = applyHook(state, parsed('SubagentStop', { agent_id: 'ag-1#x' }), 1100);
    expect(s.subagents[0]).toMatchObject({ id: 'ag-1', state: 'working' });
    expect(s.main.state).toBe('working');
  });
});

describe('tavern follow-ups: namespaced agent types', () => {
  /**
   * Verifies that a plugin-namespaced subagent gets a figure and joins the roster
   */
  it.each([['my-plugin:reviewer'], ['rest:dexter']])('creates a subagent of type %s and records it', (type) => {
    const state = stateWithEnvs();
    const s = applyHook(state, hookEventSchema.parse(hook('SubagentStart', { agent_id: 'ag-p', agent_type: type })), 1);
    expect(s.subagents).toHaveLength(1);
    expect(s.subagents[0]).toMatchObject({ id: 'ag-p', agentType: type, kind: 'sub' });
    expect(rosterView(state, 'env-alpha')).toEqual([type]);
  });

  /**
   * Verifies that a namespaced type seen first through a tool call is also recorded
   */
  it('records a namespaced type when SubagentStart was missed', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('PreToolUse', { agent_id: 'ag-x', agent_type: 'tools:linter', tool_name: 'Read' })]]);
    expect(rosterView(state, 'env-alpha')).toEqual(['tools:linter']);
  });

  /**
   * Verifies that an Agent call with a namespaced subagent_type is matched to its SubagentStart
   */
  it('matches a pending spawn with a namespaced type', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'my-plugin:reviewer', description: 'Review' } })],
      [2, hook('SubagentStart', { agent_id: 'ag-r', agent_type: 'my-plugin:reviewer' })],
    ]);
    expect(s.subagents[0]).toMatchObject({ agentType: 'my-plugin:reviewer', description: 'Review' });
  });

  /**
   * Verifies that an unparsed hook with an invalid namespaced type is still kept out of the roster
   */
  it.each([['a::b'], ['a:b:c'], [':a'], ['a:']])('keeps %s out of the roster', (type) => {
    const state = stateWithEnvs();
    run(state, [[1, hook('SubagentStart', { agent_id: 'ag-1', agent_type: type })]]);
    expect(rosterView(state, 'env-alpha')).toEqual([]);
  });
});

describe('tavern follow-ups: pending spawns with an invalid subagent_type', () => {
  /**
   * Verifies that an Agent call with an invalid subagent_type queues no spawn
   */
  it.each([[42], [null], [''], ['a::b'], ['a:b:c'], ['plugin:'], ['x#main'], ['my agent'], ['<script>'], ['a'.repeat(65)], [{ name: 'Explore' }]])(
    'queues no spawn for subagent_type %j',
    (type) => {
      const state = stateWithEnvs();
      const s = run(state, [[1, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: type, description: 'Crafted' } })]]);
      expect(state.pendingSpawns.get(CLI_KEY) ?? []).toEqual([]);
      // The call itself still counts as main-agent activity.
      expect(s.main).toMatchObject({ state: 'working', tool: 'Agent' });
      // A later generic start must not inherit the crafted call's description.
      run(state, [[2, hook('SubagentStart', { agent_id: 'ag-g', agent_type: 'general-purpose' })]]);
      expect(s.subagents[0]?.description).toBeUndefined();
    },
  );

  /**
   * Verifies that a Task call with an invalid subagent_type also queues no spawn
   */
  it('queues no spawn for a Task call with a crafted type', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('PreToolUse', { tool_name: 'Task', tool_input: { subagent_type: 'x#main', description: 'T' } })]]);
    expect(state.pendingSpawns.get(CLI_KEY) ?? []).toEqual([]);
  });

  /**
   * Verifies that a valid type of maximum length (64) still queues a spawn
   */
  it('queues a spawn for a 64-character type', () => {
    const state = stateWithEnvs();
    const type = 'a'.repeat(64);
    const s = run(state, [
      [1, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: type, description: 'Long' } })],
      [2, hook('SubagentStart', { agent_id: 'ag-l', agent_type: type })],
    ]);
    expect(s.subagents[0]).toMatchObject({ agentType: type, description: 'Long' });
  });

  /**
   * Verifies that an Agent call without any tool_input defaults its spawn to general-purpose
   */
  it('defaults to general-purpose when the Agent call has no tool_input', () => {
    const state = stateWithEnvs();
    run(state, [[1, hook('PreToolUse', { tool_name: 'Agent' })]]);
    expect(state.pendingSpawns.get(CLI_KEY)).toEqual([{ agentType: 'general-purpose', description: undefined }]);
  });

  /**
   * Verifies that an invalid call between two valid ones leaves the valid spawns matched
   */
  it('keeps the valid spawns around an invalid one', () => {
    const s = run(stateWithEnvs(), [
      [1, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'E' } })],
      [2, hook('PreToolUse', { tool_name: 'Agent', tool_input: { subagent_type: 'bad type', description: 'X' } })],
      [3, hook('PreToolUse', { tool_name: 'Agent', tool_input: { description: 'G' } })],
      [4, hook('SubagentStart', { agent_id: 'ag-g', agent_type: 'general-purpose' })],
      [5, hook('SubagentStart', { agent_id: 'ag-e', agent_type: 'Explore' })],
    ]);
    expect(s.subagents.map((a) => [a.id, a.description])).toEqual([
      ['ag-g', 'G'],
      ['ag-e', 'E'],
    ]);
  });
});

describe('tavern follow-ups: seen types of an absorbed cli session', () => {
  /**
   * Verifies that types of a cli session absorbed by a desktop session join the desktop env roster
   */
  it.each([
    ['no environment', 'D:/elsewhere', NO_ENV],
    ['another environment', 'C:/work/alpha', 'env-alpha'],
  ])('notes the types of a cli session from %s under the desktop environment', (_label, cwd, before) => {
    const state = stateWithEnvs();
    applyHook(state, hook('SubagentStart', { cwd, agent_id: 'ag-n', agent_type: 'neo' }), 1000);
    applyHook(state, hook('PreToolUse', { cwd, agent_id: 'ag-d', agent_type: 'dexter', tool_name: 'Read' }), 1010);
    expect(rosterView(state, before)).toEqual(['dexter', 'neo']);
    expect(rosterView(state, 'env-beta')).toEqual([]);

    applyInventory(
      state,
      inventory({ desktopSessions: [desk({ envId: 'env-beta', matchFolders: ['C:\\work\\beta'], cwd: 'C:\\work\\beta' })] }),
      2000,
    );

    const s = state.sessions.get(LOCAL_A)!;
    expect(state.sessions.has(CLI_KEY)).toBe(false);
    expect(s.envId).toBe('env-beta');
    expect(s.subagents.map((a) => a.id).sort()).toEqual(['ag-d', 'ag-n']);
    expect(rosterView(state, 'env-beta')).toEqual(['dexter', 'neo']);
  });

  /**
   * Verifies that absorbing into a session of the same environment adds no duplicate type
   */
  it('adds no duplicate when the cli session was already in the desktop environment', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('SubagentStart', { agent_id: 'ag-n', agent_type: 'neo' }), 1000);
    applyInventory(state, inventory({ desktopSessions: [desk({ envId: 'env-alpha' })] }), 2000);
    expect(rosterView(state, 'env-alpha')).toEqual(['neo']);
  });

  /**
   * Verifies that a desktop session with no environment notes absorbed types in the virtual roster
   */
  it('notes absorbed types under the virtual environment for an env-less desktop session', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('SubagentStart', { agent_id: 'ag-o', agent_type: 'oracle' }), 1000);
    applyInventory(state, inventory({ desktopSessions: [desk({ matchFolders: ['D:\\elsewhere'], cwd: 'D:\\elsewhere' })] }), 2000);
    expect(state.sessions.get(LOCAL_A)?.envId).toBeNull();
    expect(rosterView(state, NO_ENV)).toEqual(['oracle']);
  });

  /**
   * Verifies that a later poll absorbing nothing does not re-add a type evicted by the 32 cap
   */
  it('does not revive an evicted type on a poll that absorbs nothing', () => {
    const state = stateWithEnvs();
    const type = (i: number) => `t${String(i).padStart(2, '0')}`;
    applyHook(state, hook('SubagentStart', { agent_id: 'ag-0', agent_type: type(0) }), 1);
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 2);
    expect(state.sessions.has(CLI_KEY)).toBe(false);
    expect(rosterView(state, 'env-alpha')).toEqual([type(0)]);

    // 32 newer types on the desktop session push t00 out of the environment's seen list.
    for (let i = 1; i <= 32; i++) applyHook(state, hook('SubagentStart', { agent_id: `ag-${i}`, agent_type: type(i) }), 2 + i);
    expect(rosterView(state, 'env-alpha')).not.toContain(type(0));

    applyInventory(state, inventory({ desktopSessions: [desk()] }), 100);

    const s = state.sessions.get(LOCAL_A)!;
    // The t00 subagent is still on the session: only the absorb-only rule keeps it out.
    expect(s.subagents.some((a) => a.agentType === type(0))).toBe(true);
    const roster = rosterView(state, 'env-alpha');
    expect(roster).not.toContain(type(0));
    expect(roster).toEqual(Array.from({ length: 32 }, (_, k) => type(k + 1)));
  });

  /**
   * Verifies that a namespaced type moves with an absorbed session to the desktop environment
   */
  it('re-keys a namespaced type of an absorbed session', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('SubagentStart', { cwd: 'D:/elsewhere', agent_id: 'ag-p', agent_type: 'my-plugin:reviewer' }), 1);
    applyInventory(state, inventory({ desktopSessions: [desk({ envId: 'env-beta' })] }), 2);
    expect(rosterView(state, 'env-beta')).toEqual(['my-plugin:reviewer']);
  });
});

describe('agent info: session info, live pids and servers', () => {
  const WT_CWD = 'C:/work/alpha/.claude/worktrees/wt-2';
  /** Late enough that a session with no hook is not protected by HOOK_AUTHORITY_MS. */
  const LATER = 10 * HOOK_AUTHORITY_MS;

  /**
   * Verifies that a session created by a hook starts with an empty context and no servers
   */
  it('starts a hook-created session with empty info and no servers', () => {
    const state = stateWithEnvs();
    const s = applyHook(state, hook('SessionStart'), 1000);
    expect(s.info).toStrictEqual({});
    expect(s.servers).toEqual([]);
  });

  /**
   * Verifies that a desktop session without live process takes its context from the record as is
   */
  it('copies the desktop context of a session that is not running', () => {
    const state = createState();
    const info = { branch: 'claude/wt-1', sourceBranch: 'main', model: 'claude-opus-5-5', completedTurns: 3 };
    applyInventory(state, inventory({ desktopSessions: [desk({ info })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.info).toStrictEqual(info);
    expect(state.sessions.get(LOCAL_A)?.servers).toEqual([]);
  });

  /**
   * Verifies that the Claude Code version of the hosting live process is added to the desktop context
   */
  it('adds the cli version of the host live process without mutating the record', () => {
    const state = createState();
    const info = { branch: 'main' };
    applyInventory(state, inventory({ desktopSessions: [desk({ info })], live: [proc({ version: '2.3.1' })] }), 1);
    expect(state.sessions.get(LOCAL_A)?.info).toStrictEqual({ branch: 'main', cliVersion: '2.3.1' });
    expect(info).toStrictEqual({ branch: 'main' });
  });

  /**
   * Verifies that a live process matched by cli session id (no host id) also gives version and pid
   */
  it('matches the live process through the cli session ids', () => {
    const state = createState();
    applyInventory(
      state,
      inventory({ desktopSessions: [desk()], live: [proc({ hostSessionId: undefined, pid: 5151, version: '2.4.0' })] }),
      1,
    );
    expect(state.sessions.get(LOCAL_A)?.info).toStrictEqual({ cliVersion: '2.4.0' });
    expect(state.livePids.get(LOCAL_A)).toBe(5151);
  });

  /**
   * Verifies that a live process without version adds no cliVersion key
   */
  it('adds no cliVersion when the process has none', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk({ info: { effort: 'high' } })], live: [proc()] }), 1);
    expect(state.sessions.get(LOCAL_A)?.info).toStrictEqual({ effort: 'high' });
  });

  /**
   * Verifies that the desktop context follows the record on each inventory and loses the version once ended
   */
  it('refreshes the desktop context on each inventory', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk({ info: { completedTurns: 3 } })], live: [proc({ version: '2.3.1' })] }), 1);
    applyInventory(state, inventory({ desktopSessions: [desk({ info: { completedTurns: 4 } })] }), LATER);
    expect(state.sessions.get(LOCAL_A)?.info).toStrictEqual({ completedTurns: 4 });
  });

  /**
   * Verifies that a terminal session in a git worktree is named after its folder, with its version
   */
  it('gives a terminal worktree session its folder name and version', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, cwd: WT_CWD, worktree: true, version: '2.3.1' })] }), 1);
    const s = state.sessions.get(CLI_KEY)!;
    expect(s.info).toStrictEqual({ worktree: { name: 'wt-2' }, cliVersion: '2.3.1' });
    expect(state.livePids.get(CLI_KEY)).toBe(4242);
  });

  /**
   * Verifies that a terminal session outside a worktree and without version has an empty context
   */
  it('gives a plain terminal session an empty context', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, cwd: WT_CWD, worktree: false })] }), 1);
    expect(state.sessions.get(CLI_KEY)?.info).toStrictEqual({});
  });

  /**
   * Verifies that a terminal session's context is replaced, not merged, on the next inventory
   */
  it('replaces the terminal context on each inventory', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, cwd: WT_CWD, worktree: true, version: '2.3.1' })] }), 1);
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, cwd: WT_CWD, worktree: false, version: '2.4.0' })] }), 2);
    expect(state.sessions.get(CLI_KEY)?.info).toStrictEqual({ cliVersion: '2.4.0' });
  });

  /**
   * Verifies that only running sessions have a pid, refreshed and cleared on every inventory
   */
  it('refills livePids on every inventory', () => {
    const state = createState();
    applyInventory(
      state,
      inventory({ desktopSessions: [desk(), desk({ localId: LOCAL_B, cliSessionIds: [CLI_B] })], live: [proc()] }),
      1,
    );
    expect([...state.livePids]).toEqual([[LOCAL_A, 4242]]);

    // The process restarted under a new pid.
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc({ pid: 4343 })] }), 2);
    expect(state.livePids.get(LOCAL_A)).toBe(4343);

    applyInventory(state, inventory({ desktopSessions: [desk()] }), LATER);
    expect(state.livePids.size).toBe(0);
  });

  /**
   * Verifies that SessionEnd empties the servers of the session
   */
  it('empties the servers on SessionEnd', () => {
    const state = stateWithEnvs();
    const s = applyHook(state, hook('SessionStart'), 1000);
    s.servers = [{ port: 5173, process: 'node' }];
    applyHook(state, hook('SessionEnd'), 2000);
    expect(s.live).toBe(false);
    expect(s.servers).toEqual([]);
  });

  /**
   * Verifies that a desktop session whose process disappeared loses its servers
   */
  it('empties the servers when a desktop session process ends', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()], live: [proc()] }), 1);
    const s = state.sessions.get(LOCAL_A)!;
    s.servers = [{ port: 3000 }];
    applyInventory(state, inventory({ desktopSessions: [desk()] }), LATER);
    expect(s.live).toBe(false);
    expect(s.servers).toEqual([]);
  });

  /**
   * Verifies that a terminal session whose process disappeared loses its servers
   */
  it('empties the servers when a terminal session process ends', () => {
    const state = stateWithEnvs();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined })] }), 1);
    const s = state.sessions.get(CLI_KEY)!;
    s.servers = [{ port: 8080, process: 'python' }];
    applyInventory(state, inventory(), LATER);
    expect(s.live).toBe(false);
    expect(s.servers).toEqual([]);
  });
});

describe('everActive', () => {
  const idleCli = () => proc({ hostSessionId: undefined, status: 'idle' });

  /**
   * Verifies that a cli session seen only as an idle live process is not active
   */
  it('stays false for a cli session from an idle process only', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [idleCli()] }), 1000);
    expect(state.sessions.get(CLI_KEY)).toMatchObject({ origin: 'cli', live: true, everActive: false });
  });

  /**
   * Verifies that an idle session closed by SessionEnd ends stopped and still inactive (a ghost)
   */
  it('stays false after SessionEnd when nothing happened', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [idleCli()] }), 1000);
    applyHook(state, hook('SessionEnd'), 1100);
    applyInventory(state, inventory(), 1000 + HOOK_AUTHORITY_MS + 200);
    expect(state.sessions.get(CLI_KEY)).toMatchObject({ live: false, everActive: false });
  });

  /**
   * Verifies that SessionStart and Notification alone do not count as work
   */
  it.each(['SessionStart', 'Notification', 'SessionEnd'])('stays false after %s alone', (name) => {
    const state = stateWithEnvs();
    const s = applyHook(state, hook(name, { notification_type: 'idle_prompt' }), 500);
    expect(s.everActive).toBe(false);
  });

  /**
   * Verifies that every work hook marks the session active
   */
  it.each([
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PermissionRequest',
    'SubagentStart',
    'SubagentStop',
    'Stop',
    'StopFailure',
  ])('becomes true on %s', (name) => {
    const state = stateWithEnvs();
    const s = applyHook(state, hook(name, { tool_name: 'Read', agent_id: 'ag-1', agent_type: 'Explore' }), 500);
    expect(s.everActive).toBe(true);
  });

  /**
   * Verifies that a work hook of an ignored internal subagent still counts for the session
   */
  it('becomes true on a work hook of an ignored subagent', () => {
    const state = stateWithEnvs();
    const s = applyHook(state, hook('PreToolUse', { tool_name: 'Read', agent_id: 'ag-internal' }), 500);
    expect(s.subagents).toEqual([]);
    expect(s.everActive).toBe(true);
  });

  /**
   * Verifies that a busy process marks the session active
   */
  it('becomes true for a busy process', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, status: 'busy' })] }), 1000);
    expect(state.sessions.get(CLI_KEY)?.everActive).toBe(true);
  });

  /**
   * Verifies that an idle live session turning busy (hooks silent) becomes active
   */
  it('becomes true for a busy process seen later on a live session', () => {
    const state = createState();
    const t0 = 10 * HOOK_AUTHORITY_MS;
    applyInventory(state, inventory({ live: [idleCli()] }), t0);
    expect(state.sessions.get(CLI_KEY)?.everActive).toBe(false);
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, status: 'busy' })] }), t0 + 1000);
    expect(state.sessions.get(CLI_KEY)?.everActive).toBe(true);
  });

  /**
   * Verifies that a transcript found on disk marks an idle session active
   */
  it('becomes true for an idle process with a transcript', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, status: 'idle', transcript: true })] }), 1000);
    expect(state.sessions.get(CLI_KEY)?.everActive).toBe(true);
  });

  /**
   * Verifies that a process of unknown status does not mark the session active
   */
  it('stays false for a process of unknown status', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, status: 'unknown' as 'busy' })] }), 1000);
    expect(state.sessions.get(CLI_KEY)?.everActive).toBe(false);
  });

  /**
   * Verifies that a transcript appearing on a later tick marks a known idle session active
   */
  it('becomes true when a transcript appears on a later tick', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [idleCli()] }), 1000);
    expect(state.sessions.get(CLI_KEY)?.everActive).toBe(false);
    applyInventory(state, inventory({ live: [proc({ hostSessionId: undefined, status: 'idle', transcript: true })] }), 2000);
    expect(state.sessions.get(CLI_KEY)?.everActive).toBe(true);
  });

  /**
   * Verifies that desktop sessions are always active, even without any process
   */
  it('is true for a desktop session', () => {
    const state = createState();
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 1000);
    expect(state.sessions.get(LOCAL_A)).toMatchObject({ origin: 'desktop', live: false, everActive: true });
  });

  /**
   * Verifies that a desktop session absorbing an inactive cli session stays active
   */
  it('stays true when a desktop session absorbs an inactive cli session', () => {
    const state = stateWithEnvs();
    applyHook(state, hook('SessionStart'), 500);
    expect(state.sessions.get(CLI_KEY)?.everActive).toBe(false);
    applyInventory(state, inventory({ desktopSessions: [desk()] }), 600);
    expect(state.sessions.has(CLI_KEY)).toBe(false);
    expect(state.sessions.get(LOCAL_A)?.everActive).toBe(true);
  });

  /**
   * Verifies that once active, a session never goes back to inactive
   */
  it('never goes back to false', () => {
    const state = createState();
    applyInventory(state, inventory({ live: [idleCli()] }), 1000);
    applyHook(state, hook('UserPromptSubmit', { prompt: 'Go' }), 1100);
    applyHook(state, hook('Stop'), 1200);
    applyInventory(state, inventory({ live: [idleCli()] }), 1300);
    applyHook(state, hook('SessionEnd'), 1400);
    applyInventory(state, inventory(), 1400 + HOOK_AUTHORITY_MS + 200);
    prune(state, 1400 + HOOK_AUTHORITY_MS + 300);
    expect(state.sessions.get(CLI_KEY)).toMatchObject({ live: false, everActive: true });
  });
});

describe('summarize: httpCall (Samuel-Morse pigeon)', () => {
  const SM = 'ag-sm';
  const CURL = { command: 'curl -s -i https://api.example.com/v1/items' };

  /** A state holding a samuel-morse subagent, posted in the dovecote. */
  function withSamuelMorse(): OfficeState {
    const state = stateWithEnvs();
    applyHook(state, hook('SubagentStart', { agent_id: SM, agent_type: 'samuel-morse' }), 1000);
    return state;
  }

  /** Applies `ev` then summarises it, as the server does. */
  function summary(state: OfficeState, ev: ReturnType<typeof hook>, at: number) {
    return summarize(ev, applyHook(state, ev, at), at, 7);
  }

  /** A Bash event of the samuel-morse subagent. */
  function smBash(event: string, extra: Record<string, unknown> = {}) {
    return hook(event, { agent_id: SM, agent_type: 'samuel-morse', tool_name: 'Bash', tool_input: CURL, ...extra });
  }

  /**
   * Verifies that a samuel-morse curl gives start, then ok on a 200 response
   */
  it('reports start then ok for a successful curl in the dovecote', () => {
    const state = withSamuelMorse();
    expect(summary(state, smBash('PreToolUse'), 1100).httpCall).toBe('start');
    expect(state.sessions.get(CLI_KEY)!.subagents[0]?.room).toBe('pigeonnier');
    const post = smBash('PostToolUse', { tool_response: { stdout: 'HTTP/1.1 200 OK\r\n\r\n{"items":[]}' } });
    expect(summary(state, post, 1200).httpCall).toBe('ok');
  });

  /**
   * Verifies that a 4xx response of a samuel-morse curl gives error
   */
  it('reports error for a curl answered with 404', () => {
    const state = withSamuelMorse();
    summary(state, smBash('PreToolUse'), 1100);
    const post = smBash('PostToolUse', { tool_response: { stdout: 'HTTP/1.1 404 Not Found\r\n\r\nnope' } });
    expect(summary(state, post, 1200).httpCall).toBe('error');
  });

  /**
   * Verifies that a failed curl run (network, timeout) gives error
   */
  it('reports error for a failed curl run', () => {
    const state = withSamuelMorse();
    summary(state, smBash('PreToolUse'), 1100);
    expect(summary(state, smBash('PostToolUseFailure', { error: 'exit 6' }), 1200).httpCall).toBe('error');
  });

  /**
   * Verifies that the final status after a redirect decides the outcome (301 then 404)
   */
  it('uses the last status line after a redirect', () => {
    const state = withSamuelMorse();
    const stdout = 'HTTP/1.1 301 Moved Permanently\r\nLocation: /b\r\n\r\nHTTP/1.1 404 Not Found\r\n\r\n';
    expect(summary(state, smBash('PostToolUse', { tool_response: { stdout } }), 1200).httpCall).toBe('error');
  });

  /**
   * Verifies that the -w marker overrides earlier status lines
   */
  it('lets the --- HTTP marker override earlier status lines', () => {
    const state = withSamuelMorse();
    const stdout = 'HTTP/1.1 503 Service Unavailable\r\n\r\nretry\n--- HTTP 200';
    expect(summary(state, smBash('PostToolUse', { tool_response: { stdout } }), 1200).httpCall).toBe('ok');
  });

  /**
   * Verifies that the same curl by the main agent (in the machine room) sends no pigeon
   */
  it('gives no httpCall for a curl of the main agent', () => {
    const state = withSamuelMorse();
    const ev = hook('PreToolUse', { tool_name: 'Bash', tool_input: CURL });
    const s = applyHook(state, ev, 1100);
    expect(s.main.room).toBe('machines');
    expect(summarize(ev, s, 1100).httpCall).toBeUndefined();
  });

  /**
   * Verifies that a non-shell tool of samuel-morse sends no pigeon
   */
  it('gives no httpCall for a Read by samuel-morse', () => {
    const state = withSamuelMorse();
    const ev = hook('PreToolUse', { agent_id: SM, agent_type: 'samuel-morse', tool_name: 'Read', tool_input: { file_path: 'C:/work/alpha/api.md' } });
    expect(summary(state, ev, 1100).httpCall).toBeUndefined();
  });

  /**
   * Verifies that a curl from an agent_id the session does not show sends no pigeon
   */
  it('gives no httpCall for an unknown internal agent', () => {
    const state = withSamuelMorse();
    const ev = hook('PreToolUse', { agent_id: 'ag-internal', tool_name: 'Bash', tool_input: CURL });
    expect(summary(state, ev, 1100).httpCall).toBeUndefined();
  });

  /**
   * Verifies that the summary carries only the enum, never the response body or status
   */
  it('never leaks the curl output into the summary', () => {
    const state = withSamuelMorse();
    const stdout = 'HTTP/1.1 418 I am a teapot\r\nSet-Cookie: token=s3cr3t\r\n\r\nsecret-body';
    const sum = summary(state, smBash('PostToolUse', { tool_response: { stdout } }), 1200);
    expect(sum.httpCall).toBe('error');
    const json = JSON.stringify(sum);
    expect(json).not.toContain('s3cr3t');
    expect(json).not.toContain('secret-body');
    expect(json).not.toContain('418');
  });
});
